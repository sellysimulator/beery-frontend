/**
 * The application shell: the pinned toolchain, the frozen string unions, the
 * page-discovery route registry (16 §4.8), the two guards, `AuthContext`
 * (§4.2), `BackendStatusContext` (§4.7) and `Avatar` (§4.10).
 *
 * Covers acceptance criteria 1, 2, 2b, 3, 6, 7, 17, 18, 19, 20, 21, 22, 23 and
 * failure modes 3, 11, 12.
 *
 * `package.json` and `.gitignore` are read here as DATA — criteria 2, 3, 22 and
 * failure modes 11 and 12 are assertions *about* those files.
 *
 * §3 fixes the composition: `App` renders only the `<Routes>` and mounts no
 * router and no provider, so every render below supplies `<MemoryRouter>` and
 * the providers itself, exactly as `main.tsx` does.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import { createElement, StrictMode, useEffect, type ReactElement, type ReactNode } from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { AuthProvider, useAuth } from '../auth/AuthContext';
import { BackendStatusProvider, useBackendStatus } from '../contexts/BackendStatusContext';
import { AuthGuard } from '../components/shared/AuthGuard';
import { BackendGuard } from '../components/shared/BackendGuard';
import { Avatar } from '../components/shared/Avatar';
import { NotFound } from '../components/shared/NotFound';
import { collectRoutes, type RouteDescriptor } from '../routes/registry';
import { ROLE_ORDER } from '../types/game';
import type { DemandKind, Distribution, Role, RoleAssignmentMode, RoomState } from '../types/game';
import { getGuestId } from '../utils/storage';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

type Listener = (...args: unknown[]) => void;

const rec = vi.hoisted(() => ({
  registrations: [] as Array<{ event: string; cb: Listener }>,
  emits: [] as Array<{ event: string; payload: unknown }>,
  connectCalls: 0,
  disconnectCalls: 0,
  /** every callback handed to `onAuthStateChanged` */
  authCallbacks: [] as Array<(user: unknown) => void>,
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
    signInWithPopup: vi.fn(async () => ({ user: { uid: 'uid-1', displayName: 'Ana' } })),
    signOut: vi.fn(async () => undefined),
    GoogleAuthProvider: class {},
  }),
);

