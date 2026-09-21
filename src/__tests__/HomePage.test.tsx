/**
 * `17-frontend-lobby.md §2.2` — `/home`, the host-or-join screen, plus §3.0's
 * route declarations and §2.2's `/join/:roomCode` redirect.
 *
 * Covers acceptance criteria 3, 4, 5, 6, 7, 8, 9 and 27 (the `/home` half), and
 * failure modes 2 and 5.
 *
 * Harness notes:
 *  - The page is reached through the route descriptor it exports (§3.0).
 *  - `src/api/http.ts` is replaced by a recorder. Section 16 §3 names
 *    `rooms.ts` as section 10's REST client and `http.ts` as the axios
 *    instance underneath it, so recording at `http` observes the wire whether
 *    the page calls the client or the instance.
 *  - Controls are located by the accessible names §2.4b freezes — `Room code`,
 *    `Name to host as`, `Name to join as`, `Preset`, `Create game`,
 *    `Join game` — and by nothing else. The two name fields are distinct
 *    because §2.2 renders both panels at once.
 *  - Every room code used as a fixture is drawn from §2.2's alphabet,
 *    `ABCDEFGHJKMNPQRSTUVWXYZ23456789`. A code the field would itself reject is
 *    a code the server never mints.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';

import { AuthProvider } from '../auth/AuthContext';
import { BackendStatusProvider } from '../contexts/BackendStatusContext';
import { getDisplayName, getHostSecret, isHostForRoom } from '../utils/storage';
import { discoverRoutes, type RouteDescriptor } from '../routes/registry';
import * as HomePageModule from '../pages/HomePage';
import * as GameRoomModule from '../pages/GameRoom';

/** §2.2's alphabet excludes 0, O, 1, I and L. `ABC123` is not a room code. */
const ROOM = 'ABC234';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

type Listener = (...args: unknown[]) => void;

const rec = vi.hoisted(() => ({
  emits: [] as Array<{ event: string; payload: unknown }>,
  authCallbacks: [] as Array<(user: unknown) => void>,
}));

vi.mock('socket.io-client', () => {
  const listeners = new Map<string, Listener[]>();
  const socket: Record<string, unknown> = {
    id: 'test-sid',
    connected: false,
    on: (event: string, cb: Listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), cb]);
      return socket;
    },
    once: (event: string, cb: Listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), cb]);
      return socket;
    },
    off: (event: string, cb?: Listener) => {
      if (!cb) listeners.delete(event);
      else listeners.set(event, (listeners.get(event) ?? []).filter((l) => l !== cb));
      return socket;
    },
    removeAllListeners: () => {
      listeners.clear();
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
    onAuthStateChanged: vi.fn((_auth: unknown, cb: (user: unknown) => void) => {
      rec.authCallbacks.push(cb);
      return () => {};
    }),
    signInWithPopup: vi.fn(async () => ({ user: { uid: 'uid-1', displayName: 'Ana' } })),
    signOut: vi.fn(async () => undefined),
    GoogleAuthProvider: class {},
  }),
);

/** The three presets section 10 §2 declares, shaped as `PresetListResponse`. */
const PRESETS = [
  { name: 'CLASSIC_MIT', label: 'Classic MIT', description: 'The original.', config: {} },
  { name: 'FAST_GAME', label: 'Fast Game', description: 'A tight schedule.', config: {} },
  { name: 'CHAOS', label: 'Chaos', description: 'Volatile demand.', config: {} },
];

/** What the two room endpoints answer next. */
const backend = vi.hoisted(() => ({
  status: {} as Record<string, unknown>,
  create: {} as Record<string, unknown>,
}));

const httpRec = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  defaults: { baseURL: '/api/v1' },
}));

vi.mock('../api/http', () => ({
  default: httpRec,
  http: httpRec,
  errorMessage: (err: unknown, fallback: string) => {
    const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
    return typeof detail === 'string' ? detail : fallback;
  },
}));

const healthRec = vi.hoisted(() => ({ checkHealth: vi.fn(async () => true) }));
vi.mock('../api/health', () => healthRec);

// ---------------------------------------------------------------------------
// Route descriptors
// ---------------------------------------------------------------------------

function descriptorsOf(mod: unknown, label: string): RouteDescriptor[] {
  const route = (mod as { route?: RouteDescriptor | RouteDescriptor[] }).route;
  if (!route) {
    throw new Error(`${label} exports no \`route\` descriptor (17 §3.0, 16 §3 registry).`);
  }
  return Array.isArray(route) ? route : [route];
}

