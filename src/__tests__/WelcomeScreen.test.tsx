/**
 * `17-frontend-lobby.md §2.1` — `/`, the public welcome screen.
 *
 * Covers acceptance criteria 1, 2 and 27 (the guest-path half).
 *
 * Harness notes:
 *  - The page is reached through the route descriptor it exports (§3.0), which
 *    is the only entry point this section declares. Nothing here imports a
 *    component by name.
 *  - `socket.io-client` and `firebase/*` are replaced by recorders so the page
 *    is exercised as real, un-mocked code while nothing touches transport.
 *  - `src/api/http.ts` is replaced by a recorder whose *only* job here is to
 *    prove criterion 1's "with no backend": if the welcome screen ever calls
 *    the API, the recorder has a call on it.
 *  - `§3` of section 16 fixes the composition — `App` mounts no router and no
 *    provider — so every render below supplies `<MemoryRouter>` and the auth
 *    provider itself, exactly as `main.tsx` does.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { AuthProvider } from '../auth/AuthContext';
import { getDisplayName, getGuestId } from '../utils/storage';
import type { RouteDescriptor } from '../routes/registry';
import * as WelcomeScreenModule from '../pages/WelcomeScreen';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

type Listener = (...args: unknown[]) => void;

const rec = vi.hoisted(() => ({
  emits: [] as Array<{ event: string; payload: unknown }>,
  /** every callback handed to `onAuthStateChanged` */
  authCallbacks: [] as Array<(user: unknown) => void>,
  signInCalls: 0,
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
    onAuthStateChanged: vi.fn((_auth: unknown, cb: (user: unknown) => void) => {
      rec.authCallbacks.push(cb);
      return () => {};
    }),
    signInWithPopup: vi.fn(async () => {
      rec.signInCalls += 1;
      return { user: { uid: 'uid-1', displayName: 'Ana' } };
    }),
    signOut: vi.fn(async () => undefined),
    GoogleAuthProvider: class {},
  }),
);

const httpRec = vi.hoisted(() => {
  const ok = async (): Promise<{ data: Record<string, unknown> }> => ({ data: {} });
  return {
    get: vi.fn(ok),
    post: vi.fn(ok),
    put: vi.fn(ok),
    delete: vi.fn(ok),
    defaults: { baseURL: '/api/v1' },
  };
});

vi.mock('../api/http', () => ({
  default: httpRec,
  http: httpRec,
  errorMessage: (_err: unknown, fallback: string) => fallback,
}));

const healthRec = vi.hoisted(() => ({ checkHealth: vi.fn(async () => true) }));
vi.mock('../api/health', () => healthRec);

// ---------------------------------------------------------------------------
// Route descriptor and rendering
// ---------------------------------------------------------------------------

function descriptorsOf(mod: unknown, label: string): RouteDescriptor[] {
  const route = (mod as { route?: RouteDescriptor | RouteDescriptor[] }).route;
  if (!route) {
    throw new Error(`${label} exports no \`route\` descriptor (17 §3.0, 16 §3 registry).`);
  }
  return Array.isArray(route) ? route : [route];
}

function welcomeDescriptor(): RouteDescriptor {
  const found = descriptorsOf(WelcomeScreenModule, 'WelcomeScreen.tsx').find((d) => d.path === '/');
  if (!found) throw new Error('WelcomeScreen.tsx declares no descriptor for `/` (17 §3.0).');
  return found;
}

/** Every location the router has rendered, in order. */
const seen: Array<{ pathname: string; search: string; hash: string }> = [];

function LocationProbe() {
  const location = useLocation();
  seen.push({ pathname: location.pathname, search: location.search, hash: location.hash });
  return null;
}

/** Resolves the Firebase auth state, which is what ends `AuthContext`'s loading. */
function resolveAuthState(user: unknown = null): void {
  act(() => {
    for (const cb of [...rec.authCallbacks]) cb(user);
  });
}

type Entry = string | { pathname: string; state?: unknown };

function renderWelcome(entry: Entry = '/') {
  const result = render(
    <MemoryRouter initialEntries={[entry as never]}>
      <AuthProvider>
        <LocationProbe />
        <Routes>
          <Route path="/" element={welcomeDescriptor().element} />
          <Route path="*" element={<div data-testid="elsewhere" />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
  resolveAuthState(null);
  return result;
}

/** The last pathname the router settled on. */
function currentPath(): string {
  return seen[seen.length - 1]?.pathname ?? '';
}

/** The last location, rendered the way a browser address bar would show it. */
function currentHref(): string {
  const last = seen[seen.length - 1];
  return last ? `${last.pathname}${last.search}${last.hash}` : '';
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

function anchorsTo(href: string): HTMLAnchorElement[] {
  return Array.from(document.querySelectorAll('a')).filter((a) => {
    const value = a.getAttribute('href') ?? '';
    return value === href || value.endsWith(href);
  });
}

beforeEach(() => {
  seen.length = 0;
  rec.emits.length = 0;
  rec.authCallbacks.length = 0;
  rec.signInCalls = 0;
  httpRec.get.mockClear();
  httpRec.post.mockClear();
});

// ---------------------------------------------------------------------------
// Criterion 1 — the two identity choices, both manual links, no backend
// ---------------------------------------------------------------------------

describe('CRITERION 1: WelcomeScreen renders with no backend', () => {
  it('declares a public route descriptor for `/` (17 §3.0)', () => {
    const descriptor = welcomeDescriptor();
    expect(descriptor.path).toBe('/');
    expect(descriptor.guard).toBe('public');
  });

  it('renders both identity choices', () => {
    renderWelcome();

    // §2.1: "Two identity choices and nothing else."
    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue as .*guest/i })).toBeInTheDocument();
  });

  it('renders a link to each manual', () => {
    renderWelcome();

    expect(anchorsTo('/player-manual').length).toBeGreaterThan(0);
    expect(anchorsTo('/host-manual').length).toBeGreaterThan(0);
  });

  it('makes no API call and opens no socket — the screen is public and backend-free', () => {
    renderWelcome();

    expect(httpRec.get).not.toHaveBeenCalled();
    expect(httpRec.post).not.toHaveBeenCalled();
    expect(rec.emits).toHaveLength(0);
  });

  it('explains what the game is in prose, not marketing boilerplate', () => {
    renderWelcome();

    // §2.1: "One short paragraph explaining what the game is".
    const text = (document.body.textContent ?? '').replace(/\s+/g, ' ').trim();
    expect(text.length).toBeGreaterThan(80);
  });
});

