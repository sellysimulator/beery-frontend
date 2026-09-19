/**
 * `17-frontend-lobby.md §2.5` — `/player-manual` and `/host-manual`.
 *
 * Covers acceptance criterion 23 and failure mode 11.
 *
 * Both pages are declared `public` (§3.0) and "public and backend-independent"
 * (§2.5), so they are rendered here with **no** auth provider, no backend status
 * provider and a recorder in place of `src/api/http.ts`: a page that needs any
 * of the three fails this file rather than passing it quietly.
 *
 * §2.5 requires the manual to be amended in two places, because it predates two
 * frozen decisions, and both amendments are asserted here.
 *
 *  1. Failure mode 11. D6 removes `round_timer_seconds` and `timeout_policy`
 *     from v1, and `beer-game-manual.md` promises both — Part 1 Step 3
 *     ("Seconds per decision") and Part 2 Step 3 ("If there's a timer and it
 *     runs out…"). A manual that still promises a timer teaches a player to
 *     wait for a countdown that will never arrive, in the one screen they were
 *     told to trust.
 *  2. Part 1 Step 1 reads "Sign in and create a game", which contradicts D3 —
 *     hosting is a capability, not an account, and a guest hosts exactly as a
 *     signed-in user does. A manual that tells a guest to sign in first sends
 *     them looking for an account they do not need and cannot be required to
 *     have.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import type { RouteDescriptor } from '../routes/registry';
import * as PlayerManualModule from '../pages/PlayerManualPage';
import * as HostManualModule from '../pages/HostManualPage';

// ---------------------------------------------------------------------------
// Harness — nothing here may reach the network
// ---------------------------------------------------------------------------

type Listener = (...args: unknown[]) => void;

const rec = vi.hoisted(() => ({ emits: [] as Array<{ event: string; payload: unknown }> }));

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
    off: () => socket,
    removeAllListeners: () => socket,
    emit: (event: string, payload: unknown) => {
      rec.emits.push({ event, payload });
      return socket;
    },
    connect: () => socket,
    disconnect: () => socket,
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

const healthRec = vi.hoisted(() => ({ checkHealth: vi.fn(async () => true) }));
vi.mock('../api/health', () => healthRec);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function descriptorsOf(mod: unknown, label: string): RouteDescriptor[] {
  const route = (mod as { route?: RouteDescriptor | RouteDescriptor[] }).route;
  if (!route) throw new Error(`${label} exports no \`route\` descriptor (17 §3.0).`);
  return Array.isArray(route) ? route : [route];
}

const MANUALS = [
  { label: 'PlayerManualPage.tsx', path: '/player-manual', mod: PlayerManualModule },
  { label: 'HostManualPage.tsx', path: '/host-manual', mod: HostManualModule },
] as const;

function descriptorFor(manual: (typeof MANUALS)[number]): RouteDescriptor {
  const found = descriptorsOf(manual.mod, manual.label).find((d) => d.path === manual.path);
  if (!found) throw new Error(`${manual.label} declares no descriptor for \`${manual.path}\` (17 §3.0).`);
  return found;
}

/** Renders a manual with no provider of any kind — that is the point (§2.5). */
function renderManual(manual: (typeof MANUALS)[number]) {
  const descriptor = descriptorFor(manual);
  return render(
    <MemoryRouter initialEntries={[manual.path]}>
      <Routes>
        <Route path={manual.path} element={descriptor.element} />
      </Routes>
    </MemoryRouter>,
  );
}

function bodyText(): string {
  return (document.body.textContent ?? '').replace(/\s+/g, ' ');
}

beforeEach(() => {
  rec.emits.length = 0;
  httpRec.get.mockClear();
  httpRec.post.mockClear();
  healthRec.checkHealth.mockClear();
});

// ---------------------------------------------------------------------------
// Criterion 23 — public, backend-free, and substantial
// ---------------------------------------------------------------------------