function homeDescriptor(): RouteDescriptor {
  const found = descriptorsOf(HomePageModule, 'HomePage.tsx').find((d) => d.path === '/home');
  if (!found) throw new Error('HomePage.tsx declares no descriptor for `/home` (17 §3.0).');
  return found;
}

// ---------------------------------------------------------------------------
// Locating controls — §2.4b freezes every accessible name used below
// ---------------------------------------------------------------------------

const NAMES = {
  roomCode: /^Room code$/i,
  hostName: /^Name to host as$/i,
  joinName: /^Name to join as$/i,
  preset: /^Preset$/i,
  create: /^Create game$/i,
  join: /^Join game$/i,
} as const;

function createButton(): HTMLElement {
  return screen.getByRole('button', { name: NAMES.create });
}

function joinButton(): HTMLElement {
  return screen.getByRole('button', { name: NAMES.join });
}

function codeInput(): HTMLInputElement {
  return screen.getByRole('textbox', { name: NAMES.roomCode }) as HTMLInputElement;
}

/**
 * §2.2 places the host panel and the join panel side by side, so the two name
 * fields are on screen together and §2.4b gives them distinct names. Each
 * `getByRole` below therefore resolves to exactly one input, and would throw if
 * the two names were ever merged again.
 */
function hostNameInput(): HTMLInputElement {
  return screen.getByRole('textbox', { name: NAMES.hostName }) as HTMLInputElement;
}

function joinNameInput(): HTMLInputElement {
  return screen.getByRole('textbox', { name: NAMES.joinName }) as HTMLInputElement;
}

async function typeInto(user: ReturnType<typeof userEvent.setup>, input: HTMLInputElement, value: string) {
  await user.clear(input);
  await user.type(input, value);
}

