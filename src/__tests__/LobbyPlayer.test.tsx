/**
 * `17-frontend-lobby.md §2.0` and `§2.3` — `GameRoom.tsx`, the player-side
 * shell and the lobby it renders before week 1.
 *
 * Covers acceptance criteria 10, 11, 12, 13, 14, 21, 22 and 24 (the player
 * half), and failure modes 1, 3, 4, 7 and 10.
 *
 * Harness notes:
 *  - `socket.io-client` is replaced by a recorder, so `src/api/socket.ts` and
 *    `src/api/socketHandlers.ts` run as real, un-mocked code while nothing
 *    touches transport. Importing the handler module reproduces `main.tsx`'s
 *    side-effect registration (16 §4.3), which is the environment these screens
 *    actually render in: server -> client events are delivered by calling what
 *    was registered, exactly as the transport would.
 *  - The store is section 16's, and is read through its public appliers only.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { StrictMode, Suspense } from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { useGameStore } from '../store/gameStore';
import { getSessionToken, setDisplayName, setSessionToken } from '../utils/storage';
import type { GameConfig, Role } from '../types/game';
import type { RouteDescriptor } from '../routes/registry';
import * as GameRoomModule from '../pages/GameRoom';
import { playingScreen, resolveShellScreen } from '../pages/shellScreens';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

type Listener = (...args: unknown[]) => void;

const rec = vi.hoisted(() => ({
  emits: [] as Array<{ event: string; payload: unknown }>,
  listeners: new Map<string, Array<(...args: unknown[]) => void>>(),
}));

vi.mock('socket.io-client', () => {
  const add = (event: string, cb: Listener) => {
    rec.listeners.set(event, [...(rec.listeners.get(event) ?? []), cb]);
  };
  const socket: Record<string, unknown> = {
    id: 'test-sid',
    connected: true,
    on: (event: string, cb: Listener) => {
      add(event, cb);
      return socket;
    },
    once: (event: string, cb: Listener) => {
      add(event, cb);
      return socket;
    },
    off: (event: string, cb?: Listener) => {
      if (!cb) rec.listeners.delete(event);
      else rec.listeners.set(event, (rec.listeners.get(event) ?? []).filter((l) => l !== cb));
      return socket;
    },
    removeAllListeners: (event?: string) => {
      if (event) rec.listeners.delete(event);
      else rec.listeners.clear();
      return socket;
    },
    emit: (event: string, payload: unknown) => {
      rec.emits.push({ event, payload });
      return socket;
    },
    connect: () => {
      socket.connected = true;
      return socket;
    },
    disconnect: () => {
      socket.connected = false;
      return socket;
    },
    io: { engine: { transport: { name: 'websocket' } } },
  };
  const io = () => socket;
  return { io, default: io, Socket: class {}, Manager: class {} };
});

const firebaseStub = vi.hoisted(
  () =>
    (extra: Record<string, unknown> = {}) =>
      new Proxy(
        { ...extra },
        {
          get(target: Record<string, unknown>, prop: string | symbol) {
            if (prop in target) return target[prop as string];
            if (prop === '__esModule') return true;
            if (typeof prop !== 'string' || prop === 'then') return undefined;
            return vi.fn();
          },
        },
      ),
);

vi.mock('firebase/app', () =>
  firebaseStub({
    initializeApp: vi.fn(() => ({ name: 'test' })),
    getApps: vi.fn(() => []),
    getApp: vi.fn(() => ({ name: 'test' })),
  }),
);

vi.mock('firebase/auth', () =>
  firebaseStub({
    getAuth: vi.fn(() => ({ currentUser: null })),
    // firebase.ts uses initializeAuth, not getAuth, so that no popup/redirect
    // resolver is registered at start-up. Both are stubbed: the Proxy default
    // would hand back a vi.fn() returning undefined, and `auth` would then be
    // undefined for every consumer that reads `auth.currentUser`.
    initializeAuth: vi.fn(() => ({ currentUser: null })),
    // These are imported by name, and vitest validates named exports against
    // the object returned here before the Proxy's get trap ever runs, so each
    // one has to be present explicitly. Their values are never inspected:
    // firebase.ts only hands the persistences to initializeAuth, and
    // AuthContext passes the resolver straight to signInWithPopup.
    indexedDBLocalPersistence: {},
    browserLocalPersistence: {},
    browserPopupRedirectResolver: {},
    onAuthStateChanged: vi.fn(() => () => {}),
    GoogleAuthProvider: class {},
  }),
);

const httpRec = vi.hoisted(() => {
  const ok = async (): Promise<{ data: Record<string, unknown> }> => ({ data: {} });
  return { get: vi.fn(ok), post: vi.fn(ok), put: vi.fn(ok), delete: vi.fn(ok), defaults: { baseURL: '/api/v1' } };
});

vi.mock('../api/http', () => ({
  default: httpRec,
  http: httpRec,
  errorMessage: (_err: unknown, fallback: string) => fallback,
}));

vi.mock('../api/health', () => ({ checkHealth: vi.fn(async () => true) }));

const ROOM = 'ABC234';

// ---------------------------------------------------------------------------
// Wire helpers
// ---------------------------------------------------------------------------

function dispatch(event: string, payload?: unknown): void {
  const listeners = [...(rec.listeners.get(event) ?? [])];
  if (listeners.length === 0) {
    throw new Error(
      `Nothing is listening for "${event}". Section 16 §4.5 registers the lobby events as a ` +
        'module side effect, and §2.3 requires the player lobby to act on join_error.',
    );
  }
  act(() => {
    for (const cb of listeners) cb(payload);
  });
}

function emitsOf(event: string): Array<Record<string, unknown>> {
  return rec.emits.filter((e) => e.event === event).map((e) => (e.payload ?? {}) as Record<string, unknown>);
}

type Participant = {
  alias: string;
  display_name: string;
  role: Role | null;
  is_bot: boolean;
  connected: boolean;
  is_host: boolean;
};

function participant(overrides: Partial<Participant> & { alias: string; display_name: string }): Participant {
  return { role: null, is_bot: false, connected: true, is_host: false, ...overrides };
}

const EMPTY_ROLES: Record<Role, string | null> = {
  RETAILER: null,
  WHOLESALER: null,
  DISTRIBUTOR: null,
  FACTORY: null,
};

function lobbyUpdate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    seq: 1,
    state: 'LOBBY',
    host_display_name: 'Ana',
    participants: [participant({ alias: 'P1', display_name: 'Bea' })],
    role_to_alias: { ...EMPTY_ROLES },
    role_assignment_mode: 'HOST_ASSIGNS',
    seats_total: 4,
    config_locked: false,
    can_start: false,
    start_blocked_reason: 'Four roles are still empty. Assign them, or turn on bot fill.',
    ...overrides,
  };
}

function bodyText(): string {
  return (document.body.textContent ?? '').replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function descriptorsOf(mod: unknown, label: string): RouteDescriptor[] {
  const route = (mod as { route?: RouteDescriptor | RouteDescriptor[] }).route;
  if (!route) throw new Error(`${label} exports no \`route\` descriptor (17 §3.0).`);
  return Array.isArray(route) ? route : [route];
}

function gameDescriptor(): RouteDescriptor {
  const found = descriptorsOf(GameRoomModule, 'GameRoom.tsx').find((d) => d.path === '/game/:roomCode');
  if (!found) throw new Error('GameRoom.tsx declares no descriptor for `/game/:roomCode` (17 §3.0).');
  return found;
}

function renderPlayerRoom({ strict = false }: { strict?: boolean } = {}) {
  const tree = (
    <MemoryRouter initialEntries={[`/game/${ROOM}`]}>
      <Routes>
        <Route path="/game/:roomCode" element={gameDescriptor().element} />
        <Route path="*" element={<div data-testid="elsewhere" />} />
      </Routes>
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

/** Every element a keyboard can reach and activate (§3.5). */
function operableElements(): HTMLElement[] {
  const set = new Set<HTMLElement>();
  for (const el of Array.from(document.querySelectorAll('button, [role="button"], [tabindex], a, input'))) {
    set.add(el as HTMLElement);
  }
  return [...set];
}

