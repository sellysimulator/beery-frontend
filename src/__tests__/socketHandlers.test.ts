/**
 * `src/api/socket.ts` construction options and the `src/api/socketHandlers.ts`
 * side-effect registration (16 §3, §4.1, §4.3, §4.4, §4.5, §4.6).
 *
 * Covers acceptance criteria 4, 5, 10, 11, 12, 14, 15 and failure modes
 * 1, 2, 5, 7, 8, 9.
 *
 * Harness: `socket.io-client` is replaced with a recorder, so `socket.ts` is
 * exercised as real, un-mocked code while nothing touches transport. The
 * handlers register themselves against that recorder at import time, exactly as
 * they do in the browser, and the tests drive them by calling what they
 * registered. `firebase/*` is stubbed for the same reason: the socket module
 * reads `auth.currentUser` in its handshake callback.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { useGameStore } from '../store/gameStore';
import {
  getHostSecret,
  setHostSecret,
  getSessionToken,
  setSessionToken,
  isHostForRoom,
  setHostRoom,
  getOrCreateGuestId,
  setDisplayName,
} from '../utils/storage';

type Listener = (...args: unknown[]) => void;

const rec = vi.hoisted(() => ({
  /** every `on(event, cb)` registration, in order */
  registrations: [] as Array<{ event: string; cb: Listener }>,
  /** every `emit(event, payload)` the client made */
  emits: [] as Array<{ event: string; payload: unknown }>,
  /** the options object `io()` was constructed with */
  options: undefined as Record<string, unknown> | undefined,
  url: undefined as unknown,
  connectCalls: 0,
  disconnectCalls: 0,
}));

vi.mock('socket.io-client', () => {
  const socket: Record<string, unknown> = {
    id: 'test-sid',
    connected: false,
    on: (event: string, cb: Listener) => {
      rec.registrations.push({ event, cb });
      return socket;
    },
    off: () => socket,
    once: (event: string, cb: Listener) => {
      rec.registrations.push({ event, cb });
      return socket;
    },
    removeAllListeners: () => socket,
    emit: (event: string, payload: unknown) => {
      rec.emits.push({ event, payload });
      return socket;
    },
    connect: () => {
      rec.connectCalls += 1;
      socket.connected = true;
      return socket;
    },
    disconnect: () => {
      rec.disconnectCalls += 1;
      socket.connected = false;
      return socket;
    },
    io: { engine: { transport: { name: 'websocket' } } },
  };
  const io = (url: unknown, options: Record<string, unknown>) => {
    rec.url = url;
    rec.options = options;
    return socket;
  };
  return { io, default: io, Socket: class {}, Manager: class {} };
});

/** Firebase is configuration, not behaviour, for this file. */
const firebaseStub = vi.hoisted(
  () =>
    (extra: Record<string, unknown> = {}) =>
      new Proxy(
        { ...extra },
        {
          get(target: Record<string, unknown>, prop: string | symbol) {
            if (prop in target) return target[prop as string];
            if (prop === '__esModule') return true;
            // `then` MUST stay undefined: a module namespace with a callable
            // `then` looks like a promise and `await import(...)` never resolves.
            if (typeof prop !== 'string' || prop === 'then') return undefined;
            return vi.fn();
          },
        },
      ),
);

vi.mock('firebase/app', () => firebaseStub({ initializeApp: vi.fn(() => ({ name: 'test' })), getApps: vi.fn(() => []), getApp: vi.fn(() => ({ name: 'test' })) }));
vi.mock('firebase/auth', () =>
  firebaseStub({
    getAuth: vi.fn(() => ({ currentUser: null })),
    onAuthStateChanged: vi.fn(() => () => {}),
    GoogleAuthProvider: class {},
  }),
);

const ROOM = 'ABCD12';