/** Selects a preset from the `Preset` picker, whichever widget it is built as. */
async function choosePreset(user: ReturnType<typeof userEvent.setup>, preset: { name: string; label: string }) {
  const combo = screen.queryByRole('combobox', { name: NAMES.preset }) as HTMLSelectElement | null;
  if (combo) {
    const options = Array.from(combo.querySelectorAll('option'));
    const match = options.find(
      (o) => o.value === preset.name || (o.textContent ?? '').toLowerCase().includes(preset.label.toLowerCase()),
    );
    if (!match) throw new Error(`The \`Preset\` picker offers no "${preset.label}" (17 §2.2, AC 4).`);
    await user.selectOptions(combo, match.value);
    return;
  }
  for (const role of ['radio', 'option', 'button'] as const) {
    const control = screen.queryByRole(role, { name: new RegExp(preset.label, 'i') });
    if (control) {
      await user.click(control);
      return;
    }
  }
  throw new Error(`No \`Preset\` control offers "${preset.label}" (17 §2.2, §2.4b, AC 4).`);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Every render the router made, with the tab-scoped secret as it was then. */
const seen: Array<{ pathname: string; hostSecretForRoom: string | null }> = [];

function LocationProbe() {
  const location = useLocation();
  // Recorded during render: this is *the moment the route changes*, which is
  // what failure mode 2 is about.
  seen.push({ pathname: location.pathname, hostSecretForRoom: getHostSecret(ROOM) });
  return null;
}

function RoomProbe({ label }: { label: string }) {
  const params = useParams();
  return <div data-testid={label}>{params.roomCode ?? ''}</div>;
}

function resolveAuthState(user: unknown = null): void {
  act(() => {
    for (const cb of [...rec.authCallbacks]) cb(user);
  });
}

function renderHome() {
  const result = render(
    <MemoryRouter initialEntries={['/home']}>
      <AuthProvider>
        <BackendStatusProvider>
          <LocationProbe />
          <Routes>
            <Route path="/home" element={homeDescriptor().element} />
            <Route path="/host/:roomCode" element={<RoomProbe label="host-room" />} />
            <Route path="/game/:roomCode" element={<RoomProbe label="game-room" />} />
            <Route path="*" element={<div data-testid="elsewhere" />} />
          </Routes>
        </BackendStatusProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
  resolveAuthState({ uid: 'uid-1', displayName: 'Ana', email: 'ana@example.com', photoURL: null });
  return result;
}

function currentPath(): string {
  return seen[seen.length - 1]?.pathname ?? '';
}

function visitedGameRoom(): boolean {
  return seen.some((s) => s.pathname.startsWith('/game/'));
}

function bodyText(): string {
  return (document.body.textContent ?? '').replace(/\s+/g, ' ');
}

/**
 * Every key and value in a Web Storage area.
 *
 * `JSON.stringify(localStorage)` does NOT do this: a `Storage` exposes its
 * entries through `key()`/`getItem()`, not as own enumerable properties, so it
 * serialises to `{"length":N}` and an assertion against it can neither find a
 * value nor fail to find one.
 */
function dumpStorage(area: Storage): string {
  const entries: string[] = [];
  for (let i = 0; i < area.length; i += 1) {
    const key = area.key(i);
    if (key === null) continue;
    entries.push(`${key}=${area.getItem(key) ?? ''}`);
  }
  return entries.join('\n');
}

/** Fills the join panel and submits it. */
async function join(user: ReturnType<typeof userEvent.setup>, code: string, name = 'Bea') {
  const input = codeInput();
  await user.clear(input);
  await user.type(input, code);
  await typeInto(user, joinNameInput(), name);
  await user.click(joinButton());
}

beforeEach(() => {
  seen.length = 0;
  rec.emits.length = 0;
  rec.authCallbacks.length = 0;
  backend.status = { ok: true, room_code: ROOM, state: 'LOBBY', host_display_name: 'Ana' };
  backend.create = { room_code: ROOM, host_secret: 'hs-from-create', state: 'LOBBY', config: {} };

  httpRec.get.mockReset();
  httpRec.post.mockReset();
  httpRec.get.mockImplementation(async (url: string) => {
    if (/presets/.test(url)) return { data: { presets: PRESETS } };
    if (/status/.test(url)) return { data: backend.status };
    return { data: {} };
  });
  httpRec.post.mockImplementation(async (url: string) => {
    if (/rooms\/create/.test(url)) return { data: backend.create };
    return { data: {} };
  });
});

// ---------------------------------------------------------------------------
// §3.0 — the six pages declare themselves
// ---------------------------------------------------------------------------

describe('17 §3.0: every page registers itself with section 16 discovery', () => {
  it('declares the six routes this section owns, with the stated guards', () => {
    const routes = discoverRoutes();
    const guardFor = (path: string) => routes.find((r) => r.path === path)?.guard ?? '(absent)';

    expect(guardFor('/')).toBe('public');
    expect(guardFor('/player-manual')).toBe('public');
    expect(guardFor('/host-manual')).toBe('public');
    expect(guardFor('/home')).toBe('auth+backend');
    expect(guardFor('/host/:roomCode')).toBe('auth+backend');
    expect(guardFor('/game/:roomCode')).toBe('auth+backend');
  });

  it('GameRoom.tsx exports two descriptors, the redirect being public', () => {
    const descriptors = descriptorsOf(GameRoomModule, 'GameRoom.tsx');
    const paths = descriptors.map((d) => d.path).sort();
    expect(paths).toEqual(['/game/:roomCode', '/join/:roomCode']);

    // §3.0: the redirect only forwards, and the destination guards itself.
    const redirect = descriptors.find((d) => d.path === '/join/:roomCode');
    expect(redirect?.guard).toBe('public');
  });
});

// ---------------------------------------------------------------------------
// Criteria 3 and 4, failure mode 2 — hosting a game
// ---------------------------------------------------------------------------

describe('CRITERION 3 / FAILURE MODE 2: the host_secret is persisted before navigating', () => {
  it('has the secret in sessionStorage at the moment /host/:roomCode renders', async () => {
    const user = userEvent.setup();
    renderHome();

    expect(getHostSecret(ROOM)).toBeNull();

    await typeInto(user, hostNameInput(), 'Ana');
    await user.click(createButton());

    await screen.findByTestId('host-room');

    // Section 10 §3.1 returns `host_secret` exactly once. A navigate that runs
    // before the write loses the room outright, and the symptom — a host with
    // no controls — appears minutes later, in front of a class.
    const firstHostRender = seen.find((s) => s.pathname === `/host/${ROOM}`);
    expect(firstHostRender).toBeDefined();
    expect(firstHostRender?.hostSecretForRoom).toBe('hs-from-create');
  });

  it('navigates to the room it just created and marks the tab as its host', async () => {
    const user = userEvent.setup();
    renderHome();

    await user.click(createButton());
    await screen.findByTestId('host-room');

    expect(screen.getByTestId('host-room')).toHaveTextContent(ROOM);
    expect(currentPath()).toBe(`/host/${ROOM}`);
    // D3: the host claim held client-side is a UI hint; the secret is authority.
    expect(isHostForRoom(ROOM)).toBe(true);
  });

  it('never writes the host_secret to localStorage, which survives the tab', async () => {
    const user = userEvent.setup();
    renderHome();

    await user.click(createButton());
    await screen.findByTestId('host-room');

    // 16 §3: the host_secret is sessionStorage, tab-scoped. localStorage would
    // leave the capability behind for whoever opens the browser next.
    expect(dumpStorage(window.localStorage)).not.toContain('hs-from-create');
    expect(dumpStorage(window.sessionStorage)).toContain('hs-from-create');
  });

  it('sends the host display name as `host_display_name` (section 10 §2)', async () => {
    const user = userEvent.setup();
    renderHome();

    await typeInto(user, hostNameInput(), 'Ana');
    await user.click(createButton());

    await waitFor(() => expect(httpRec.post).toHaveBeenCalled());
    const call = httpRec.post.mock.calls.find(([url]) => /rooms\/create/.test(String(url)));
    const body = (call?.[1] ?? {}) as Record<string, unknown>;
    expect(body.host_display_name).toBe('Ana');
  });
});

describe('CRITERION 4: creating with a preset sends that preset name', () => {
  it('offers the presets the backend returned and posts the chosen name', async () => {
    const user = userEvent.setup();
    renderHome();

    await waitFor(() => {
      expect(httpRec.get.mock.calls.some(([url]) => /presets/.test(String(url)))).toBe(true);
    });
    await waitFor(() => expect(bodyText()).toMatch(/fast game/i));

    await choosePreset(user, PRESETS[1]);
    await user.click(createButton());

    await waitFor(() => expect(httpRec.post).toHaveBeenCalled());
    const call = httpRec.post.mock.calls.find(([url]) => /rooms\/create/.test(String(url)));
    expect(call).toBeDefined();
    const body = (call?.[1] ?? {}) as Record<string, unknown>;
    expect(body.preset).toBe('FAST_GAME');
  });

  it('omits the preset when none was chosen — it is optional (§2.2)', async () => {
    const user = userEvent.setup();
    renderHome();

    await user.click(createButton());

    await waitFor(() => expect(httpRec.post).toHaveBeenCalled());
    const call = httpRec.post.mock.calls.find(([url]) => /rooms\/create/.test(String(url)));
    const body = (call?.[1] ?? {}) as Record<string, unknown>;
    expect(body.preset ?? null).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Criteria 5, 6, 7 — joining, and the three reasons a room refuses
// ---------------------------------------------------------------------------

describe('joining a game reads GET /rooms/{code}/status and acts on the reason', () => {
  it('CRITERION 5: an unknown code shows an inline error and does not navigate', async () => {
    backend.status = { ok: false, reason: 'Room does not exist.' };
    const user = userEvent.setup();
    renderHome();

    await join(user, 'ZZZZZZ');

    await waitFor(() => expect(bodyText()).toMatch(/room does not exist/i));
    expect(visitedGameRoom()).toBe(false);
    expect(currentPath()).toBe('/home');
  });

  it('CRITERION 6: a full room names the host, so the player knows the code was right', async () => {
    backend.status = {
      ok: false,
      reason: 'Room is full.',
      room_code: ROOM,
      host_display_name: 'Ana',
      seats_taken: 4,
      seats_total: 4,
    };
    const user = userEvent.setup();
    renderHome();

    await join(user, ROOM);

    await waitFor(() => expect(bodyText()).toMatch(/room is full/i));
    expect(bodyText()).toMatch(/Ana/);
    expect(visitedGameRoom()).toBe(false);
  });

  it('CRITERION 7: a started room offers the rejoin hint', async () => {
    backend.status = {
      ok: false,
      reason: 'This game has already started.',
      room_code: ROOM,
      state: 'RUNNING',
      host_display_name: 'Ana',
    };
    const user = userEvent.setup();
    renderHome();

    await join(user, ROOM);

    await waitFor(() => expect(bodyText()).toMatch(/already started/i));
    // §2.2: "If you were already playing, open your original link — you can rejoin."
    expect(bodyText()).toMatch(/original link/i);
    expect(bodyText()).toMatch(/rejoin/i);
    expect(visitedGameRoom()).toBe(false);
  });

  it('a joinable room navigates to /game/{code}', async () => {
    backend.status = { ok: true, room_code: ROOM, state: 'LOBBY', host_display_name: 'Ana' };
    const user = userEvent.setup();
    renderHome();

    await join(user, ROOM);

    await screen.findByTestId('game-room');
    expect(screen.getByTestId('game-room')).toHaveTextContent(ROOM);
    expect(currentPath()).toBe(`/game/${ROOM}`);
  });

  it('asks the backend about the code the player actually typed', async () => {
    const user = userEvent.setup();
    renderHome();

    await join(user, ROOM);

    await waitFor(() => {
      expect(httpRec.get.mock.calls.some(([url]) => String(url).includes(ROOM) && /status/.test(String(url)))).toBe(
        true,
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Criterion 27 — the display name survives the page
// ---------------------------------------------------------------------------

describe('CRITERION 27: the display name entered on /home is persisted', () => {
  it('§2.4b: the two panels are on screen together, under distinct names', () => {
    renderHome();

    // `getByRole` throws on more than one match, so this test fails the moment
    // the two fields share a name again — the ambiguity §2.4b records.
    const host = hostNameInput();
    const joinName = joinNameInput();

    expect(host).not.toBe(joinName);
    expect(host).toBeInTheDocument();
    expect(joinName).toBeInTheDocument();
  });

  it('writes it through storage.setDisplayName, where section 16 can read it back', async () => {
    const user = userEvent.setup();
    renderHome();

    expect(getDisplayName()).toBeNull();

    await join(user, ROOM, 'Bea');

    // §3.0b: router navigation state does not survive a reload, so the name is
    // persisted — and in section 16's `storage.ts`, because that section's
    // `rejoinAfterConnect` emits it too.
    await waitFor(() => expect(getDisplayName()).toBe('Bea'));
  });

  it('keeps it in localStorage, not sessionStorage — it is not tab-scoped', async () => {
    const user = userEvent.setup();
    renderHome();

    await join(user, ROOM, 'Bea');

    await waitFor(() => expect(getDisplayName()).toBe('Bea'));
    // 16 §3 puts it in localStorage: it is display data, not a credential, and
    // it has to survive the reload that AC 27 is about.
    expect(dumpStorage(window.localStorage)).toContain('Bea');
    expect(dumpStorage(window.sessionStorage)).not.toContain('Bea');
  });
});

// ---------------------------------------------------------------------------
// Criterion 8 and failure mode 5 — the unambiguous alphabet
// ---------------------------------------------------------------------------

describe('CRITERION 8 / FAILURE MODE 5: the room-code alphabet', () => {
  it('uppercases as the user types', async () => {
    const user = userEvent.setup();
    renderHome();

    const input = codeInput();
    await user.type(input, 'ab2');

    expect(input.value).toBe('AB2');
  });

  it('rejects 0, O, 1, I and L outright', async () => {
    const user = userEvent.setup();
    renderHome();

    const input = codeInput();
    // The alphabet is ABCDEFGHJKMNPQRSTUVWXYZ23456789: codes get read aloud,
    // and silently accepting an O for a 0 wastes the whole room's time.
    await user.type(input, 'o0i1lXyZ');

    expect(input.value).toBe('XYZ');
    expect(input.value).not.toMatch(/[0O1IL]/);
  });

  it('never carries a rejected character through to the backend', async () => {
    const user = userEvent.setup();
    renderHome();

    const input = codeInput();
    await user.type(input, 'ABO0C1D');
    await user.click(joinButton());

    await waitFor(() => expect(httpRec.get.mock.calls.some(([url]) => /status/.test(String(url)))).toBe(true));
    const call = httpRec.get.mock.calls.find(([url]) => /status/.test(String(url)));
    expect(String(call?.[0])).not.toMatch(/[0O1IL]/);
    expect(String(call?.[0])).toContain('ABCD');
  });
});

// ---------------------------------------------------------------------------
// Criterion 9 — the invite link works in either form
// ---------------------------------------------------------------------------

describe('CRITERION 9: /join/:roomCode redirects to /game/:roomCode', () => {
  it('lands on the player route with the same code', async () => {
    const descriptors = descriptorsOf(GameRoomModule, 'GameRoom.tsx');
    const joinRoute = descriptors.find((d) => d.path === '/join/:roomCode');
    expect(joinRoute).toBeDefined();

    render(
      <MemoryRouter initialEntries={[`/join/${ROOM}`]}>
        <LocationProbe />
        <Routes>
          <Route path={joinRoute!.path} element={joinRoute!.element} />
          <Route path="/game/:roomCode" element={<RoomProbe label="game-room" />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByTestId('game-room');
    expect(screen.getByTestId('game-room')).toHaveTextContent(ROOM);
    expect(currentPath()).toBe(`/game/${ROOM}`);
  });
});