// ---------------------------------------------------------------------------
// Criterion 2 — the guest path
// ---------------------------------------------------------------------------

describe('CRITERION 2: continuing as a guest', () => {
  it('mints a guest id and lands on /home when there is no `state.from`', async () => {
    const user = userEvent.setup();
    renderWelcome('/');

    expect(getGuestId()).toBeNull();

    await user.click(screen.getByRole('button', { name: /continue as .*guest/i }));

    // 00-conventions §2: the guest identity is `guest_<uuid4>`, minted once.
    expect(getGuestId()).toBeTruthy();
    expect(currentPath()).toBe('/home');
  });

  it('returns to `state.from` when a guard bounced the visitor here', async () => {
    const user = userEvent.setup();
    // §2.1 freezes `state.from` as a react-router `Location` object, exactly as
    // 16 §4.8's `AuthGuard` forwards it — not a bare pathname — so that the
    // query string and the hash survive the round trip.
    renderWelcome({
      pathname: '/',
      state: {
        from: { pathname: '/game/ABC234', search: '?seat=RETAILER', hash: '#board', state: null, key: 'k' },
      },
    });

    await user.click(screen.getByRole('button', { name: /continue as .*guest/i }));

    expect(getGuestId()).toBeTruthy();
    expect(currentPath()).toBe('/game/ABC234');
    expect(currentPath()).not.toBe('/home');
  });

  it('carries the query string and hash back with it, which a bare pathname would drop', async () => {
    const user = userEvent.setup();
    renderWelcome({
      pathname: '/',
      state: {
        from: { pathname: '/game/ABC234', search: '?seat=RETAILER', hash: '#board', state: null, key: 'k' },
      },
    });

    await user.click(screen.getByRole('button', { name: /continue as .*guest/i }));

    expect(currentHref()).toBe('/game/ABC234?seat=RETAILER#board');
  });

  it('the Google button is wired to sign-in rather than being decorative', async () => {
    const user = userEvent.setup();
    renderWelcome();

    await user.click(screen.getByRole('button', { name: /sign in with google/i }));

    // `signInWithGoogle()` is section 16's; all this asserts is that the
    // welcome screen calls it instead of navigating on its own authority.
    expect(rec.signInCalls).toBeGreaterThan(0);
  });

  it('never mints a guest id merely by being visited', () => {
    renderWelcome();
    expect(getGuestId()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Criterion 27 — the guest path's half of the display name
// ---------------------------------------------------------------------------

describe('CRITERION 27: the guest path collects and persists a name', () => {
  /**
   * §2.1: the name field is part of the guest choice — "two identity choices
   * and nothing else" constrains the choices, not the fields inside them.
   * §2.4b freezes its accessible name as `Your name`.
   */
  function guestNameInput(): HTMLInputElement {
    return screen.getByRole('textbox', { name: /^Your name$/i }) as HTMLInputElement;
  }

  it('persists the name with setDisplayName, so an invite link lands with one', async () => {
    const user = userEvent.setup();
    renderWelcome();

    expect(getDisplayName()).toBeNull();

    await user.type(guestNameInput(), 'Cara');
    await user.click(screen.getByRole('button', { name: /continue as .*guest/i }));

    // §2.1: "so a guest who follows an invite link straight into a room already
    // has one" — which is section 17's `join` emit, and section 16's
    // `rejoinAfterConnect` after that.
    await waitFor(() => expect(getDisplayName()).toBe('Cara'));
  });

  it('keeps the name in localStorage, where it survives the reload AC 27 is about', async () => {
    const user = userEvent.setup();
    renderWelcome();

    await user.type(guestNameInput(), 'Cara');
    await user.click(screen.getByRole('button', { name: /continue as .*guest/i }));

    await waitFor(() => expect(getDisplayName()).toBe('Cara'));
    expect(dumpStorage(window.localStorage)).toContain('Cara');
    expect(dumpStorage(window.sessionStorage)).not.toContain('Cara');
  });

  it('still navigates once the guest identity is chosen', async () => {
    const user = userEvent.setup();
    renderWelcome();

    await user.type(guestNameInput(), 'Cara');
    await user.click(screen.getByRole('button', { name: /continue as .*guest/i }));

    expect(getGuestId()).toBeTruthy();
    expect(currentPath()).toBe('/home');
  });
});