/** The `Beery_Frontend` directory, found without assuming how the runner ids modules. */
function projectRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'src'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/** The listeners the handler module registered, latest registration wins. */
function handler(event: string): Listener {
  const found = [...rec.registrations].reverse().find((r) => r.event === event);
  if (!found) {
    throw new Error(
      `socketHandlers registered no listener for "${event}". ` +
        'Section 16 §4.4/§4.5 requires the store to be written by socket handlers.',
    );
  }
  return found.cb;
}

function registered(event: string): boolean {
  return rec.registrations.some((r) => r.event === event);
}

function dispatch(event: string, payload?: unknown): void {
  handler(event)(payload);
}

function emitsOf(event: string): unknown[] {
  return rec.emits.filter((e) => e.event === event).map((e) => e.payload);
}

/** What Socket.IO would actually put on the wire: `undefined` keys vanish. */
function onTheWire(payload: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(payload ?? {})) as Record<string, unknown>;
}

/** Recursively collects every object key appearing anywhere in a value. */
function allKeys(value: unknown, acc: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) allKeys(v, acc);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      acc.push(k);
      allKeys(v, acc);
    }
  }
  return acc;
}

function snapshot(): string {
  return JSON.stringify(useGameStore.getState(), (_k, v) => (typeof v === 'function' ? undefined : v));
}

beforeAll(async () => {
  // Import order matters: the mocks above must be in place first, then the
  // socket module constructs the client, then the handler module registers
  // against it — the same sequence `main.tsx` produces in the browser.
  await import('../api/socket');
  await import('../api/socketHandlers');
});

beforeEach(() => {
  useGameStore.getState().reset();
  rec.emits.length = 0;
  rec.connectCalls = 0;
  rec.disconnectCalls = 0;
  window.history.pushState({}, '', '/');
});

// ---------------------------------------------------------------------------
// socket.ts construction (criteria 4, 5; failure modes 1, 2)
// ---------------------------------------------------------------------------

describe('socket construction (16 §4.1)', () => {
  it('CRITERION 4 / FAILURE MODE 1: autoConnect is false', () => {
    // With autoConnect true the very first handshake happens before Firebase
    // has restored a persisted session, so a returning signed-in user is
    // silently handed a throwaway guest identity by the server.  [HARD-WON]
    expect(rec.options).toBeDefined();
    expect(rec.options?.autoConnect).toBe(false);
  });

  it('CRITERION 5 / FAILURE MODE 2: `auth` is a function, not an object', () => {
    // An object freezes the first ID token for the life of the page; a callback
    // re-runs on every reconnect and picks up a refreshed one.
    expect(typeof rec.options?.auth).toBe('function');
    expect(rec.options?.auth).not.toBeNull();
    expect(typeof rec.options?.auth).not.toBe('object');
  });

  it('FAILURE MODE 2: the auth callback runs again on a second connect, re-reading identity', () => {
    const auth = rec.options?.auth as (cb: (payload: Record<string, unknown>) => void) => void;

    const first = vi.fn();
    auth(first);
    expect(first).toHaveBeenCalledTimes(1);

    // Identity changes between the two connects (this is a guest minting an id).
    const guestId = getOrCreateGuestId();

    const second = vi.fn();
    auth(second);
    expect(second).toHaveBeenCalledTimes(1);

    const firstPayload = first.mock.calls[0]?.[0] as Record<string, unknown>;
    const secondPayload = second.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(firstPayload.guestId ?? null).toBeNull();
    expect(secondPayload.guestId).toBe(guestId);
  });

  it('does not disable TLS verification (a Node-only option, useless in a browser)', () => {
    expect(rec.options).not.toHaveProperty('rejectUnauthorized');
  });

  it('never puts a secret in the handshake options themselves', () => {
    const keys = allKeys(rec.options ?? {}).map((k) => k.toLowerCase());
    expect(keys).not.toContain('host_secret');
    expect(keys).not.toContain('session_token');
    expect(keys).not.toContain('identity');
  });
});

// ---------------------------------------------------------------------------
// main.tsx registration order (criterion 10)
// ---------------------------------------------------------------------------

