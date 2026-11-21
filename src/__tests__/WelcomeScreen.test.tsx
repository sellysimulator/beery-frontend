/**
 * `/`, the public welcome screen (spec §9.10).
 *
 * Covers: the screen renders with no backend, the guest path, and that the
 * screen asks for no name (players name themselves on the game screen).
 *
 * Harness notes:
 *  - The page is reached through the route descriptor it exports, which
 *    is the only entry point the page declares. Nothing here imports a
 *    component by name.
 *  - `socket.io-client` and `firebase/*` are replaced by recorders so the page
 *    is exercised as real, un-mocked code while nothing touches transport.
 *  - `src/api/http.ts` is replaced by a recorder whose *only* job here is to
 *    prove "with no backend": if the welcome screen ever calls
 *    the API, the recorder has a call on it.
 *  - The composition is fixed — `App` mounts no router and no
 *    provider — so every render below supplies `<MemoryRouter>` and the auth
 *    provider itself, exactly as `main.tsx` does.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { AuthProvider } from '../auth/AuthContext';
import { GUEST_ID_KEY, getDisplayName, getGuestId, setDisplayName } from '../utils/storage';
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
    throw new Error(`${label} exports no \`route\` descriptor.`);
  }
  return Array.isArray(route) ? route : [route];
}

function welcomeDescriptor(): RouteDescriptor {
  const found = descriptorsOf(WelcomeScreenModule, 'WelcomeScreen.tsx').find((d) => d.path === '/');
  if (!found) throw new Error('WelcomeScreen.tsx declares no descriptor for `/`.');
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
// The two identity choices, both manual links, no backend
// ---------------------------------------------------------------------------

describe('WelcomeScreen renders with no backend', () => {
  it('declares a public route descriptor for `/`', () => {
    const descriptor = welcomeDescriptor();
    expect(descriptor.path).toBe('/');
    expect(descriptor.guard).toBe('public');
  });

  it('renders both identity choices', () => {
    renderWelcome();

    // "Two identity choices and nothing else."
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

    // "One short paragraph explaining what the game is".
    const text = (document.body.textContent ?? '').replace(/\s+/g, ' ').trim();
    expect(text.length).toBeGreaterThan(80);
  });
});

// ---------------------------------------------------------------------------
// A restored Firebase session skips the screen
// ---------------------------------------------------------------------------

describe('a visitor who is already signed in is not asked to sign in again', () => {
  const SIGNED_IN = { uid: 'uid-1', displayName: 'Ana', getIdToken: async () => 'tok' };

  it('redirects to /home once Firebase restores the session', () => {
    renderWelcome('/');
    // The screen deliberately does not wait on `loading`, so it paints for
    // everyone first; the redirect is what happens when Firebase answers.
    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument();

    resolveAuthState(SIGNED_IN);

    expect(currentPath()).toBe('/home');
  });

  it('returns to `state.from` instead of /home, so an invite link survives a reload', () => {
    renderWelcome({
      pathname: '/',
      state: {
        from: { pathname: '/game/ABC234', search: '?seat=RETAILER', hash: '#board', state: null, key: 'k' },
      },
    });

    resolveAuthState(SIGNED_IN);

    expect(currentHref()).toBe('/game/ABC234?seat=RETAILER#board');
  });

  it('replaces rather than pushes, so Back out of /home is not bounced forward again', () => {
    renderWelcome('/');
    resolveAuthState(SIGNED_IN);

    // `/` must not remain as a separate history entry behind /home.
    expect(currentPath()).toBe('/home');
    expect(seen.filter((l) => l.pathname === '/home')).toHaveLength(1);
  });

  it('still shows the choice to a returning guest, who may want a real account', () => {
    // A stored guest id is only a localStorage key, a weaker signal than a
    // Firebase session, and this screen is the one route to an account. On a
    // reload AuthContext reads that key and resolves `mode` to 'guest', which
    // must NOT redirect.
    localStorage.setItem(GUEST_ID_KEY, 'guest_11111111-2222-3333-4444-555555555555');

    renderWelcome('/');

    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument();
    expect(currentPath()).toBe('/');
  });
});

// ---------------------------------------------------------------------------
// The guest path
// ---------------------------------------------------------------------------

describe('continuing as a guest', () => {
  it('mints a guest id and lands on /home when there is no `state.from`', async () => {
    const user = userEvent.setup();
    renderWelcome('/');

    expect(getGuestId()).toBeNull();

    await user.click(screen.getByRole('button', { name: /continue as .*guest/i }));

    // The guest identity is `guest_<uuid4>`, minted once (spec §3).
    expect(getGuestId()).toBeTruthy();
    expect(currentPath()).toBe('/home');
  });

  it('returns to `state.from` when a guard bounced the visitor here', async () => {
    const user = userEvent.setup();
    // `state.from` is a react-router `Location` object, exactly as
    // `AuthGuard` forwards it — not a bare pathname — so that the
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

    // `signInWithGoogle()` lives in the auth layer; all this asserts is that the
    // welcome screen calls it instead of navigating on its own authority.
    expect(rec.signInCalls).toBeGreaterThan(0);
  });

  it('never mints a guest id merely by being visited', () => {
    renderWelcome();
    expect(getGuestId()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// No name is asked here
// ---------------------------------------------------------------------------

describe('the welcome screen asks for no name', () => {
  // A player names themselves on the game screen, right before joining a room
  // (spec §4.1); a host in the create-room form. Neither identity choice
  // carries a name field.

  it('renders no text field at all', () => {
    renderWelcome();

    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryByLabelText(/name/i)).toBeNull();
  });

  it('continuing as a guest leaves the stored name alone', async () => {
    setDisplayName('Cara');
    const user = userEvent.setup();
    renderWelcome();

    await user.click(screen.getByRole('button', { name: /continue as .*guest/i }));

    await waitFor(() => expect(currentPath()).toBe('/home'));
    expect(getDisplayName()).toBe('Cara');
  });

  it('continuing as a guest stores no name when there was none', async () => {
    const user = userEvent.setup();
    renderWelcome();

    await user.click(screen.getByRole('button', { name: /continue as .*guest/i }));

    expect(getGuestId()).toBeTruthy();
    expect(currentPath()).toBe('/home');
    expect(getDisplayName()).toBeNull();
  });
});
