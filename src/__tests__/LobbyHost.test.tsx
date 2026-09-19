/**
 * `17-frontend-lobby.md §2.0` and `§2.4` — `HostRoom.tsx`, the host-side shell
 * and the lobby it renders before the game starts.
 *
 * Covers acceptance criteria 15, 16, 17, 18, 19, 20, 21, 22, 24 (the host half),
 * 25 and 26, and failure modes 6, 8 and 9.
 *
 * The three that matter most here are 8, 9 and 18: a host tab that lost its
 * `host_secret` must neither fall through to the player join flow (which eats a
 * seat) nor show the recovery screen before the server has answered — showing it
 * early makes D18's whole recovery path invisible to the one person who needs it.
 *
 * Harness notes: as in `LobbyPlayer.test.tsx`, `socket.io-client` is a recorder
 * and `src/api/socketHandlers.ts` is imported for its side effect, reproducing
 * `main.tsx`'s registration (16 §4.3). `host_claimed` is therefore delivered to
 * the same handler the browser would deliver it to (16 §4.5). Controls are
 * located by the accessible names §2.4b freezes.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { StrictMode } from 'react';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { useGameStore } from '../store/gameStore';
import { getHostSecret, setHostSecret, setHostRoom } from '../utils/storage';
import type { Role } from '../types/game';
import type { RouteDescriptor } from '../routes/registry';
import * as HostRoomModule from '../pages/HostRoom';
import { configPanelScreen, hostConsoleScreen, resolveShellScreen } from '../pages/shellScreens';

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

/** §2.2's alphabet excludes 0, O, 1, I and L. */
const ROOM = 'ABC234';

// ---------------------------------------------------------------------------
// Wire helpers
// ---------------------------------------------------------------------------