/** The tightest keyboard-operable control whose text names this role. */
function roleControl(role: Role): HTMLElement {
  const pattern = new RegExp(role, 'i');
  const matches = operableElements()
    .filter((el) => pattern.test(el.textContent ?? ''))
    .sort((a, b) => (a.textContent ?? '').length - (b.textContent ?? '').length);
  if (matches.length === 0) {
    throw new Error(
      `No keyboard-operable role card for ${role}. §2.3 requires four claimable role cards in ` +
        'PLAYER_CHOOSES, and §3.5 requires them actionable by keyboard.',
    );
  }
  return matches[0];
}

function isDisabled(el: HTMLElement): boolean {
  return el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
}

beforeAll(async () => {
  // The mocks above must be in place first, then the socket module builds the
  // client, then the handler module registers against it — `main.tsx`'s order.
  await import('../api/socket');
  await import('../api/socketHandlers');
});

beforeEach(() => {
  act(() => {
    useGameStore.getState().reset();
  });
  rec.emits.length = 0;
});

// ---------------------------------------------------------------------------
// Criterion 10 and failure mode 4 — the join emit
// ---------------------------------------------------------------------------

describe('CRITERION 10: the player lobby joins on mount', () => {
  it('emits join once, carrying the stored session_token', () => {
    setSessionToken(ROOM, 'tok-stored');

    renderPlayerRoom();

    const payloads = emitsOf('join');
    expect(payloads).toHaveLength(1);
    expect(payloads[0].room_id).toBe(ROOM);
    expect(payloads[0].session_token).toBe('tok-stored');
  });

  it('emits join with no session_token for a first-time player', () => {
    renderPlayerRoom();

    const payloads = emitsOf('join');
    expect(payloads).toHaveLength(1);
    expect(payloads[0].room_id).toBe(ROOM);
    expect(payloads[0].session_token ?? null).toBeNull();
  });

  it('never puts the host_secret or an identity on the wire (00-conventions §2)', () => {
    setSessionToken(ROOM, 'tok-stored');
    renderPlayerRoom();

    const keys = emitsOf('join').flatMap((p) => Object.keys(p));
    expect(keys).not.toContain('host_secret');
    expect(keys).not.toContain('identity');
    expect(keys).not.toContain('is_host');
  });

  it('CRITERION 27: carries the persisted display name, so a reload keeps the name', () => {
    // §3.0b: the name was entered on /home and written through section 16's
    // `storage.ts`. Router navigation state does not survive a reload; this
    // does, which is the whole point of putting it in storage.
    setDisplayName('Bea');

    renderPlayerRoom();

    const payloads = emitsOf('join');
    expect(payloads).toHaveLength(1);
    expect(payloads[0].display_name).toBe('Bea');
  });

  it('CRITERION 27: omits display_name when the browser has never stored one', () => {
    renderPlayerRoom();

    const payloads = emitsOf('join');
    expect(payloads[0].display_name ?? null).toBeNull();
  });

  it('FAILURE MODE 4: StrictMode does not produce a second join', () => {
    // Server-side idempotency (section 11) exists for reconnects, not to paper
    // over a double-mounted effect. A second join here is a UI bug and must be
    // fixed in the UI.
    renderPlayerRoom({ strict: true });

    expect(emitsOf('join')).toHaveLength(1);
  });

  it('does not emit join_waiting — this tab is a player, not the host', () => {
    renderPlayerRoom();
    expect(emitsOf('join_waiting')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Criteria 11, 21, 22 and failure modes 7, 10 — the participant list
// ---------------------------------------------------------------------------

describe('CRITERION 11: the participant list comes from lobby_update', () => {
  it('renders the room code and the host display name', () => {
    renderPlayerRoom();
    dispatch('lobby_update', lobbyUpdate());

    expect(bodyText()).toContain(ROOM);
    expect(bodyText()).toContain('Ana');
  });

  it('renders every participant, with the role each holds', () => {
    renderPlayerRoom();
    dispatch(
      'lobby_update',
      lobbyUpdate({
        participants: [
          participant({ alias: 'P1', display_name: 'Bea', role: 'RETAILER' }),
          participant({ alias: 'P2', display_name: 'Caro' }),
        ],
        role_to_alias: { ...EMPTY_ROLES, RETAILER: 'P1' },
      }),
    );

    expect(bodyText()).toContain('Bea');
    expect(bodyText()).toContain('Caro');
    expect(bodyText()).toMatch(/retailer/i);
  });

  it('updates when a newer lobby_update arrives', () => {
    renderPlayerRoom();
    dispatch('lobby_update', lobbyUpdate());
    expect(bodyText()).toContain('Bea');

    dispatch(
      'lobby_update',
      lobbyUpdate({
        seq: 2,
        participants: [
          participant({ alias: 'P1', display_name: 'Bea' }),
          participant({ alias: 'P2', display_name: 'Caro' }),
        ],
      }),
    );

    expect(bodyText()).toContain('Caro');
  });

  it('FAILURE MODE 10: an out-of-order lobby_update never overwrites a newer one', () => {
    renderPlayerRoom();

    dispatch(
      'lobby_update',
      lobbyUpdate({
        seq: 5,
        participants: [
          participant({ alias: 'P1', display_name: 'Bea' }),
          participant({ alias: 'P2', display_name: 'Caro' }),
        ],
      }),
    );
    // The straggler. `seq` is monotonic per room (00-conventions §3) precisely
    // so a client can discard what it has already moved past.
    dispatch('lobby_update', lobbyUpdate({ seq: 3, participants: [participant({ alias: 'P1', display_name: 'Bea' })] }));

    expect(bodyText()).toContain('Caro');
    expect(useGameStore.getState().participants).toHaveLength(2);
  });
});

describe('CRITERION 21 / FAILURE MODE 7: bots are labelled', () => {
  it('renders a Bot badge as text, not colour alone', () => {
    renderPlayerRoom();
    dispatch(
      'lobby_update',
      lobbyUpdate({
        participants: [
          participant({ alias: 'P1', display_name: 'Bea' }),
          participant({ alias: 'P2', display_name: 'Wholesaler bot', role: 'WHOLESALER', is_bot: true }),
        ],
        role_to_alias: { ...EMPTY_ROLES, WHOLESALER: 'P2' },
      }),
    );

    // §3.3 [REQUIRED]: a human who believed they were playing three humans
    // draws a different conclusion in the debrief.
    const badges = screen.getAllByText(/^\s*bot\s*$/i);
    expect(badges.length).toBeGreaterThan(0);
    expect((badges[0].textContent ?? '').trim().length).toBeGreaterThan(0);
  });

  it('does not badge a human participant', () => {
    renderPlayerRoom();
    dispatch('lobby_update', lobbyUpdate({ participants: [participant({ alias: 'P1', display_name: 'Bea' })] }));

    expect(screen.queryAllByText(/^\s*bot\s*$/i)).toHaveLength(0);
  });

  it('§3.5: a disconnected participant is described in words, not by a colour', () => {
    renderPlayerRoom();
    dispatch(
      'lobby_update',
      lobbyUpdate({
        participants: [participant({ alias: 'P1', display_name: 'Bea', connected: false })],
      }),
    );

    expect(bodyText()).toMatch(/offline|disconnected|away|not connected|unavailable|reconnecting/i);
  });
});

describe('CRITERION 22: the wait explains itself', () => {
  it('names the host and what they are doing, rather than showing a bare spinner', () => {
    renderPlayerRoom();
    dispatch('lobby_update', lobbyUpdate());

    // §2.3's copy, and §9.4's rule: every wait says what is being waited for
    // and who is holding it up.
    expect(bodyText()).toMatch(/Ana is setting up the game/i);
  });

  it('links to the player manual from the lobby', () => {
    renderPlayerRoom();
    dispatch('lobby_update', lobbyUpdate());

    const links = Array.from(document.querySelectorAll('a')).filter((a) =>
      (a.getAttribute('href') ?? '').endsWith('/player-manual'),
    );
    expect(links.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Criterion 12 and failure mode 1 — configuration never reaches a player
// ---------------------------------------------------------------------------

describe('CRITERION 12 / FAILURE MODE 1: a player sees no configuration', () => {
  /**
   * Distinctive values, so that finding one in the DOM is unambiguous. Section
   * 11 §3.4 says `config_updated` goes to the host sid only, so a player whose
   * store holds this is already looking at a backend bug — and the screen that
   * `beer-game-spec.md §4.1` forbids must still not appear.
   */
  const FULL_CONFIG = {
    weeks: 4242,
    role_assignment_mode: 'PLAYER_CHOOSES',
    pause_on_disconnect: true,
    bot_fill: true,
    starting_capital: 98765,
    random_seed: 13579,
    demand: { kind: 'SEASONAL', base: 8888, amplitude: 7777, period: 6666 },
    roles: {
      RETAILER: {
        holding_cost: 5.55,
        backlog_cost: 6.66,
        fixed_order_cost: 4.44,
        unit_purchase_cost: 3.33,
        initial_inventory: 3939,
        initial_backlog: 2828,
        shipping_delay_weeks: 7,
        order_delay_weeks: 6,
        initial_pipeline_quantity: 1717,
        initial_order_in_pipeline: 1616,
      },
    },
  } as unknown as GameConfig;

  const SENTINELS = [
    '4242',
    '98765',
    '13579',
    '8888',
    '7777',
    '6666',
    '5.55',
    '6.66',
    '4.44',
    '3.33',
    '3939',
    '2828',
    '1717',
    '1616',
  ];

  const CONFIG_LABELS = [
    /holding cost/i,
    /backlog cost/i,
    /starting capital/i,
    /random seed/i,
    /shipping delay/i,
    /order delay/i,
    /fixed order cost/i,
    /unit (purchase )?cost/i,
    /demand/i,
    /seasonal/i,
    /\bweeks\b/i,
    /initial inventory/i,
  ];

  it('renders no configuration value even when the store holds a whole config', () => {
    renderPlayerRoom();
    dispatch('lobby_update', lobbyUpdate());

    act(() => {
      useGameStore.setState({ config: FULL_CONFIG });
    });

    const text = bodyText();
    for (const sentinel of SENTINELS) {
      expect(`${sentinel}:${text.includes(sentinel)}`).toBe(`${sentinel}:false`);
    }
    for (const label of CONFIG_LABELS) {
      expect(`${label}:${label.test(text)}`).toBe(`${label}:false`);
    }
  });

  it('renders no configuration value in PLAYER_CHOOSES either, where there is most to show', () => {
    renderPlayerRoom();
    dispatch('lobby_update', lobbyUpdate({ role_assignment_mode: 'PLAYER_CHOOSES' }));

    act(() => {
      useGameStore.setState({ config: FULL_CONFIG });
    });

    const text = bodyText();
    for (const sentinel of SENTINELS) {
      expect(`${sentinel}:${text.includes(sentinel)}`).toBe(`${sentinel}:false`);
    }
  });
});

// ---------------------------------------------------------------------------
// Criteria 13, 14 and failure mode 3 — claiming a role
// ---------------------------------------------------------------------------

describe('CRITERION 13: PLAYER_CHOOSES role cards', () => {
  function renderChoosing(roleToAlias: Record<Role, string | null> = { ...EMPTY_ROLES }) {
    renderPlayerRoom();
    dispatch(
      'lobby_update',
      lobbyUpdate({
        role_assignment_mode: 'PLAYER_CHOOSES',
        role_to_alias: roleToAlias,
        participants: [
          participant({ alias: 'P1', display_name: 'Bea' }),
          participant({ alias: 'P2', display_name: 'Caro', role: roleToAlias.WHOLESALER ? 'WHOLESALER' : null }),
        ],
      }),
    );
  }

  it('carries the one-line description of each role (§2.3)', () => {
    renderChoosing();

    const text = bodyText();
    expect(text).toMatch(/you sell to the public/i);
    expect(text).toMatch(/only one who sees what real customers/i);
    expect(text).toMatch(/you supply the Retailer and order from the Distributor/i);
    expect(text).toMatch(/you supply the Wholesaler and order from the Factory/i);
    expect(text).toMatch(/you brew/i);
  });

  it('emits claim_role with the room and the role when a free card is chosen', async () => {
    const user = userEvent.setup();
    renderChoosing();

    await user.click(roleControl('DISTRIBUTOR'));

    const payloads = emitsOf('claim_role');
    expect(payloads).toHaveLength(1);
    expect(payloads[0].room_id).toBe(ROOM);
    expect(payloads[0].role).toBe('DISTRIBUTOR');
  });

  it('disables a taken card and names who has it', () => {
    renderChoosing({ ...EMPTY_ROLES, WHOLESALER: 'P2' });

    const taken = roleControl('WHOLESALER');
    expect(isDisabled(taken)).toBe(true);
    expect(bodyText()).toContain('Caro');
  });

  it('does not emit claim_role for a card someone else holds', async () => {
    const user = userEvent.setup();
    renderChoosing({ ...EMPTY_ROLES, WHOLESALER: 'P2' });

    await user.click(roleControl('WHOLESALER')).catch(() => undefined);

    expect(emitsOf('claim_role')).toHaveLength(0);
  });

  it('shows no role cards outside PLAYER_CHOOSES', () => {
    renderPlayerRoom();
    dispatch('lobby_update', lobbyUpdate({ role_assignment_mode: 'HOST_ASSIGNS' }));

    expect(bodyText()).not.toMatch(/you sell to the public/i);
  });
});

describe('CRITERION 14 / FAILURE MODE 3: the claim is never optimistic', () => {
  function renderChoosing() {
    renderPlayerRoom();
    dispatch('lobby_update', lobbyUpdate({ role_assignment_mode: 'PLAYER_CHOOSES' }));
  }

  it('does not seat the player before the server has answered', async () => {
    const user = userEvent.setup();
    renderChoosing();

    await user.click(roleControl('FACTORY'));

    expect(useGameStore.getState().myRole).toBeNull();
  });

  it('renders the refusal inline and leaves the local seat alone', async () => {
    const user = userEvent.setup();
    renderChoosing();

    await user.click(roleControl('FACTORY'));
    dispatch('join_error', { message: 'That role has already been taken.' });

    await waitFor(() => expect(bodyText()).toMatch(/already been taken/i));
    expect(useGameStore.getState().myRole).toBeNull();
  });

  it('reads the refusal from the store, not from a listener of its own', async () => {
    const user = userEvent.setup();
    renderChoosing();

    await user.click(roleControl('FACTORY'));
    expect(useGameStore.getState().joinError).toBeNull();

    // 16 §3: `join_error` lands in the store through `applyJoinError`, because
    // a screen that subscribes to the socket directly is a second interpreter
    // of the wire — StrictMode double-registers it and a reconnect leaves it
    // stale.
    act(() => {
      (useGameStore.getState() as unknown as { applyJoinError: (p: unknown) => void }).applyJoinError({
        message: 'That role has already been taken.',
      });
    });

    await waitFor(() => expect(bodyText()).toMatch(/already been taken/i));
    expect(useGameStore.getState().joinError).toBe('That role has already been taken.');
    expect(useGameStore.getState().myRole).toBeNull();
  });

  it('lets the server settle the truth with the next lobby_update', async () => {
    const user = userEvent.setup();
    renderChoosing();

    await user.click(roleControl('FACTORY'));
    dispatch('join_error', { message: 'That role has already been taken.' });
    dispatch(
      'lobby_update',
      lobbyUpdate({
        seq: 2,
        role_assignment_mode: 'PLAYER_CHOOSES',
        role_to_alias: { ...EMPTY_ROLES, FACTORY: 'P9' },
        participants: [participant({ alias: 'P9', display_name: 'Dee', role: 'FACTORY' })],
      }),
    );

    expect(bodyText()).toContain('Dee');
    expect(useGameStore.getState().myRole).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Criterion 24 — the shellScreens seam, with section 19 absent
// ---------------------------------------------------------------------------

describe('CRITERION 24: the player shell resolves section 19 by discovery', () => {
  const PLAYING = './GameRoomPlaying.tsx';

  it('resolves an absent screen to null rather than a compile error', () => {
    // The analogue of section 16's empty route registry, and asserted the same
    // way: against an explicit loader record, never the live glob. The glob is
    // expanded at transform time, so once section 19's file exists
    // `playingScreen()` can never return null again -- an assertion against it
    // is true for exactly one wave and false forever after.
    expect(resolveShellScreen({}, PLAYING, 'GameRoomPlaying')).toBeNull();
  });

  it('treats an entry that is not a loader as absent, without importing anything', () => {
    // The record maps a path to the module's LOADER, because the screen is
    // fetched on first use rather than shipped in the initial bundle. "Is the
    // section built?" is still answered synchronously -- no key, or a key
    // holding something uncallable, is absent -- so the shell still gets its
    // `null` before it renders anything.
    expect(resolveShellScreen({ [PLAYING]: undefined }, PLAYING, 'GameRoomPlaying')).toBeNull();
    expect(
      resolveShellScreen(
        { [PLAYING]: 'not a loader' as unknown as () => Promise<Record<string, unknown>> },
        PLAYING,
        'GameRoomPlaying',
      ),
    ).toBeNull();
  });

  it('prefers the named export and falls back to the default', async () => {
    const Named = () => <div data-testid="from-named" />;
    const Fallback = () => <div data-testid="from-default" />;

    // Both shapes in one tree: the first proves the named export wins over a
    // default sitting beside it, the second that a module with only a default
    // still resolves. Asserted by rendering, because `lazy()` keeps the
    // resolved component behind its own payload and there is nothing to
    // compare with `toBe`.
    const Preferred = resolveShellScreen(
      { [PLAYING]: async () => ({ GameRoomPlaying: Named, default: Fallback }) },
      PLAYING,
      'GameRoomPlaying',
    )!;
    const OnlyDefault = resolveShellScreen(
      { [PLAYING]: async () => ({ default: Fallback }) },
      PLAYING,
      'GameRoomPlaying',
    )!;

    expect(Preferred).not.toBeNull();
    expect(OnlyDefault).not.toBeNull();

    render(
      <Suspense fallback={null}>
        <Preferred />
        <OnlyDefault />
      </Suspense>,
    );

    expect(await screen.findByTestId('from-named')).toBeInTheDocument();
    expect(await screen.findByTestId('from-default')).toBeInTheDocument();
  });

  it('renders the delegated screen, not the placeholder, once the room is RUNNING', async () => {
    // `not.toBeNull()` rather than `toBeTypeOf('function')`: the playing screen
    // is fetched on first use, and `React.lazy` hands back an exotic component
    // object rather than a function. Whether section 19 exists at all is still
    // decided synchronously, which is all the shell asks.
    expect(playingScreen()).not.toBeNull();

    act(() => {
      useGameStore.setState({ roomState: 'RUNNING' });
    });

    renderPlayerRoom();

    // Waiting out the Suspense fallback is what keeps the assertion below about
    // the real screen rather than about the fallback standing in for it.
    await waitFor(() => expect(bodyText()).not.toContain('Loading the game screen'));

    expect(bodyText()).not.toMatch(/This screen is not available yet/i);
  });

  it('still joins the room in a state it cannot yet render', () => {
    act(() => {
      useGameStore.setState({ roomState: 'PAUSED' });
    });

    renderPlayerRoom();

    // §2.0: both shells own the join emit, because it applies in every state.
    expect(emitsOf('join')).toHaveLength(1);
  });

  it('renders the lobby, not the placeholder, while the room has not started', () => {
    renderPlayerRoom();
    dispatch('lobby_update', lobbyUpdate({ state: 'CONFIGURING' }));

    expect(bodyText()).not.toMatch(/This screen is not available yet/i);
    expect(bodyText()).toContain(ROOM);
  });
});

// ---------------------------------------------------------------------------
// Leaving a lobby
// ---------------------------------------------------------------------------

/** The tightest keyboard-operable control whose text matches. */
function control(pattern: RegExp): HTMLElement {
  const matches = operableElements()
    .filter((el) => pattern.test(el.textContent ?? ''))
    .sort((a, b) => (a.textContent ?? '').length - (b.textContent ?? '').length);
  if (matches.length === 0) throw new Error(`No keyboard-operable control matching ${pattern}.`);
  return matches[0];
}

describe('a waiting player can leave the lobby', () => {
  const LEAVE = /leave room/i;
  const CONFIRM = /yes, leave the room/i;

  it('offers a keyboard-operable way out while waiting for the host', () => {
    renderPlayerRoom();
    dispatch('lobby_update', lobbyUpdate({ state: 'CONFIGURING' }));

    expect(control(LEAVE)).toBeInTheDocument();
    expect(isDisabled(control(LEAVE))).toBe(false);
  });

  it('asks before giving the seat up, and emits nothing until it is confirmed', async () => {
    const user = userEvent.setup();
    renderPlayerRoom();
    dispatch('lobby_update', lobbyUpdate({ state: 'CONFIGURING' }));

    await user.click(control(LEAVE));

    // The seat is freed server-side and the whole room sees it go, so a
    // misclick is not a recoverable client-side navigation.
    expect(emitsOf('leave')).toHaveLength(0);
    expect(bodyText()).toMatch(/your seat is freed/i);
  });

  it('emits leave once, carrying only the room id', async () => {
    const user = userEvent.setup();
    renderPlayerRoom();
    dispatch('lobby_update', lobbyUpdate({ state: 'CONFIGURING' }));

    await user.click(control(LEAVE));
    await user.click(control(CONFIRM));

    const payloads = emitsOf('leave');
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toEqual({ room_id: ROOM });
  });

  it('backs out without emitting anything', async () => {
    const user = userEvent.setup();
    renderPlayerRoom();
    dispatch('lobby_update', lobbyUpdate({ state: 'CONFIGURING' }));

    await user.click(control(LEAVE));
    await user.click(control(/^stay$/i));

    expect(emitsOf('leave')).toHaveLength(0);
    expect(control(LEAVE)).toBeInTheDocument();
  });

  it('drops the session token and leaves the room route once the server acks', async () => {
    const user = userEvent.setup();
    setSessionToken(ROOM, 'tok-seated');

    renderPlayerRoom();
    dispatch('lobby_update', lobbyUpdate({ state: 'CONFIGURING' }));

    await user.click(control(LEAVE));
    await user.click(control(CONFIRM));
    dispatch('leave_ack', { room_id: ROOM });

    // Keeping it would put this browser straight back into the room on the
    // next connect, because `rejoinAfterConnect` presents whatever is stored.
    expect(getSessionToken(ROOM)).toBeNull();
    expect(await screen.findByTestId('elsewhere')).toBeInTheDocument();
    expect(useGameStore.getState().roomCode).toBeNull();
  });

  it('hands the button back when the server refuses, rather than waiting forever', async () => {
    const user = userEvent.setup();
    renderPlayerRoom();
    dispatch('lobby_update', lobbyUpdate({ state: 'CONFIGURING' }));

    await user.click(control(LEAVE));
    await user.click(control(CONFIRM));

    // §3.3: a stale tab can reach the control a moment after the host starts.
    dispatch('join_error', { message: 'Cannot leave once the game has started.' });

    await waitFor(() => expect(isDisabled(control(LEAVE))).toBe(false));
  });
});