const httpRec = vi.hoisted(() => {
  const ok = async (...args: unknown[]): Promise<{ data: Record<string, unknown> }> => {
    void args;
    return { data: { status: 'ok' } };
  };
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

/** §3: the provider calls `checkHealth()` from `src/api/health.ts`. */
const healthRec = vi.hoisted(() => ({ checkHealth: vi.fn(async () => true) }));
vi.mock('../api/health', () => healthRec);

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

const ROOT = projectRoot();
const PAGES_DIR = join(ROOT, 'src', 'pages');

/** Resolves the Firebase auth state, which is what ends `AuthContext`'s loading. */
function resolveAuthState(user: unknown = null): void {
  act(() => {
    for (const cb of [...rec.authCallbacks]) cb(user);
  });
}

/** Shows where a redirect came from, so `state.from` is observable. */
function LocationProbe() {
  const location = useLocation();
  const from = (location.state as { from?: unknown } | null)?.from ?? null;
  const asPath = typeof from === 'string' ? from : ((from as { pathname?: string } | null)?.pathname ?? '');
  return createElement('div', { 'data-testid': 'welcome' }, `WELCOME from=${asPath}`);
}

/**
 * Loads `App` and the providers as one fresh module generation, with the route
 * registry replaced. `react` and `react-router-dom` are externalised by Vitest,
 * so they keep their identity across `resetModules()` and the statically
 * imported `MemoryRouter` still provides context to the freshly loaded `App`.
 */
async function loadShell(routes: RouteDescriptor[]) {
  vi.resetModules();
  vi.doMock('../routes/registry', () => ({ discoverRoutes: () => routes }));

  const [appMod, authMod, backendMod] = await Promise.all([
    import('../App'),
    import('../auth/AuthContext'),
    import('../contexts/BackendStatusContext'),
  ]);

  return {
    App: appMod.default,
    AuthProvider: authMod.AuthProvider,
    BackendStatusProvider: backendMod.BackendStatusProvider,
  };
}

/** `main.tsx`'s nesting, minus `<StrictMode>`: providers, router, then `App`. */
function renderShell(
  shell: { App: () => ReactElement; AuthProvider: (p: { children: ReactNode }) => ReactElement; BackendStatusProvider: (p: { children: ReactNode }) => ReactElement },
  path: string,
  strict = false,
) {
  const tree = createElement(
    shell.AuthProvider,
    null,
    createElement(
      shell.BackendStatusProvider,
      null,
      createElement(MemoryRouter, { initialEntries: [path] }, createElement(shell.App)),
    ),
  );
  return render(strict ? createElement(StrictMode, null, tree) : tree);
}

beforeEach(() => {
  rec.emits.length = 0;
  rec.connectCalls = 0;
  rec.disconnectCalls = 0;
  rec.authCallbacks.length = 0;
  httpRec.get.mockClear();
  healthRec.checkHealth.mockReset();
  healthRec.checkHealth.mockResolvedValue(true);
});

afterEach(() => {
  vi.doUnmock('../routes/registry');
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// The manifest (criteria 2, 3, 22; failure modes 11, 12)
// ---------------------------------------------------------------------------

describe('toolchain manifest (16 §2 — FROZEN)', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    engines?: Record<string, string>;
    scripts?: Record<string, string>;
  };

  const DEPENDENCIES: Record<string, string> = {
    react: '~19.2.0',
    'react-dom': '~19.2.0',
    'react-router-dom': '^7.13.0',
    zustand: '^5.0.11',
    'socket.io-client': '^4.8.3',
    axios: '^1.13.5',
    firebase: '^12.9.0',
    'react-hook-form': '^7.71.1',
    '@hookform/resolvers': '^5.2.2',
    zod: '^4.3.6',
    uuid: '^13.0.0',
    'chart.js': '^4.5.1',
    'react-chartjs-2': '^5.3.1',
    // The 3D board (24 §6.4), matching Tequila version for version — the
    // combination `game_stack.md` has actually been exercised against. It is a
    // lazy chunk that is never in the entry graph, so it costs the 2D player
    // nothing at runtime.
    three: '^0.184.0',
    '@react-three/fiber': '^9.6.1',
    '@react-three/drei': '^10.7.7',
  };

  const DEV_DEPENDENCIES: Record<string, string> = {
    vite: '^7.3.1',
    typescript: '~5.9.3',
    '@vitejs/plugin-react': '^5.1.1',
    tailwindcss: '^4.1.18',
    '@tailwindcss/vite': '^4.1.18',
    vitest: '^4.1.4',
    jsdom: '^29.0.2',
    '@testing-library/react': '^16.3.2',
    '@testing-library/jest-dom': '^6.9.1',
    '@testing-library/user-event': '^14.6.1',
    '@types/react': '~19.2.7',
    '@types/react-dom': '~19.2.3',
    '@types/node': '^24.10.1',
    // Tequila keeps `@types/three` in `dependencies`. Types are never shipped,
    // `npm ci` installs devDependencies in CI anyway, and `tsc` resolves them
    // through node resolution regardless of `tsconfig.app.json`'s
    // `types: ["vite/client"]` — so this is its correct home. A deliberate
    // divergence (24 §6.4); do not "fix" it back.
    '@types/three': '^0.184.0',
    eslint: '^9.39.1',
    '@eslint/js': '^9.39.1',
    'typescript-eslint': '^8.48.0',
    'eslint-plugin-react-hooks': '^7.0.1',
    'eslint-plugin-react-refresh': '^0.4.24',
    globals: '^16.5.0',
  };

  it('FAILURE MODE 12 / CRITERION 2: React is pinned with a tilde, not a caret', () => {
    // `^19.2.0` lets npm pull a React that @react-three/fiber refuses (its peer
    // range is >=19 <19.3), and the install then fails with ERESOLVE naming a
    // package nobody touched. D15 keeps that seam open.  [HARD-WON]
    expect(pkg.dependencies?.react).toBe('~19.2.0');
    expect(pkg.dependencies?.react).not.toMatch(/^\^/);
    expect(pkg.dependencies?.['react-dom']).toBe('~19.2.0');
    expect(pkg.dependencies?.['react-dom']).not.toMatch(/^\^/);
    expect(pkg.devDependencies?.['@types/react']).not.toMatch(/^\^/);
    expect(pkg.devDependencies?.['@types/react-dom']).not.toMatch(/^\^/);
    expect(pkg.devDependencies?.typescript).not.toMatch(/^\^/);
  });

  it('CRITERION 2: every dependency matches §2 version for version', () => {
    for (const [name, range] of Object.entries(DEPENDENCIES)) {
      expect(`${name}@${pkg.dependencies?.[name]}`).toBe(`${name}@${range}`);
    }
  });

  it('CRITERION 2: every devDependency matches §2 version for version', () => {
    for (const [name, range] of Object.entries(DEV_DEPENDENCIES)) {
      expect(`${name}@${pkg.devDependencies?.[name]}`).toBe(`${name}@${range}`);
    }
  });

  it('CRITERION 2: the scaffold Vite 8 / TypeScript 6 combination is gone (D16)', () => {
    expect(pkg.devDependencies?.vite).not.toMatch(/8\./);
    expect(pkg.devDependencies?.typescript).not.toMatch(/^[~^]?6\./);
    expect(pkg.dependencies).not.toHaveProperty('vite');
  });

  it('CRITERION 1: Node is pinned at the §2 floor in engines and .nvmrc', () => {
    expect(pkg.engines?.node).toBeDefined();
    expect(pkg.engines?.node).toMatch(/20\.19|22\.12/);

    const nvmrc = join(ROOT, '.nvmrc');
    expect(existsSync(nvmrc)).toBe(true);
    expect(readFileSync(nvmrc, 'utf8').trim()).toMatch(/^v?(20\.19|20\.\d+|22\.\d+)/);
  });

  it('CRITERION 1: a build script exists', () => {
    expect(typeof pkg.scripts?.build).toBe('string');
    expect(pkg.scripts?.build).toMatch(/vite build/);
  });

  it('24 CRITERION 4: vite.config.ts keeps the whole 3D tree in one lazy `three` chunk', () => {
    // Read as DATA, like `package.json` above: this is an assertion *about* the
    // build configuration, not a behaviour of the app.
    //
    // The bucket is asserted by the two names that do NOT announce themselves.
    // `three` and `@react-three/*` are obvious and any rewrite would keep them;
    // `troika-three-text` (drei `<Text>`'s SDF pipeline) and `react-reconciler`
    // (@react-three/fiber's renderer) are not, and whichever of them falls
    // through to `vendor` drags a slice of the 3D tree into the entry graph —
    // silently, because the build stays green and only the network tab shows
    // it. 24 §6.4 and AC 4 say `three` may appear in no chunk the entry HTML
    // loads, so these two are the canaries for that.  [HARD-WON]
    const config = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8');
    const bucket = /return 'three'/.test(config);
    expect(`three-bucket:${bucket}`).toBe('three-bucket:true');
    for (const name of ['troika-three-text', 'react-reconciler', '@react-three']) {
      expect(`${name}:${config.includes(name)}`).toBe(`${name}:true`);
    }
  });

  it('CRITERION 3: Tailwind is CSS-first — there is no tailwind.config.*', () => {
    for (const name of [
      'tailwind.config.js',
      'tailwind.config.ts',
      'tailwind.config.cjs',
      'tailwind.config.mjs',
      'postcss.config.js',
    ]) {
      expect(`${name}:${existsSync(join(ROOT, name))}`).toBe(`${name}:false`);
    }
    // Tailwind v4 is wired through the Vite plugin instead.
    expect(pkg.devDependencies?.['@tailwindcss/vite']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// CRITERION 2b: the five string unions, member for member
// ---------------------------------------------------------------------------

/**
 * Each map is checked twice over. TypeScript checks it **exactly**: a member
 * the union lacks is an excess property, and a member the union has but the map
 * omits is a missing property — so `tsc -b` (criterion 21) fails either way.
 * The runtime assertions below then say *which* member is wrong, because a type
 * error alone is a poor bug report.
 */
const ROLE_MEMBERS: Record<Role, true> = {
  RETAILER: true,
  WHOLESALER: true,
  DISTRIBUTOR: true,
  FACTORY: true,
};

const ROLE_ASSIGNMENT_MODE_MEMBERS: Record<RoleAssignmentMode, true> = {
  HOST_ASSIGNS: true,
  PLAYER_CHOOSES: true,
  RANDOM: true,
};

const ROOM_STATE_MEMBERS: Record<RoomState, true> = {
  LOBBY: true,
  CONFIGURING: true,
  READY: true,
  RUNNING: true,
  PAUSED: true,
  FINISHED: true,
  ABANDONED: true,
};

const DEMAND_KIND_MEMBERS: Record<DemandKind, true> = {
  CONSTANT: true,
  STEP: true,
  RAMP: true,
  SEASONAL: true,
  STOCHASTIC: true,
  CUSTOM: true,
};

const DISTRIBUTION_MEMBERS: Record<Distribution, true> = {
  NORMAL: true,
  POISSON: true,
  UNIFORM: true,
};

describe('CRITERION 2b: the frozen string unions of src/types/game.ts', () => {
  const cases: Array<[string, Record<string, true>, string[]]> = [
    ['Role', ROLE_MEMBERS, ['RETAILER', 'WHOLESALER', 'DISTRIBUTOR', 'FACTORY']],
    ['RoleAssignmentMode', ROLE_ASSIGNMENT_MODE_MEMBERS, ['HOST_ASSIGNS', 'PLAYER_CHOOSES', 'RANDOM']],
    [
      'RoomState',
      ROOM_STATE_MEMBERS,
      ['LOBBY', 'CONFIGURING', 'READY', 'RUNNING', 'PAUSED', 'FINISHED', 'ABANDONED'],
    ],
    ['DemandKind', DEMAND_KIND_MEMBERS, ['CONSTANT', 'STEP', 'RAMP', 'SEASONAL', 'STOCHASTIC', 'CUSTOM']],
    ['Distribution', DISTRIBUTION_MEMBERS, ['NORMAL', 'POISSON', 'UNIFORM']],
  ];

  for (const [name, members, expected] of cases) {
    it(`${name} has exactly the ${expected.length} members §3 freezes`, () => {
      expect(Object.keys(members).sort()).toEqual([...expected].sort());
    });
  }

  it('names the two members a port from the Tequila enums gets wrong', () => {
    // The room lifecycle ends in ABANDONED, and the sixth demand generator is
    // STOCHASTIC — not RANDOM, which is a RoleAssignmentMode member instead.
    expect(Object.keys(ROOM_STATE_MEMBERS)).toContain('ABANDONED');
    expect(Object.keys(DEMAND_KIND_MEMBERS)).toContain('STOCHASTIC');
    expect(Object.keys(DEMAND_KIND_MEMBERS)).not.toContain('RANDOM');
    expect(Object.keys(ROLE_ASSIGNMENT_MODE_MEMBERS)).toContain('RANDOM');
  });

  it('the unions are narrow — the member check above is not vacuous', () => {
    // If any of these were widened to `string`, the Record maps above would
    // accept anything and criterion 2b would pass while asserting nothing. A
    // widened union makes each @ts-expect-error below unused, which `tsc -b`
    // reports as an error — so criterion 21 catches it.

    // @ts-expect-error — 'RANDOM' is a RoleAssignmentMode member, never a DemandKind.
    const notADemandKind: DemandKind = 'RANDOM';
    // @ts-expect-error — 'WAITING' is the Tequila room state; Beery's lobby state is LOBBY.
    const notARoomState: RoomState = 'WAITING';
    // @ts-expect-error — the chain has four roles; 'CUSTOMER' is not one of them.
    const notARole: Role = 'CUSTOMER';
    // @ts-expect-error — 'EXPONENTIAL' is not one of the three distributions.
    const notADistribution: Distribution = 'EXPONENTIAL';
    // @ts-expect-error — role assignment has three modes; 'BOT_FILLS' is not one.
    const notAMode: RoleAssignmentMode = 'BOT_FILLS';

    expect([notADemandKind, notARoomState, notARole, notADistribution, notAMode]).toEqual([
      'RANDOM',
      'WAITING',
      'CUSTOMER',
      'EXPONENTIAL',
      'BOT_FILLS',
    ]);
  });

  it('ROLE_ORDER is the chain from the customer upstream', () => {
    expect([...ROLE_ORDER]).toEqual(['RETAILER', 'WHOLESALER', 'DISTRIBUTOR', 'FACTORY']);
  });
});

// ---------------------------------------------------------------------------
// firebase.ts is committed (criterion 22; failure mode 11)
// ---------------------------------------------------------------------------

describe('CRITERION 22 / FAILURE MODE 11: firebase.ts is committed, not gitignored', () => {
  /** Minimal gitignore matcher — enough for the literal forms that bite here. */
  function ignores(patterns: string[], path: string): boolean {
    let ignored = false;
    for (const raw of patterns) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const negated = line.startsWith('!');
      const body = (negated ? line.slice(1) : line).replace(/^\//, '').replace(/\/$/, '');
      const escaped = body
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '')
        .replace(/\*/g, '[^/]*')
        .replace(//g, '.*')
        .replace(/\?/g, '[^/]');
      const re = new RegExp(`^(.*/)?${escaped}$`);
      if (re.test(path)) ignored = !negated;
    }
    return ignored;
  }

  const gitignorePath = join(ROOT, '.gitignore');
  const patterns = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8').split(/\r?\n/) : [];

  it('the file exists on disk', () => {
    expect(existsSync(join(ROOT, 'firebase.ts'))).toBe(true);
  });

  it('no .gitignore pattern matches firebase.ts', () => {
    // Tequila gitignores it while importing it from src/, so CI cannot build
    // the frontend and it silently never deploys while the backend does — the
    // worst possible split.  [HARD-WON]
    expect(ignores(patterns, 'firebase.ts')).toBe(false);
    expect(ignores(patterns, 'src/firebase.ts')).toBe(false);
  });

  it('the matcher itself is not vacuous', () => {
    expect(ignores(['firebase.ts'], 'firebase.ts')).toBe(true);
    expect(ignores(['/firebase.ts'], 'firebase.ts')).toBe(true);
    expect(ignores(['*.ts'], 'firebase.ts')).toBe(true);
    expect(ignores(['node_modules'], 'firebase.ts')).toBe(false);
  });

  it('but node_modules and dist ARE ignored', () => {
    expect(ignores(patterns, 'node_modules')).toBe(true);
    expect(ignores(patterns, 'dist')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Toolchain gates (criteria 1, 21)
// ---------------------------------------------------------------------------

describe('toolchain gates', () => {
  const run = (cmd: string, args: string[]) => {
    try {
      execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
      return { ok: true, output: '' };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      return { ok: false, output: `${e.stdout ?? ''}\n${e.stderr ?? ''}\n${e.message ?? ''}`.trim() };
    }
  };

  it('CRITERION 21: tsc -b is clean across all three projects', () => {
    const result = run('npx', ['--no-install', 'tsc', '-b', '--force']);
    expect(result.output).toBe('');
    expect(result.ok).toBe(true);
  }, 300_000);

  it('CRITERION 21: eslint . is clean', () => {
    const result = run('npx', ['--no-install', 'eslint', '.']);
    expect(result.output).toBe('');
    expect(result.ok).toBe(true);
  }, 300_000);

  it('CRITERION 1: npm run build succeeds and produces dist/index.html', () => {
    const result = run('npm', ['run', 'build']);
    expect(result.ok ? 'built' : result.output).toBe('built');
    expect(existsSync(join(ROOT, 'dist', 'index.html'))).toBe(true);
  }, 300_000);
});

// ---------------------------------------------------------------------------
// The route registry with src/pages/ empty or absent (criterion 19)
// ---------------------------------------------------------------------------

describe('CRITERION 19: an empty module record produces an empty route table', () => {
  /**
   * Asserted through `collectRoutes`, never `discoverRoutes()`.
   *
   * `import.meta.glob` is expanded at TRANSFORM time, so once section 17 ships
   * its pages the live registry can never return `[]` again — an assertion
   * against it would be true for exactly one wave and false forever after.
   * `collectRoutes({})` stays assertable for the life of the project (§3).
   */
  it('collectRoutes({}) returns []', () => {
    expect(collectRoutes({})).toEqual([]);
  });

  it('ignores a module that exports no route', () => {
    expect(
      collectRoutes({
        '../pages/NotAPage.tsx': { default: () => null },
        '../pages/AlsoNot.tsx': {},
      }),
    ).toEqual([]);
  });

  it('collects one descriptor per module, in module-name order', () => {
    const descriptor = (path: string): RouteDescriptor => ({
      path,
      guard: 'public',
      element: createElement('div', null, path),
    });

    const routes = collectRoutes({
      '../pages/Zebra.tsx': { route: descriptor('/zebra') },
      '../pages/Alpha.tsx': { route: descriptor('/alpha') },
      '../pages/Middle.tsx': { route: descriptor('/middle') },
    });

    expect(routes.map((r) => r.path)).toEqual(['/alpha', '/middle', '/zebra']);
  });

  it('accepts an array of descriptors from one module (a page that owns a redirect)', () => {
    const routes = collectRoutes({
      '../pages/Join.tsx': {
        route: [
          { path: '/join/:roomCode', guard: 'public', element: createElement('div') },
          { path: '/game/:roomCode', guard: 'auth+backend', element: createElement('div') },
        ] satisfies RouteDescriptor[],
      },
    });

    expect(routes.map((r) => r.path)).toEqual(['/join/:roomCode', '/game/:roomCode']);
    expect(routes.map((r) => r.guard)).toEqual(['public', 'auth+backend']);
  });

  it('every path renders NotFound for a route table built from collectRoutes({})', async () => {
    const shell = await loadShell(collectRoutes({}));

    for (const path of ['/', '/game/ABCD12', '/host/ABCD12', '/nonsense/deep/link']) {
      const { unmount } = renderShell(shell, path);
      resolveAuthState(null);
      expect(await screen.findByText(/Page not found/i)).toBeInTheDocument();
      unmount();
    }
  });

  it('NotFound renders the frozen copy and a way back to /', () => {
    render(createElement(MemoryRouter, null, createElement(NotFound)));

    expect(screen.getByText(/Page not found/i)).toBeInTheDocument();
    const link = document.querySelector('a[href="/"]');
    expect(link).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A page dropped into src/pages/ (criterion 20, registry half)
// ---------------------------------------------------------------------------

describe('CRITERION 20: a module dropped into src/pages/ is discovered', () => {
  const PUBLIC_PAGE = join(PAGES_DIR, '__TmpProbePublic.tsx');
  const AUTH_PAGE = join(PAGES_DIR, '__TmpProbeSecret.tsx');
  let createdPagesDir = false;

  /**
   * A cache-busting module id. `import.meta.glob` is expanded when the module
   * is transformed, and `vitest run` has no file watcher to invalidate that
   * transform, so re-reading the filesystem needs a module id Vite has not seen.
   */
  const specifier = (tag: string): string => `../routes/registry.ts?discover=${tag}`;

  let discovered: RouteDescriptor[] = [];

  beforeAll(async () => {
    if (!existsSync(PAGES_DIR)) {
      mkdirSync(PAGES_DIR, { recursive: true });
      createdPagesDir = true;
    }
    writeFileSync(
      PUBLIC_PAGE,
      [
        "import { createElement } from 'react';",
        "import type { RouteDescriptor } from '../routes/registry';",
        'export const route: RouteDescriptor = {',
        "  path: '/__tmp-probe-public',",
        "  guard: 'public',",
        "  element: createElement('div', { 'data-testid': 'tmp-public' }, 'TMP PUBLIC'),",
        '};',
        '',
      ].join('\n'),
    );
    writeFileSync(
      AUTH_PAGE,
      [
        "import { createElement } from 'react';",
        "import type { RouteDescriptor } from '../routes/registry';",
        'export const route: RouteDescriptor = {',
        "  path: '/__tmp-probe-secret',",
        "  guard: 'auth',",
        "  element: createElement('div', { 'data-testid': 'tmp-secret' }, 'TMP SECRET'),",
        '};',
        '',
      ].join('\n'),
    );

    // One cache-busted import, and every assertion below reads its result.
    // `import.meta.glob` is expanded at transform time and Vite re-globs only
    // for a module id it has not transformed yet, so a second busted id in the
    // same process is not guaranteed to see the filesystem again.
    vi.resetModules();
    const mod = (await import(/* @vite-ignore */ specifier('dropped'))) as {
      discoverRoutes: () => RouteDescriptor[];
    };
    discovered = mod.discoverRoutes();
  });

  afterAll(() => {
    rmSync(PUBLIC_PAGE, { force: true });
    rmSync(AUTH_PAGE, { force: true });
    if (createdPagesDir) rmSync(PAGES_DIR, { recursive: true, force: true });
  });

  it('discoverRoutes() picks up both descriptors among whatever else exists', () => {
    const byPath = Object.fromEntries(discovered.map((r) => [r.path, r]));

    // Sections 17+ ship pages of their own; the probes are additions to that
    // tree, not the whole of it.
    expect(discovered.length).toBeGreaterThanOrEqual(2);
    expect(byPath['/__tmp-probe-public']).toBeDefined();
    expect(byPath['/__tmp-probe-public'].guard).toBe('public');
    expect(byPath['/__tmp-probe-secret']).toBeDefined();
    expect(byPath['/__tmp-probe-secret'].guard).toBe('auth');
  });

  it('places the probes in module-name order among the discovered routes (§4.8)', () => {
    const probes = discovered.map((r) => r.path).filter((p) => p.startsWith('/__tmp-probe'));
    expect(probes).toEqual(['/__tmp-probe-public', '/__tmp-probe-secret']);
  });
});

// ---------------------------------------------------------------------------
// App wires descriptors behind their guards (criterion 20, App half)
// ---------------------------------------------------------------------------

describe('CRITERION 20 (App half): descriptors are routed behind their guards', () => {
  const publicProbe: RouteDescriptor = {
    path: '/__probe',
    guard: 'public',
    element: createElement('div', { 'data-testid': 'probe' }, 'PROBE'),
  };
  const welcome: RouteDescriptor = { path: '/', guard: 'public', element: createElement(LocationProbe) };

  it('routes a public descriptor at its path with no edit to App.tsx', async () => {
    const shell = await loadShell([welcome, publicProbe]);
    renderShell(shell, '/__probe');
    resolveAuthState(null);

    expect(await screen.findByTestId('probe')).toBeInTheDocument();
  });

  it('routes a parameterised path', async () => {
    const shell = await loadShell([
      { path: '/host/:roomCode', guard: 'public', element: createElement('div', { 'data-testid': 'host-shell' }, 'HOST') },
    ]);
    renderShell(shell, '/host/ABCD12');
    resolveAuthState(null);

    expect(await screen.findByTestId('host-shell')).toBeInTheDocument();
  });

  it('applies the auth guard a descriptor names', async () => {
    const shell = await loadShell([
      welcome,
      { path: '/__secret', guard: 'auth', element: createElement('div', { 'data-testid': 'secret' }, 'SECRET') },
    ]);
    renderShell(shell, '/__secret');
    resolveAuthState(null);

    await waitFor(() => {
      expect(screen.queryByTestId('secret')).not.toBeInTheDocument();
      expect(screen.getByTestId('welcome')).toBeInTheDocument();
    });
  });

  it('applies the backend guard a descriptor names', async () => {
    healthRec.checkHealth.mockResolvedValue(false);

    const shell = await loadShell([
      { path: '/__needs', guard: 'backend', element: createElement('div', { 'data-testid': 'needs' }, 'NEEDS') },
    ]);
    renderShell(shell, '/__needs');
    resolveAuthState(null);

    await waitFor(() => {
      expect(screen.queryByTestId('needs')).not.toBeInTheDocument();
      expect(screen.getByText(/Waking up the server/i)).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// AuthGuard (criterion 17)
// ---------------------------------------------------------------------------

describe('CRITERION 17: AuthGuard redirects an unidentified visitor', () => {
  function renderGuarded(path: string) {
    return render(
      createElement(
        AuthProvider,
        null,
        createElement(
          MemoryRouter,
          { initialEntries: [path] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: '/', element: createElement(LocationProbe) }),
            createElement(Route, {
              path: '/secret',
              element: createElement(
                AuthGuard,
                null,
                createElement('div', { 'data-testid': 'secret' }, 'SECRET'),
              ),
            }),
          ),
        ),
      ),
    );
  }

  it('sends them to / with state.from set to the attempted location', async () => {
    renderGuarded('/secret');
    // No Firebase user and no guest id: this visitor has no identity at all.
    resolveAuthState(null);

    await waitFor(() => {
      expect(screen.queryByTestId('secret')).not.toBeInTheDocument();
      expect(screen.getByTestId('welcome')).toBeInTheDocument();
    });
    // A player following an invite link must land back on it after choosing an
    // identity, so the attempted location travels with the redirect.
    expect(screen.getByTestId('welcome').textContent).toContain('/secret');
  });

  it('lets a signed-in visitor through', async () => {
    renderGuarded('/secret');
    resolveAuthState({ uid: 'uid-1', displayName: 'Ana', getIdToken: async () => 'tok' });

    expect(await screen.findByTestId('secret')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// BackendGuard (criterion 18)
// ---------------------------------------------------------------------------

describe('CRITERION 18: BackendGuard gates on health', () => {
  function renderGuarded() {
    return render(
      createElement(
        BackendStatusProvider,
        null,
        createElement(BackendGuard, null, createElement('div', { 'data-testid': 'content' }, 'CONTENT')),
      ),
    );
  }

  it('renders BackendWakeUp while health fails, and the content once it succeeds', async () => {
    // A free-tier host cold-starts in 30–60s; §3 fixes the poll at 3000 ms
    // while the status is not ok, so this runs on fake timers rather than
    // waiting out a real interval.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    healthRec.checkHealth.mockResolvedValue(false);

    renderGuarded();
    await act(async () => {});

    expect(screen.getByText(/Waking up the server/i)).toBeInTheDocument();
    expect(screen.queryByTestId('content')).not.toBeInTheDocument();

    const callsWhileDown = healthRec.checkHealth.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(healthRec.checkHealth.mock.calls.length).toBeGreaterThan(callsWhileDown);

    healthRec.checkHealth.mockResolvedValue(true);
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.getByTestId('content')).toBeInTheDocument();
    expect(screen.queryByText(/Waking up the server/i)).not.toBeInTheDocument();
  });

  it('stops polling once the backend answers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    healthRec.checkHealth.mockResolvedValue(true);

    renderGuarded();
    await act(async () => {});

    expect(screen.getByTestId('content')).toBeInTheDocument();
    const settled = healthRec.checkHealth.mock.calls.length;

    await act(async () => {
      vi.advanceTimersByTime(3000 * 5);
    });

    expect(healthRec.checkHealth.mock.calls.length).toBe(settled);
  });

  it('retry() forces one immediate check', async () => {
    healthRec.checkHealth.mockResolvedValue(false);

    const captured: { retry: (() => void) | null } = { retry: null };
    function Probe() {
      const status = useBackendStatus();
      useEffect(() => {
        captured.retry = status.retry;
      });
      return createElement('div', { 'data-testid': 'status' }, status.status);
    }

    render(createElement(BackendStatusProvider, null, createElement(Probe)));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('down'));

    const before = healthRec.checkHealth.mock.calls.length;
    healthRec.checkHealth.mockResolvedValue(true);
    await act(async () => {
      captured.retry?.();
    });

    expect(healthRec.checkHealth.mock.calls.length).toBeGreaterThan(before);
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ok'));
  });
});

// ---------------------------------------------------------------------------
// AuthContext (criteria 6, 7)
// ---------------------------------------------------------------------------

describe('AuthContext drives the socket connection (16 §4.2)', () => {
  const captured: { value: ReturnType<typeof useAuth> | null } = { value: null };

  function Probe() {
    const value = useAuth();
    useEffect(() => {
      captured.value = value;
    });
    return createElement('div', { 'data-testid': 'auth-probe' }, String(value.mode));
  }

  function mountAuth() {
    captured.value = null;
    return render(createElement(AuthProvider, null, createElement(Probe)));
  }

  it('CRITERION 6: connects after the first resolution and reconnects on a later one', () => {
    mountAuth();

    expect(rec.authCallbacks.length).toBeGreaterThan(0);
    expect(rec.connectCalls).toBe(0); // autoConnect is false; nothing has connected yet

    // First resolution — a returning visitor with no Firebase session.
    resolveAuthState(null);
    expect(rec.connectCalls).toBeGreaterThanOrEqual(1);
    const afterFirst = rec.connectCalls;

    // Later resolution — the identity changed, so the handshake must be redone.
    resolveAuthState({ uid: 'uid-1', displayName: 'Ana', getIdToken: async () => 'tok' });
    expect(rec.connectCalls).toBeGreaterThan(afterFirst);
    expect(rec.disconnectCalls).toBeGreaterThanOrEqual(1);
  });

  it('exposes the frozen AuthContextValue shape', () => {
    mountAuth();
    resolveAuthState(null);

    const value = captured.value;
    expect(value).not.toBeNull();
    expect(value?.firebaseUser ?? null).toBeNull();
    expect(value?.loading).toBe(false);
    expect([null, 'authenticated', 'guest']).toContain(value?.mode ?? null);
    expect(typeof value?.signInWithGoogle).toBe('function');
    expect(typeof value?.continueAsGuest).toBe('function');
    expect(typeof value?.logout).toBe('function');
  });

  it('CRITERION 7: continueAsGuest mints a guest_<uuid4>, persists it and reconnects', () => {
    mountAuth();
    resolveAuthState(null);
    const before = rec.connectCalls;

    act(() => {
      captured.value?.continueAsGuest();
    });

    // Choosing guest mode fires no Firebase event, so the reconnect is explicit.
    expect(rec.connectCalls).toBeGreaterThan(before);
    expect(getGuestId()).toMatch(/^guest_[0-9a-f-]{36}$/);
    expect(captured.value?.mode).toBe('guest');
  });

  it('a signed-in resolution reports the authenticated mode', () => {
    mountAuth();
    resolveAuthState({ uid: 'uid-1', displayName: 'Ana', getIdToken: async () => 'tok' });

    expect(captured.value?.mode).toBe('authenticated');
  });
});

// ---------------------------------------------------------------------------
// StrictMode (failure mode 3)
// ---------------------------------------------------------------------------

describe('FAILURE MODE 3: StrictMode must not double-apply events', () => {
  it('mounting the app registers no extra socket listeners, and one week_closed applies once', async () => {
    vi.resetModules();
    vi.doMock('../routes/registry', () => ({ discoverRoutes: () => [] }));

    const [storeMod, appMod, authMod, backendMod] = await Promise.all([
      import('../store/gameStore'),
      import('../App'),
      import('../auth/AuthContext'),
      import('../contexts/BackendStatusContext'),
    ]);

    rec.registrations.length = 0;
    await import('../api/socketHandlers'); // the module side effect, as in main.tsx
    const afterRegistration = rec.registrations.length;
    expect(afterRegistration).toBeGreaterThan(0);

    renderShell(
      {
        App: appMod.default,
        AuthProvider: authMod.AuthProvider,
        BackendStatusProvider: backendMod.BackendStatusProvider,
      },
      '/',
      true,
    );
    resolveAuthState(null);

    // A component-mounted handler registers twice under StrictMode and every
    // event is then applied twice — which, for a store that appends, silently
    // doubles history.
    expect(rec.registrations.length).toBe(afterRegistration);

    const weekClosed = [...rec.registrations].reverse().find((r) => r.event === 'week_closed');
    expect(weekClosed).toBeDefined();
    act(() => {
      weekClosed?.cb({ seq: 1, week: 1, next_week: 2, awaiting_roles: ['RETAILER'] });
    });

    const state = storeMod.useGameStore.getState();
    expect(state.lastSeq).toBe(1);
    expect(state.awaitingRoles).toEqual(['RETAILER']);

    storeMod.useGameStore.getState().reset();
  });
});

// ---------------------------------------------------------------------------
// Avatar (criterion 23)
// ---------------------------------------------------------------------------

describe('CRITERION 23: Avatar survives a 429 from googleusercontent', () => {
  const PHOTO = 'https://lh3.googleusercontent.com/a/whatever=s96-c';

  it('sets referrerPolicy="no-referrer" on the image', () => {
    const { container } = render(createElement(Avatar, { photoUrl: PHOTO, displayName: 'Ana' }));

    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(img?.getAttribute('src')).toBe(PHOTO);
  });

  it('falls back to the initial when the image errors', async () => {
    const { container } = render(createElement(Avatar, { photoUrl: PHOTO, displayName: 'Ana' }));

    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    fireEvent.error(img as HTMLImageElement);

    await waitFor(() => {
      expect(container.querySelector('img')).toBeNull();
      expect((container.textContent ?? '').toUpperCase()).toContain('A');
    });
  });

  it('renders the initial when there is no photo at all', () => {
    const { container } = render(createElement(Avatar, { photoUrl: null, displayName: 'Bruno' }));

    expect(container.querySelector('img')).toBeNull();
    expect((container.textContent ?? '').toUpperCase()).toContain('B');
  });

  it('accepts the optional size prop', () => {
    const { container } = render(
      createElement(Avatar, { photoUrl: PHOTO, displayName: 'Ana', size: 64 }),
    );
    expect(container.firstElementChild).not.toBeNull();
  });
});