function dispatch(event: string, payload?: unknown): void {
  const listeners = [...(rec.listeners.get(event) ?? [])];
  if (listeners.length === 0) {
    throw new Error(
      `Nothing is listening for "${event}". Section 16 §4.5 registers the lobby events as a ` +
        'module side effect, and §2.4 requires the host shell to act on host_claimed and join_error.',
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

const ALL_ROLES: Record<Role, string | null> = {
  RETAILER: 'P1',
  WHOLESALER: 'P2',
  DISTRIBUTOR: 'P3',
  FACTORY: 'P4',
};

const FOUR_PLAYERS = [
  participant({ alias: 'P1', display_name: 'Bea', role: 'RETAILER' }),
  participant({ alias: 'P2', display_name: 'Caro', role: 'WHOLESALER' }),
  participant({ alias: 'P3', display_name: 'Dee', role: 'DISTRIBUTOR' }),
  participant({ alias: 'P4', display_name: 'Eve', role: 'FACTORY' }),
];

/** `11 §2`: `start_blocked_reason` is null exactly when `can_start` is true. */
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

function startable(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return lobbyUpdate({
    state: 'READY',
    role_to_alias: { ...ALL_ROLES },
    participants: FOUR_PLAYERS,
    can_start: true,
    start_blocked_reason: null,
    ...overrides,
  });
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

function hostDescriptor(): RouteDescriptor {
  const found = descriptorsOf(HostRoomModule, 'HostRoom.tsx').find((d) => d.path === '/host/:roomCode');
  if (!found) throw new Error('HostRoom.tsx declares no descriptor for `/host/:roomCode` (17 §3.0).');
  return found;
}

function renderHostRoom({ strict = false }: { strict?: boolean } = {}) {
  const tree = (
    <MemoryRouter initialEntries={[`/host/${ROOM}`]}>
      <Routes>
        <Route path="/host/:roomCode" element={hostDescriptor().element} />
        <Route path="*" element={<div data-testid="elsewhere" />} />
      </Routes>
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

/** A tab that already holds the capability it was handed at creation. */
function armedTab(): void {
  setHostSecret(ROOM, 'hs-stored');
  setHostRoom(ROOM);
}

/** Drives the successful claim, so the lobby proper is on screen. */
function settleClaim(update: Record<string, unknown> = lobbyUpdate()): void {
  dispatch('host_claimed', { room_id: ROOM, host_secret: 'hs-from-server' });
  dispatch('lobby_update', update);
}

/**
 * Writes the store through section 16's applier, bypassing the wire entirely.
 *
 * `16 §3` puts `canStart`, `startBlockedReason` and `joinError` in the store
 * rather than leaving a screen to read them from its own `socket.on(...)`,
 * because a screen that subscribes directly is a second interpreter of the wire
 * — one StrictMode double-registers and a reconnect can leave stale. Driving the
 * applier with no socket event in flight is how a test tells the two designs
 * apart.
 */
function applyLobbyUpdate(update: Record<string, unknown>): void {
  act(() => {
    (useGameStore.getState() as unknown as { applyLobbyUpdate: (p: unknown) => void }).applyLobbyUpdate(update);
  });
}

function applyJoinError(message: string): void {
  act(() => {
    (useGameStore.getState() as unknown as { applyJoinError: (p: unknown) => void }).applyJoinError({ message });
  });
}

// ---------------------------------------------------------------------------
// Locating controls — §2.4b freezes every accessible name used below
// ---------------------------------------------------------------------------

const NAMES = {
  start: /^Start game$/i,
  copy: /^Copy invite link$/i,
  roleAssignment: /^Role assignment$/i,
} as const;

function startButton(): HTMLElement {
  return screen.getByRole('button', { name: NAMES.start });
}

function copyControl(): HTMLElement {
  return screen.getByRole('button', { name: NAMES.copy });
}

function isDisabled(el: HTMLElement): boolean {
  return el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
}

/**
 * The per-participant placement control, by the accessible name §2.4b freezes:
 * `Assign role for <display name>`. The widget behind that name is the
 * implementer's choice, so this accepts a select, a group of buttons, or a
 * single button — but it accepts no control that is not named this way.
 */
function assignControl(displayName: string): HTMLElement {
  const label = `Assign role for ${displayName}`;

  const labelled = document.querySelector(`[aria-label="${label}"]`);
  if (labelled) return labelled as HTMLElement;

  for (const role of ['combobox', 'group', 'button', 'listbox', 'radiogroup'] as const) {
    const found = screen.queryByRole(role, { name: label });
    if (found) return found as HTMLElement;
  }

  const element = Array.from(document.querySelectorAll('label')).find(
    (candidate) => (candidate.textContent ?? '').trim() === label,
  );
  if (element) {
    const target = element.getAttribute('for');
    const referenced = target ? document.getElementById(target) : null;
    if (referenced) return referenced;
    const inner = element.querySelector('select, button, input');
    if (inner) return inner as HTMLElement;
  }

  throw new Error(`No control carries the frozen accessible name "${label}" (17 §2.4b, AC 26).`);
}

/** Places a participant into a role through that control. */
async function placeInRole(user: ReturnType<typeof userEvent.setup>, displayName: string, role: Role) {
  const control = assignControl(displayName);

  if (control instanceof HTMLSelectElement) {
    const option = Array.from(control.options).find(
      (candidate) => candidate.value === role || new RegExp(role, 'i').test(candidate.textContent ?? ''),
    );
    if (!option) {
      throw new Error(`"Assign role for ${displayName}" offers no ${role} option (AC 26).`);
    }
    await user.selectOptions(control, option.value);
    return;
  }

  const inner = (Array.from(control.querySelectorAll('button, [role="button"], option')) as HTMLElement[]).find(
    (candidate) => new RegExp(role, 'i').test(candidate.textContent ?? ''),
  );
  if (inner) {
    await user.click(inner);
    return;
  }

  throw new Error(`"Assign role for ${displayName}" offers no way to choose ${role} (AC 26).`);
}

const RECOVERY = /isn.?t the host of that room/i;
const IN_FLIGHT = /reconnecting as host/i;
const SHELL_PLACEHOLDER = 'This screen is not available yet.';
const CONFIG_PLACEHOLDER = 'The settings panel is not available yet.';

beforeAll(async () => {
  await import('../api/socket');
  await import('../api/socketHandlers');
});

let clipboardWrites: string[] = [];
let execCommands: string[] = [];

beforeEach(() => {
  act(() => {
    useGameStore.getState().reset();
  });
  rec.emits.length = 0;

  clipboardWrites = [];
  execCommands = [];
  Object.defineProperty(window.navigator, 'clipboard', {
    value: {
      writeText: (text: string) => {
        clipboardWrites.push(String(text));
        return Promise.resolve();
      },
      readText: () => Promise.resolve(clipboardWrites[clipboardWrites.length - 1] ?? ''),
    },
    configurable: true,
    writable: true,
  });
  (document as unknown as { execCommand: (c: string) => boolean }).execCommand = (command: string) => {
    execCommands.push(command);
    return true;
  };
});

afterEach(() => {
  act(() => {
    useGameStore.getState().reset();
  });
});

// ---------------------------------------------------------------------------
// Criteria 15, 16 — the claim, with and without a stored secret
// ---------------------------------------------------------------------------

describe('CRITERION 15: the host lobby claims with the stored secret', () => {
  it('emits join_waiting carrying the host_secret this tab holds', () => {
    armedTab();

    renderHostRoom();

    const payloads = emitsOf('join_waiting');
    expect(payloads).toHaveLength(1);
    expect(payloads[0].room_id).toBe(ROOM);
    expect(payloads[0].host_secret).toBe('hs-stored');
  });

  it('claims once, even under StrictMode', () => {
    armedTab();

    renderHostRoom({ strict: true });

    expect(emitsOf('join_waiting')).toHaveLength(1);
  });

  it('never asserts host authority with a flag — only the secret proves it', () => {
    armedTab();
    renderHostRoom();

    const keys = emitsOf('join_waiting').flatMap((p) => Object.keys(p));
    expect(keys).not.toContain('is_host');
    expect(keys).not.toContain('identity');
  });
});

describe('CRITERION 16 / FAILURE MODE 8: a tab that lost its secret still claims', () => {
  it('emits join_waiting with no host_secret at all', () => {
    expect(getHostSecret(ROOM)).toBeNull();

    renderHostRoom();

    // D18: `host_secret` lives in sessionStorage and does not survive closing
    // the tab, and D3 means there is no account to fall back on. A client that
    // guards this emit on having a secret disables the recovery path entirely,
    // and the symptom is a permanently paused game.
    const payloads = emitsOf('join_waiting');
    expect(payloads).toHaveLength(1);
    expect(payloads[0].room_id).toBe(ROOM);
    expect(payloads[0].host_secret ?? null).toBeNull();
  });

  it('FAILURE MODE 8: does not fall through to the player join flow', () => {
    renderHostRoom();

    // Joining as a player would consume one of the four seats — in a room the
    // person actually owns.
    expect(emitsOf('join')).toHaveLength(0);
  });

  it('FAILURE MODE 8: still emits no player join after the claim is refused', () => {
    renderHostRoom();
    dispatch('join_error', { message: "This tab isn't the host of that room." });

    expect(emitsOf('join')).toHaveLength(0);
    expect(emitsOf('claim_role')).toHaveLength(0);
  });

  it('shows "Reconnecting as host…" while the claim is in flight', () => {
    renderHostRoom();

    expect(bodyText()).toMatch(IN_FLIGHT);
  });
});

describe('FAILURE MODE 9: the recovery screen is not shown before the server answers', () => {
  it('renders no refusal on mount, when nothing has been refused yet', () => {
    renderHostRoom();

    // Showing it immediately makes D18's recovery path invisible to the one
    // person who needs it: the host reads a transient state as a refusal and
    // walks away from a room they still own.
    expect(bodyText()).not.toMatch(RECOVERY);
  });

  it('renders no refusal after a successful host_claimed either', () => {
    renderHostRoom();
    settleClaim();

    expect(bodyText()).not.toMatch(RECOVERY);
  });

  it('the in-flight state is explanatory prose, not a bare spinner (CRITERION 22)', () => {
    renderHostRoom();

    const text = bodyText();
    expect(text).toMatch(IN_FLIGHT);
    expect(text.replace(/\s+/g, '').length).toBeGreaterThan(10);
  });

  it('store.joinError is what separates "refused" from "not answered yet"', () => {
    renderHostRoom();

    // 16 §3: before the first reply, "the server refused this tab's claim" and
    // "the server has not answered" look identical from the route and `isHost`
    // alone. `joinError` is the field that tells them apart, and D18's whole
    // recovery path depends on the distinction.
    expect(useGameStore.getState().joinError).toBeNull();
    expect(bodyText()).not.toMatch(RECOVERY);

    dispatch('join_error', { message: "This tab isn't the host of that room." });

    expect(useGameStore.getState().joinError).toBe("This tab isn't the host of that room.");
  });
});

// ---------------------------------------------------------------------------
// Criteria 17, 18 — what each answer does
// ---------------------------------------------------------------------------

describe('CRITERION 17: host_claimed re-arms the tab and the lobby renders', () => {
  it('stores the secret handed back by the server', () => {
    renderHostRoom();
    expect(getHostSecret(ROOM)).toBeNull();

    settleClaim();

    expect(getHostSecret(ROOM)).toBe('hs-from-server');
  });

  it('leaves the in-flight message behind and shows the room', () => {
    renderHostRoom();
    settleClaim();

    expect(bodyText()).not.toMatch(IN_FLIGHT);
    expect(bodyText()).toContain(ROOM);
  });

  it('presents the re-stored secret on the next privileged emit', async () => {
    const user = userEvent.setup();
    renderHostRoom();
    settleClaim(startable());

    await user.click(startButton());

    const payloads = emitsOf('start_game');
    expect(payloads).toHaveLength(1);
    expect(payloads[0].room_id).toBe(ROOM);
    expect(payloads[0].host_secret).toBe('hs-from-server');
  });
});

describe('CRITERION 18: join_error, and only join_error, shows the recovery screen', () => {
  it('renders the refusal with a way back to /home', async () => {
    renderHostRoom();
    dispatch('join_error', { message: "This tab isn't the host of that room." });

    await waitFor(() => expect(bodyText()).toMatch(RECOVERY));

    const home = Array.from(document.querySelectorAll('a')).filter(
      (a) => (a.getAttribute('href') ?? '').replace(/\/$/, '').endsWith('/home'),
    );
    expect(home.length).toBeGreaterThan(0);
  });

  it('emits no player join when it gives up', () => {
    renderHostRoom();
    dispatch('join_error', { message: "This tab isn't the host of that room." });

    expect(emitsOf('join')).toHaveLength(0);
  });

  it('stops showing the in-flight message once it has been answered', async () => {
    renderHostRoom();
    dispatch('join_error', { message: "This tab isn't the host of that room." });

    await waitFor(() => expect(bodyText()).toMatch(RECOVERY));
    expect(bodyText()).not.toMatch(IN_FLIGHT);
  });

  it('renders off store.joinError, not off a listener of its own', async () => {
    renderHostRoom();
    expect(bodyText()).not.toMatch(RECOVERY);

    // No socket event: only `applyJoinError`. A screen holding its own
    // `socket.on('join_error', ...)` would never leave the in-flight state.
    applyJoinError("This tab isn't the host of that room.");

    await waitFor(() => expect(bodyText()).toMatch(RECOVERY));
    expect(bodyText()).not.toMatch(IN_FLIGHT);
  });
});

// ---------------------------------------------------------------------------
// Criteria 19, 25 and failure mode 6 — Start is the server's decision
// ---------------------------------------------------------------------------

describe('CRITERION 19 / FAILURE MODE 6: a disabled Start button explains itself', () => {
  const TWO_EMPTY = 'Two roles are still empty. Assign them, or turn on bot fill.';

  function renderWithTwoEmptyRoles() {
    armedTab();
    renderHostRoom();
    settleClaim(
      lobbyUpdate({
        role_to_alias: { RETAILER: 'P1', WHOLESALER: 'P2', DISTRIBUTOR: null, FACTORY: null },
        participants: [
          participant({ alias: 'P1', display_name: 'Bea', role: 'RETAILER' }),
          participant({ alias: 'P2', display_name: 'Caro', role: 'WHOLESALER' }),
        ],
        can_start: false,
        start_blocked_reason: TWO_EMPTY,
      }),
    );
  }

  it('disables Start while the server says the room cannot start', () => {
    renderWithTwoEmptyRoles();

    expect(isDisabled(startButton())).toBe(true);
  });

  it('renders the blocking reason as text', () => {
    renderWithTwoEmptyRoles();

    // A disabled button with no explanation is the most common way a host
    // gets stuck.
    expect(bodyText()).toContain(TWO_EMPTY);
  });

  it('emits nothing when the disabled button is clicked', async () => {
    const user = userEvent.setup();
    renderWithTwoEmptyRoles();

    await user.click(startButton()).catch(() => undefined);

    expect(emitsOf('start_game')).toHaveLength(0);
  });
});

describe('CRITERION 25: Start follows can_start, and the reason is rendered verbatim', () => {
  it('is enabled exactly when can_start is true', async () => {
    const user = userEvent.setup();
    armedTab();
    renderHostRoom();
    settleClaim(startable());

    expect(isDisabled(startButton())).toBe(false);

    await user.click(startButton());
    const payloads = emitsOf('start_game');
    expect(payloads).toHaveLength(1);
    expect(payloads[0].room_id).toBe(ROOM);
    expect(payloads[0].host_secret).toBe('hs-from-server');
  });

  it('renders no blocking reason when start_blocked_reason is null', () => {
    armedTab();
    renderHostRoom();
    settleClaim(startable());

    expect(bodyText()).not.toMatch(/still empty/i);
    expect(bodyText()).not.toMatch(/bot fill/i);
  });

  it('derives no eligibility of its own: four filled roles but can_start false stays disabled', () => {
    // A client that re-derived the seat-filling rule would enable this button.
    // §3.0c: the client computes no eligibility of its own, because the rule
    // lives in `can_start(room)` and a second implementation drifts.
    const reason = 'The configuration has not been saved yet. Save it, then start.';
    armedTab();
    renderHostRoom();
    settleClaim(startable({ can_start: false, start_blocked_reason: reason }));

    expect(isDisabled(startButton())).toBe(true);
    // Verbatim: a sentence no client-side rule could have composed.
    expect(bodyText()).toContain(reason);
  });

  it('derives no eligibility of its own: no filled roles but can_start true is enabled', async () => {
    const user = userEvent.setup();
    armedTab();
    renderHostRoom();
    // Bot fill is on, so an empty room is startable — a fact only the server has.
    settleClaim(
      lobbyUpdate({
        role_to_alias: { ...EMPTY_ROLES },
        participants: [],
        can_start: true,
        start_blocked_reason: null,
      }),
    );

    expect(isDisabled(startButton())).toBe(false);

    await user.click(startButton());
    expect(emitsOf('start_game')).toHaveLength(1);
  });

  it('writes both fields into the store, where the button reads them (16 §3)', () => {
    const reason = 'One role is still empty. Assign it, or turn on bot fill.';
    armedTab();
    renderHostRoom();
    settleClaim(lobbyUpdate({ can_start: false, start_blocked_reason: reason }));

    expect(useGameStore.getState().canStart).toBe(false);
    expect(useGameStore.getState().startBlockedReason).toBe(reason);

    dispatch('lobby_update', startable({ seq: 2 }));

    expect(useGameStore.getState().canStart).toBe(true);
    expect(useGameStore.getState().startBlockedReason).toBeNull();
  });

  it('follows the store when nothing has come over the wire at all', () => {
    armedTab();
    renderHostRoom();
    settleClaim();
    expect(isDisabled(startButton())).toBe(true);

    // No socket event: only `applyLobbyUpdate`. A screen holding its own
    // `socket.on('lobby_update', ...)` would not see this and would stay
    // disabled.
    applyLobbyUpdate(startable({ seq: 2 }));

    expect(isDisabled(startButton())).toBe(false);
    expect(bodyText()).not.toMatch(/still empty/i);
  });

  it('follows the store back to disabled, reason and all', () => {
    const reason = 'The room is being reconfigured. Finish, then start.';
    armedTab();
    renderHostRoom();
    settleClaim(startable());
    expect(isDisabled(startButton())).toBe(false);

    applyLobbyUpdate(lobbyUpdate({ seq: 2, can_start: false, start_blocked_reason: reason }));

    expect(isDisabled(startButton())).toBe(true);
    expect(bodyText()).toContain(reason);
  });

  it('does not reword the reason it was given', () => {
    const reason = 'The Factory seat is empty. Assign it, or turn on bot fill.';
    armedTab();
    renderHostRoom();
    settleClaim(
      lobbyUpdate({
        role_to_alias: { RETAILER: 'P1', WHOLESALER: 'P2', DISTRIBUTOR: 'P3', FACTORY: null },
        participants: FOUR_PLAYERS.slice(0, 3),
        can_start: false,
        start_blocked_reason: reason,
      }),
    );

    expect(bodyText()).toContain(reason);
  });
});

// ---------------------------------------------------------------------------
// Criterion 26 — the two role-assignment controls
// ---------------------------------------------------------------------------

describe('CRITERION 26: the host changes the assignment mode and places participants', () => {
  it('the `Role assignment` selector emits set_role_mode with the host_secret', async () => {
    const user = userEvent.setup();
    armedTab();
    renderHostRoom();
    settleClaim();

    const selector = screen.getByRole('combobox', { name: NAMES.roleAssignment }) as HTMLSelectElement;
    const option = Array.from(selector.options).find(
      (o) => o.value === 'PLAYER_CHOOSES' || /player.?chooses/i.test(o.textContent ?? ''),
    );
    expect(option).toBeDefined();
    await user.selectOptions(selector, option!.value);

    const payloads = emitsOf('set_role_mode');
    expect(payloads).toHaveLength(1);
    expect(payloads[0].room_id).toBe(ROOM);
    expect(payloads[0].host_secret).toBe('hs-from-server');
    expect(payloads[0].mode).toBe('PLAYER_CHOOSES');
  });

  it('placing a participant in HOST_ASSIGNS emits assign_role by alias', async () => {
    const user = userEvent.setup();
    armedTab();
    renderHostRoom();
    settleClaim(
      lobbyUpdate({
        role_assignment_mode: 'HOST_ASSIGNS',
        participants: [participant({ alias: 'P1', display_name: 'Bea' })],
      }),
    );

    await placeInRole(user, 'Bea', 'DISTRIBUTOR');

    const payloads = emitsOf('assign_role');
    expect(payloads).toHaveLength(1);
    expect(payloads[0].room_id).toBe(ROOM);
    expect(payloads[0].host_secret).toBe('hs-from-server');
    // 00-conventions §2: the alias is the public id, and the only one on the wire.
    expect(payloads[0].alias).toBe('P1');
    expect(payloads[0].role).toBe('DISTRIBUTOR');
  });

  it('never puts a display name or an identity on a privileged emit', async () => {
    const user = userEvent.setup();
    armedTab();
    renderHostRoom();
    settleClaim(
      lobbyUpdate({
        role_assignment_mode: 'HOST_ASSIGNS',
        participants: [participant({ alias: 'P1', display_name: 'Bea' })],
      }),
    );

    await placeInRole(user, 'Bea', 'RETAILER');

    const keys = emitsOf('assign_role').flatMap((p) => Object.keys(p));
    expect(keys).not.toContain('identity');
    expect(keys).not.toContain('display_name');
  });
});

// ---------------------------------------------------------------------------
// Criterion 20 — the invite link
// ---------------------------------------------------------------------------

describe('CRITERION 20: copying the invite link', () => {
  function renderReady() {
    armedTab();
    renderHostRoom();
    settleClaim();
  }

  it('writes the whole URL, origin included', async () => {
    renderReady();

    fireEvent.click(copyControl());

    const expected = `${window.location.origin}/join/${ROOM}`;
    await waitFor(() => {
      const copiedToClipboard = clipboardWrites.includes(expected);
      const copiedByCommand =
        execCommands.includes('copy') &&
        Array.from(document.querySelectorAll('input, textarea')).some(
          (el) => (el as HTMLInputElement).value === expected,
        );
      expect(copiedToClipboard || copiedByCommand).toBe(true);
    });
  });

  it('confirms with the word "Copied" (§2.4b)', async () => {
    renderReady();

    fireEvent.click(copyControl());

    // A host copying a link and not knowing whether it worked is a real
    // failure during a class.
    await waitFor(() => expect(bodyText()).toContain('Copied'));
  });

  it('shows the room code itself, for a class reading it off a projector', () => {
    renderReady();

    expect(bodyText()).toContain(ROOM);
  });
});

// ---------------------------------------------------------------------------
// Criterion 21 — bots are labelled on the host side too
// ---------------------------------------------------------------------------

describe('CRITERION 21: the host participant list badges bots', () => {
  it('renders a Bot badge as text', () => {
    armedTab();
    renderHostRoom();
    settleClaim(
      lobbyUpdate({
        participants: [
          participant({ alias: 'P1', display_name: 'Bea', role: 'RETAILER' }),
          participant({ alias: 'P2', display_name: 'Factory bot', role: 'FACTORY', is_bot: true }),
        ],
        role_to_alias: { ...EMPTY_ROLES, RETAILER: 'P1', FACTORY: 'P2' },
      }),
    );

    const badges = screen.getAllByText(/^\s*bot\s*$/i);
    expect(badges.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Criterion 24 and §2.0 — three resolvers, two distinct placeholders
// ---------------------------------------------------------------------------

describe('CRITERION 24: the host shell resolves section 20 by discovery', () => {
  const CONSOLE = './HostConsole.tsx';

  it('resolves an absent console to null rather than a compile error', () => {
    // Asserted against an explicit module record, never against the live
    // `hostConsoleScreen()`: `import.meta.glob` is expanded at transform time,
    // so once section 20 shipped its file the live resolver can never return
    // null again. The two assertions this replaced said `toBeNull()` and
    // expected the placeholder, and were true for exactly as long as section
    // 20 did not exist -- the same expiring criterion as section 16's empty
    // route registry and section 01's Alembic table set.
    expect(resolveShellScreen({}, CONSOLE, 'HostConsole')).toBeNull();
    expect(resolveShellScreen({ [CONSOLE]: {} }, CONSOLE, 'HostConsole')).toBeNull();
  });

  it('renders the resolved console once the room is RUNNING, not the placeholder', () => {
    expect(hostConsoleScreen()).toBeTypeOf('function');

    armedTab();
    act(() => {
      useGameStore.setState({ roomState: 'RUNNING' });
    });

    renderHostRoom();

    expect(bodyText()).not.toContain(SHELL_PLACEHOLDER);
  });

  it('still claims the room in a state it cannot yet render', () => {
    armedTab();
    act(() => {
      useGameStore.setState({ roomState: 'PAUSED' });
    });

    renderHostRoom();

    expect(emitsOf('join_waiting')).toHaveLength(1);
    expect(emitsOf('join')).toHaveLength(0);
  });

  it('renders the host lobby, not the shell placeholder, before the game starts', () => {
    armedTab();
    renderHostRoom();
    settleClaim(lobbyUpdate({ state: 'CONFIGURING' }));

    expect(bodyText()).not.toContain(SHELL_PLACEHOLDER);
  });
});

describe('§2.0: the host lobby resolves section 18 by discovery too', () => {
  const PANEL = '../components/config/ConfigPanel.tsx';

  it('resolves an absent panel to null rather than a compile error', () => {
    // The settings panel had the same static-import problem as the two shells:
    // without a resolver, section 18 would have to edit HostLobby.tsx, which
    // D19 forbids. Asserted against an explicit module record, because the live
    // glob can never yield null again now that section 18 has shipped.
    expect(resolveShellScreen({}, PANEL, 'ConfigPanel')).toBeNull();
    expect(resolveShellScreen({ [PANEL]: {} }, PANEL, 'ConfigPanel')).toBeNull();
  });

  it('renders the resolved panel in the lobby, not its placeholder', () => {
    expect(configPanelScreen()).toBeTypeOf('function');

    armedTab();
    renderHostRoom();
    settleClaim();

    expect(bodyText()).not.toContain(CONFIG_PLACEHOLDER);
    expect(bodyText()).not.toContain(SHELL_PLACEHOLDER);
  });

  it('does not render the settings panel once the game is running', () => {
    armedTab();
    act(() => {
      useGameStore.setState({ roomState: 'RUNNING' });
    });

    renderHostRoom();

    expect(bodyText()).not.toContain(CONFIG_PLACEHOLDER);
  });
});