describe('CRITERION 10: socketHandlers is imported before createRoot', () => {
  const source = readFileSync(join(projectRoot(), 'src', 'main.tsx'), 'utf8');

  it('main.tsx imports the handler module for its side effect', () => {
    expect(source).toMatch(/socketHandlers/);
  });

  it('the import precedes the createRoot call', () => {
    // Under StrictMode a component-mounted handler registers twice and every
    // event is applied twice (16 §4.3).
    const importIndex = source.search(/import\s+(?:[^;]*from\s+)?['"][^'"]*socketHandlers['"]/);
    const createRootIndex = source.search(/createRoot\s*\(/);

    expect(importIndex).toBeGreaterThanOrEqual(0);
    expect(createRootIndex).toBeGreaterThanOrEqual(0);
    expect(importIndex).toBeLessThan(createRootIndex);
  });
});

// ---------------------------------------------------------------------------
// Handler registration (00-conventions §5 coverage floor)
// ---------------------------------------------------------------------------

describe('socketHandlers registers the wire contract', () => {
  it('listens for the lifecycle events', () => {
    for (const event of ['connect', 'connect_error']) {
      expect(registered(event)).toBe(true);
    }
  });

  it('listens for every server -> client event of section 11', () => {
    for (const event of [
      'joined',
      'host_claimed',
      'join_error',
      'lobby_update',
      'config_updated',
      'roles_assigned',
      'game_started',
    ]) {
      expect(`${event}:${registered(event)}`).toBe(`${event}:true`);
    }
  });

  it('listens for every server -> client event of section 12', () => {
    for (const event of [
      'your_state',
      'host_state',
      'order_submitted',
      'week_closed',
      'your_week_closed',
      'game_paused',
      'game_resumed',
      'participant_disconnected',
      'participant_reconnected',
      'bot_substituted',
      'game_finished',
      'error',
    ]) {
      expect(`${event}:${registered(event)}`).toBe(`${event}:true`);
    }
  });

  it('registers each event exactly once — module side effect, not a component effect', () => {
    const counts = new Map<string, number>();
    for (const r of rec.registrations) counts.set(r.event, (counts.get(r.event) ?? 0) + 1);
    for (const [event, count] of counts) {
      expect(`${event}:${count}`).toBe(`${event}:1`);
    }
  });
});

// ---------------------------------------------------------------------------
// seq guard (criteria 11, 12)
// ---------------------------------------------------------------------------

describe('seq guard (16 §4.4)', () => {
  it('CRITERION 12: a higher seq updates the store and lastSeq', () => {
    const before = snapshot();

    dispatch('week_closed', { seq: 5, week: 3, next_week: 4, awaiting_roles: ['RETAILER'] });

    expect(useGameStore.getState().lastSeq).toBe(5);
    expect(snapshot()).not.toBe(before);
  });

  it('CRITERION 11: a lower seq leaves the store completely unchanged', () => {
    dispatch('week_closed', { seq: 5, week: 3, next_week: 4, awaiting_roles: ['RETAILER'] });
    const after5 = snapshot();

    dispatch('week_closed', { seq: 2, week: 1, next_week: 2, awaiting_roles: ['FACTORY', 'RETAILER'] });

    expect(snapshot()).toBe(after5);
    expect(useGameStore.getState().lastSeq).toBe(5);
  });

  it('CRITERION 11: an equal seq is a duplicate and is dropped too', () => {
    dispatch('week_closed', { seq: 5, week: 3, next_week: 4, awaiting_roles: ['RETAILER'] });
    const after5 = snapshot();

    dispatch('week_closed', { seq: 5, week: 9, next_week: 10, awaiting_roles: [] });

    expect(snapshot()).toBe(after5);
  });

  it('a stale event does not rewind the UI after a resync', () => {
    dispatch('week_closed', { seq: 12, week: 6, next_week: 7, awaiting_roles: ['FACTORY'] });
    expect(useGameStore.getState().lastSeq).toBe(12);

    // The straggler from before the reconnect finally arrives.
    dispatch('week_closed', { seq: 4, week: 2, next_week: 3, awaiting_roles: [] });

    expect(useGameStore.getState().lastSeq).toBe(12);
    expect(useGameStore.getState().awaitingRoles).toEqual(['FACTORY']);
  });

  it('applies the documented pause/resume mapping in seq order', () => {
    dispatch('game_paused', { seq: 3, reason: 'P2 disconnected' });

    expect(useGameStore.getState().paused).toBe(true);
    expect(useGameStore.getState().pausedReason).toBe('P2 disconnected');

    dispatch('game_resumed', { seq: 4 });

    expect(useGameStore.getState().paused).toBe(false);
    expect(useGameStore.getState().lastSeq).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// host_claimed (criterion 14)
// ---------------------------------------------------------------------------

describe('CRITERION 14: host_claimed re-arms the tab', () => {
  it('writes the secret with setHostSecret and marks the tab host for that room', () => {
    expect(getHostSecret(ROOM)).toBeNull();
    expect(isHostForRoom(ROOM)).toBe(false);

    dispatch('host_claimed', { room_id: ROOM, host_secret: 'hs-from-server' });

    expect(getHostSecret(ROOM)).toBe('hs-from-server');
    expect(isHostForRoom(ROOM)).toBe(true);
  });

  it('keeps the secret out of localStorage and out of the store', () => {
    dispatch('host_claimed', { room_id: ROOM, host_secret: 'hs-from-server' });

    expect(window.sessionStorage.getItem('x')).toBeNull(); // sanity: areas are real
    expect(JSON.stringify(window.localStorage)).not.toContain('hs-from-server');
    expect(snapshot()).not.toContain('hs-from-server');
  });
});

// ---------------------------------------------------------------------------
// reconnection emits (criterion 15; failure mode 7)
// ---------------------------------------------------------------------------

describe('reconnection (16 §4.5)', () => {
  it('CRITERION 15 / FAILURE MODE 7: at /host/:roomCode with NO stored secret, join_waiting is still emitted', () => {
    // A client that guards this emit on `getHostSecret(roomCode) !== null`
    // silently disables D18's entire recovery path, and the symptom is a
    // permanently paused game — not a client-side error.
    window.history.pushState({}, '', `/host/${ROOM}`);
    useGameStore.setState({ roomCode: ROOM });
    expect(getHostSecret(ROOM)).toBeNull();

    dispatch('connect');

    const payloads = emitsOf('join_waiting') as Array<Record<string, unknown>>;
    expect(payloads.length).toBeGreaterThanOrEqual(1);
    for (const payload of payloads) {
      expect(payload.room_id).toBe(ROOM);
      expect(onTheWire(payload)).not.toHaveProperty('host_secret');
    }
  });

  it('carries the stored host_secret when there is one', () => {
    window.history.pushState({}, '', `/host/${ROOM}`);
    useGameStore.setState({ roomCode: ROOM });
    setHostSecret(ROOM, 'hs-stored');
    setHostRoom(ROOM);

    dispatch('connect');

    const payloads = emitsOf('join_waiting') as Array<Record<string, unknown>>;
    expect(payloads.length).toBeGreaterThanOrEqual(1);
    for (const payload of payloads) {
      expect(payload.room_id).toBe(ROOM);
      expect(payload.host_secret).toBe('hs-stored');
    }
  });

  it('emits join with the stored session_token on a player route', () => {
    window.history.pushState({}, '', `/game/${ROOM}`);
    useGameStore.setState({ roomCode: ROOM });
    setSessionToken(ROOM, 'tok-stored');

    dispatch('connect');

    const payloads = emitsOf('join') as Array<Record<string, unknown>>;
    // §4.5: a shell may also emit `join` on mount, so a cold load can produce
    // two. That is intended — `join` is idempotent by identity — and every one
    // of them must carry the same credentials.
    expect(payloads.length).toBeGreaterThanOrEqual(1);
    for (const payload of payloads) {
      expect(payload.room_id).toBe(ROOM);
      expect(payload.session_token).toBe('tok-stored');
    }
    expect(emitsOf('join_waiting')).toHaveLength(0);
  });

  it('a first-time player joins with no session_token field', () => {
    window.history.pushState({}, '', `/game/${ROOM}`);
    useGameStore.setState({ roomCode: ROOM });

    dispatch('connect');

    const payloads = emitsOf('join') as Array<Record<string, unknown>>;
    expect(payloads.length).toBeGreaterThanOrEqual(1);
    for (const payload of payloads) {
      expect(onTheWire(payload)).not.toHaveProperty('session_token');
    }
  });

  it('carries the stored display name, so a reconnect does not drop it (§4.5)', () => {
    window.history.pushState({}, '', `/game/${ROOM}`);
    useGameStore.setState({ roomCode: ROOM });
    setSessionToken(ROOM, 'tok-stored');
    setDisplayName('Ana Maria');

    dispatch('connect');

    const payloads = emitsOf('join') as Array<Record<string, unknown>>;
    expect(payloads.length).toBeGreaterThanOrEqual(1);
    for (const payload of payloads) {
      expect(payload.display_name).toBe('Ana Maria');
      expect(payload.session_token).toBe('tok-stored');
    }
  });

  it('puts no display_name on the wire when none is stored', () => {
    window.history.pushState({}, '', `/game/${ROOM}`);
    useGameStore.setState({ roomCode: ROOM });
    setSessionToken(ROOM, 'tok-stored');

    dispatch('connect');

    const payloads = emitsOf('join') as Array<Record<string, unknown>>;
    expect(payloads.length).toBeGreaterThanOrEqual(1);
    for (const payload of payloads) {
      expect(onTheWire(payload)).not.toHaveProperty('display_name');
    }
  });

  it('the display name is never sent on join_waiting as a credential', () => {
    window.history.pushState({}, '', `/host/${ROOM}`);
    useGameStore.setState({ roomCode: ROOM });
    setHostSecret(ROOM, 'hs-stored');
    setDisplayName('Ana Maria');

    dispatch('connect');

    // The host's name reaches the room through `join_waiting`'s server-side
    // record, never as something that proves authority.
    for (const payload of emitsOf('join_waiting') as Array<Record<string, unknown>>) {
      expect(payload.host_secret).toBe('hs-stored');
    }
  });

  it('joined stores the session_token per room and puts the alias in the store', () => {
    useGameStore.setState({ roomCode: ROOM });

    dispatch('joined', { alias: 'P3', session_token: 'tok-abc', role: 'RETAILER', is_host: false });

    expect(useGameStore.getState().myAlias).toBe('P3');
    expect(getSessionToken(ROOM)).toBe('tok-abc');
    // 00-conventions §2.5: the token is used only in the join emit, never shown.
    expect(snapshot()).not.toContain('tok-abc');
  });

  it('emits nothing when there is no room to rejoin', () => {
    dispatch('connect');
    expect(rec.emits).toHaveLength(0);
  });
});

describe('join_error reaches the store, not a component listener', () => {
  it('writes the refusal to joinError', () => {
    dispatch('join_error', { message: 'You are not the host of this room.' });

    expect(useGameStore.getState().joinError).toBe('You are not the host of this room.');
  });

  it('is not gated on seq — it carries none', () => {
    dispatch('week_closed', { seq: 30, week: 10, next_week: 11, awaiting_roles: [] });

    dispatch('join_error', { message: 'Room not found.' });

    expect(useGameStore.getState().joinError).toBe('Room not found.');
    expect(useGameStore.getState().lastSeq).toBe(30);
  });

  it('a refused host claim does not retry the emit (§4.5)', () => {
    window.history.pushState({}, '', `/host/${ROOM}`);
    useGameStore.setState({ roomCode: ROOM });
    dispatch('connect');
    const afterConnect = rec.emits.length;

    // On join_error this tab genuinely is not the host: surface the recovery
    // screen rather than retrying.
    dispatch('join_error', { message: 'You are not the host of this room.' });

    expect(rec.emits).toHaveLength(afterConnect);
    expect(useGameStore.getState().joinError).toBeTruthy();
  });

  it('the lobby refusal never becomes a host_secret', () => {
    dispatch('join_error', { message: 'You are not the host of this room.' });

    expect(getHostSecret(ROOM)).toBeNull();
    expect(isHostForRoom(ROOM)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// connect_error (failure mode 5)
// ---------------------------------------------------------------------------

describe('FAILURE MODE 5: a refused handshake is surfaced, once', () => {
  it('sets connectionError and raises exactly one alert across five retries', () => {
    // Socket.IO retries automatically (reconnectionAttempts: 10). Five retries
    // must not become five toasts, and a silent failure must not become a page
    // that never connects.
    for (let i = 0; i < 5; i += 1) {
      dispatch('connect_error', { message: 'Unauthorized' });
    }

    const state = useGameStore.getState();
    expect(state.connectionError).toBeTruthy();
    expect(typeof state.connectionError).toBe('string');
    expect(state.alerts).toHaveLength(1);

    // §4.6 freezes this: a single alert of kind 'error', with `connectionError`
    // set to its message.
    const alert = state.alerts[0];
    expect(typeof alert.id).toBe('string');
    expect(alert.id.length).toBeGreaterThan(0);
    expect(alert.kind).toBe('error');
    expect(typeof alert.message).toBe('string');
    expect(alert.message.length).toBeGreaterThan(0);
    expect([alert.message, 'Unauthorized']).toContain(state.connectionError);
  });

  it('the alert it raises can be dismissed by its id', () => {
    // A successful connect rearms the dedup guard, so this failure is a new
    // one rather than a suppressed repeat of the previous test's.
    dispatch('connect');
    dispatch('connect_error', { message: 'Unauthorized' });

    const alert = useGameStore.getState().alerts[0];
    useGameStore.getState().dismissAlert(alert.id);

    expect(useGameStore.getState().alerts).toHaveLength(0);
  });

  it('a successful connect clears the error so a later failure is visible again', () => {
    dispatch('connect_error', { message: 'Unauthorized' });
    expect(useGameStore.getState().connectionError).toBeTruthy();

    dispatch('connect');
    expect(useGameStore.getState().connectionError).toBeNull();

    dispatch('connect_error', { message: 'xhr poll error' });
    expect(useGameStore.getState().connectionError).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// what the client is allowed to send (failure modes 8, 9)
// ---------------------------------------------------------------------------

describe('per-week records arrive on your_week_closed (12 §2)', () => {
  it('applies a record for the open week behind the seq gate', () => {
    // 07 §3.8 names the player's own record list `own_history`; the payload is
    // `{seq, week, record}` and carries that role's own WeekRecord only.
    dispatch('your_state', {
      seq: 3,
      week: 1,
      role: 'RETAILER',
      own_history: [],
      inventory: 12,
      backlog: 4,
      accumulated_cost: 137.5,
      supply_line: 8,
      supply_line_slots: [4, 6],
      incoming_order: 4,
      last_order: 4,
      has_submitted: false,
      awaiting_roles: ['RETAILER'],
    });

    dispatch('your_week_closed', {
      seq: 4,
      week: 1,
      record: { week: 1, inventory: 12, backlog: 4, week_cost: 9.5 },
    });

    expect(useGameStore.getState().lastSeq).toBe(4);
  });

  it('drops a duplicate record for a week already applied', () => {
    dispatch('your_state', {
      seq: 3,
      week: 1,
      role: 'RETAILER',
      own_history: [],
      inventory: 12,
      backlog: 4,
      accumulated_cost: 137.5,
      supply_line: 8,
      supply_line_slots: [4, 6],
      incoming_order: 4,
      last_order: 4,
      has_submitted: false,
      awaiting_roles: ['RETAILER'],
    });
    dispatch('your_week_closed', { seq: 4, week: 1, record: { week: 1, week_cost: 9.5 } });
    const afterFirst = snapshot();

    dispatch('your_week_closed', { seq: 4, week: 1, record: { week: 1, week_cost: 9.5 } });

    expect(snapshot()).toBe(afterFirst);
  });
});

describe('what the client sends back', () => {
  /** Drives a full, realistic session so the emit log is worth scanning. */
  function driveASession(): void {
    window.history.pushState({}, '', `/host/${ROOM}`);
    useGameStore.setState({ roomCode: ROOM, isHost: true });
    setHostSecret(ROOM, 'hs-stored');
    setHostRoom(ROOM);

    dispatch('connect');
    dispatch('host_claimed', { room_id: ROOM, host_secret: 'hs-rotated' });
    dispatch('lobby_update', {
      seq: 1,
      state: 'LOBBY',
      host_display_name: 'Host',
      participants: [{ alias: 'P1', display_name: 'Ana', role: 'RETAILER', is_bot: false, connected: true, is_host: false }],
      role_to_alias: { RETAILER: 'P1', WHOLESALER: null, DISTRIBUTOR: null, FACTORY: null },
      role_assignment_mode: 'HOST_ASSIGNS',
      seats_total: 4,
      config_locked: false,
      can_start: false,
      start_blocked_reason: 'Waiting for 3 more players.',
    });
    dispatch('game_started', {
      seq: 2,
      week: 1,
      duration_weeks: 20,
      role_to_alias: { RETAILER: 'P1', WHOLESALER: null, DISTRIBUTOR: null, FACTORY: null },
      bots: ['WHOLESALER'],
      config_public: { weeks: 20 },
    });
    // Private, server-owned numbers land in the store. This is a stand-in
    // `player_view` (07 §3.8) carrying the fields failure mode 9 is about;
    // what matters here is only that private numbers went IN.
    dispatch('your_state', {
      seq: 3,
      week: 1,
      role: 'RETAILER',
      own_history: [],
      inventory: 12,
      backlog: 4,
      accumulated_cost: 137.5,
      supply_line: 8,
      supply_line_slots: [4, 6],
      incoming_order: 4,
      last_order: 4,
      has_submitted: false,
      awaiting_roles: ['RETAILER'],
    });
    dispatch('week_closed', { seq: 5, week: 1, next_week: 2, awaiting_roles: ['RETAILER'] });
    // ...and must not come back out on the next reconnect.
    dispatch('connect');
  }

  it('FAILURE MODE 8: never sends a host flag — only the host_secret proves authority', () => {
    driveASession();

    const keys = allKeys(rec.emits.map((e) => e.payload)).map((k) => k.toLowerCase());
    expect(keys).not.toContain('is_host');
    expect(keys).not.toContain('ishost');
    expect(keys).not.toContain('host');

    // The one credential the client is allowed to present.
    expect(keys).toContain('host_secret');
  });

  it('FAILURE MODE 9: never sends a client-computed total or any private quantity back', () => {
    driveASession();

    const keys = allKeys(rec.emits.map((e) => e.payload)).map((k) => k.toLowerCase());
    for (const forbidden of [
      'accumulated_cost',
      'accumulatedcost',
      'inventory',
      'backlog',
      'supply_line',
      'week_cost',
      'total',
      'balance',
      'cost',
      'stats',
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('never sends the server-only identity', () => {
    driveASession();

    const keys = allKeys(rec.emits.map((e) => e.payload)).map((k) => k.toLowerCase());
    expect(keys).not.toContain('identity');
    expect(keys).not.toContain('guest_id');
    expect(keys).not.toContain('idtoken');
  });

  it('every emitted payload carries room_id (00-conventions §3)', () => {
    driveASession();

    for (const { event, payload } of rec.emits) {
      expect(`${event}:${(payload as Record<string, unknown>)?.room_id}`).toBe(`${event}:${ROOM}`);
    }
  });
});