describe('CRITERION 23: both manuals render without auth and without the backend', () => {
  for (const manual of MANUALS) {
    it(`${manual.path} is declared public (17 §3.0)`, () => {
      expect(descriptorFor(manual).guard).toBe('public');
    });

    it(`${manual.path} renders with no provider mounted above it`, () => {
      renderManual(manual);

      // No AuthProvider, no BackendStatusProvider: anything the page reads from
      // a context it did not mount itself would throw here.
      expect(bodyText().length).toBeGreaterThan(200);
    });

    it(`${manual.path} makes no API call and opens no socket`, () => {
      renderManual(manual);

      expect(httpRec.get).not.toHaveBeenCalled();
      expect(httpRec.post).not.toHaveBeenCalled();
      expect(healthRec.checkHealth).not.toHaveBeenCalled();
      expect(rec.emits).toHaveLength(0);
    });
  }

  it('the player manual carries Part 2 — the chain and what each role does', () => {
    renderManual(MANUALS[0]);

    const text = bodyText();
    expect(text).toMatch(/retailer/i);
    expect(text).toMatch(/wholesaler/i);
    expect(text).toMatch(/distributor/i);
    expect(text).toMatch(/factory/i);
    expect(text).toMatch(/chain/i);
  });

  it('the host manual carries Part 1 — running the session and the debrief', () => {
    renderManual(MANUALS[1]);

    const text = bodyText();
    expect(text).toMatch(/room code/i);
    expect(text).toMatch(/debrief/i);
  });
});

// ---------------------------------------------------------------------------
// Failure mode 11 — the manual must not promise a timer
// ---------------------------------------------------------------------------

describe('FAILURE MODE 11 / D6: neither manual promises a decision timer', () => {
  for (const manual of MANUALS) {
    it(`${manual.path} contains none of "timer", "seconds per decision" or "runs out"`, () => {
      renderManual(manual);

      const text = bodyText().toLowerCase();
      for (const forbidden of ['timer', 'seconds per decision', 'runs out']) {
        expect(`${forbidden}:${text.includes(forbidden)}`).toBe(`${forbidden}:false`);
      }
    });

    it(`${manual.path} mentions no countdown or time limit by any other name`, () => {
      renderManual(manual);

      const text = bodyText();
      // v1 is untimed: there is no decision deadline, no countdown and no
      // auto-submission (D6). The amended copy may say there is *no* time
      // limit; it may not promise one.
      expect(text).not.toMatch(/countdown/i);
      expect(text).not.toMatch(/time\s*limit\s+of/i);
      expect(text).not.toMatch(/auto-?submit/i);
      expect(text).not.toMatch(/\b\d+\s*seconds?\s+(per|to)\b/i);
    });

    it(`${manual.path} says instead how a week actually closes`, () => {
      renderManual(manual);

      // §2.5: replace those passages with "There is no time limit — the week
      // closes when everyone has decided, or when the host closes it."
      const text = bodyText();
      expect(text).toMatch(/no time limit/i);
      expect(text).toMatch(/everyone has decided/i);
      expect(text).toMatch(/host closes it/i);
    });
  }
});

// ---------------------------------------------------------------------------
// §2.5 amendment 2 / D3 — hosting is a capability, not an account
// ---------------------------------------------------------------------------

describe('D3: the host manual does not require an account to host', () => {
  it('drops Part 1 Step 1\'s "Sign in and create a game"', () => {
    renderManual(MANUALS[1]);

    // D3: room creation requires no authentication, and there is no
    // `guests_may_host` flag because there is nothing to gate.
    expect(bodyText()).not.toMatch(/sign in and create a game/i);
  });

  it('offers signing in as a way to keep results, not as a precondition', () => {
    renderManual(MANUALS[1]);

    // §2.5: "Create a game — you can sign in first to keep your results, or
    // just start one."
    const text = bodyText();
    expect(text).toMatch(/you can sign in first to keep your results/i);
    expect(text).toMatch(/just start one/i);
  });

  it('never tells a host that an account is required', () => {
    renderManual(MANUALS[1]);

    const text = bodyText();
    expect(text).not.toMatch(/must (be )?(sign|log) ?(ed)? ?in/i);
    expect(text).not.toMatch(/registered user/i);
    expect(text).not.toMatch(/account is required/i);
  });
});
