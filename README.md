# Beery — Frontend

React + TypeScript + Vite client for the Beer Distribution Game. Tailwind v4, Zustand, Socket.IO,
Firebase auth.

Built section by section against `../docs/plan/`. Each section document is the contract; the
plan's `BUILD-LOG.md` records what is done and every specification defect found along the way.

This file is the human onboarding guide: how to run it, what the pieces are, and the handful of
rules that are easy to break by accident. `DEPLOY.md` covers hosting, CI and the deploy
checklist. `CLAUDE.md` is the agent-facing map of the same codebase, in more detail.

---

## Prerequisites

- **Node >= 20.19** (or 22.12+), pinned in `.nvmrc` and `engines.node`.
- The backend, for anything past the welcome screen and the manuals. See `../Beery_Backend/README.md`.

The toolchain is pinned to the combination the shared Novus stack verifies — React `~19.2.0`
(tilde, not caret), Vite 7, TypeScript 5.9, Tailwind 4, Vitest 4. React is pinned with a tilde
by the shared stack's rule for games that add a 3D dependency: `@react-three/fiber` declares a
narrow React peer range and lags React releases by months, so a caret lets npm pull a React it
refuses and the install fails with `ERESOLVE` naming a package nobody touched. Beery has no
3D dependency today — the board is 2D canvas — but the pin stays so that adding one is not a
version fight.

## Setup

```bash
npm ci
cp .env.example .env    # for local dev, leave both values empty — see Configuration
```

## Running

```bash
npm run dev             # http://localhost:5173
```

The dev server proxies `/api` and `/socket.io` to `http://localhost:8080`, so start the backend on
**8080** and leave `VITE_API_BASE_URL` empty to use the proxy.

```bash
npm run build           # tsc -b && vite build -> dist/
npm run preview         # serve the built bundle
npm run lint            # eslint .
npm test                # vitest, watch mode
npm run test:run        # vitest run — 760 passed, 26 files
npx tsc -b              # typecheck only, which is what CI runs first
```

`npm run build` type-checks all three TypeScript projects before building, so a type error fails
the build rather than shipping.

A few test files shell out to the real toolchain — `routes.test.tsx` runs `tsc -b`, `eslint .`
and `npm run build`, and `envSurface.test.ts` reads `firebase.json`, the workflow YAMLs,
`DEPLOY.md`, `.env.example` and `.gitignore` as data. That is why the suite takes longer than a
pure unit suite, and why changing CI or deploy config breaks tests until they are updated too.

### What works today

All of it. The plan's 24 sections are built and gated — see `../docs/plan/HANDOFF.md` — so the
app covers the whole session: welcome screen, both manuals, the home page (create or join a
room), the player and host lobbies, the host's configuration panel, the week-by-week decision
panel, the host console, the results screen with its charts and exports, and the player profile
with match history.

The two game shells and the configuration panel still resolve their screens through
`pages/shellScreens.ts` rather than importing them directly. That seam was built so the shells
could ship before those screens existed; it earns its keep now as the code-split boundary that
keeps Chart.js, react-hook-form and Zod off the welcome and lobby path. The screens are lazy,
so they are fetched on the first render that actually shows one.

Without a backend, `/`, `/player-manual` and `/host-manual` still render — they need neither auth
nor the API. `/results/:roomCode` and `/join/:roomCode` are also unguarded, but they have nothing
to show until the API answers. Every other route sits behind a guard that shows the wake-up screen
while `/api/v1/health` is failing.

## Configuration

`.env`, read through `import.meta.env`. These are **build-time** values baked into the bundle, so
changing one needs a rebuild, not a restart. `.env.example` lists them all; there are only three,
and they are exactly the ones the code reads.

| Variable | Read by | Notes |
|---|---|---|
| `VITE_API_BASE_URL` | `api/http.ts`, `api/health.ts` | Empty falls back to the Vite dev proxy on `/api`. |
| `VITE_SOCKET_URL` | `api/socket.ts` | Must point **directly** at the backend host in production: Firebase Hosting does not proxy WebSocket upgrades. |
| `VITE_BOARD_VIEW` | `pages/GameRoomPlaying.tsx` | Optional. `2D` is the only board registered today, and is the default. |

**There are no `VITE_FIREBASE_*` variables, and there must not be.** The Firebase web config is
six literals in `firebase.ts` at the repository root. Those values are public identifiers that
ship in the bundle to every visitor anyway — Firebase security comes from Auth rules and API-key
restrictions, not from hiding them — so keeping them in one committed file means there is exactly
one place to look and nothing to forget in CI. `src/__tests__/envSurface.test.ts` asserts both
halves of this: that `firebase.ts` is tracked at the root, and that no `VITE_FIREBASE_*` variable
exists anywhere.

`firebase.ts` is **committed** and must never be gitignored or moved into `src/`. The sibling
Tequila project gitignores it while importing it from `src/`, so its CI cannot build the frontend
and the frontend silently never deploys while the backend auto-deploys on push.

## Layout

```
src/
├── main.tsx                    <StrictMode> → <ErrorBoundary> → <AuthProvider>
│                               → <BackendStatusProvider> → <BrowserRouter> → <App />
├── App.tsx                     renders only the <Routes>; names no page
├── index.css                   Tailwind v4, CSS-first — there is no tailwind.config.js
├── routes/registry.ts          collectRoutes() / discoverRoutes()
├── api/
│   ├── http.ts                 axios instance + errorMessage()
│   ├── socket.ts               the Socket.IO client — autoConnect: false
│   ├── socketHandlers.ts       every server → client handler, registered once
│   ├── rooms.ts  games.ts  users.ts  health.ts
├── auth/AuthContext.tsx
├── contexts/BackendStatusContext.tsx
├── store/gameStore.ts          the Zustand store — written only by socket handlers
├── types/game.ts               TypeScript mirrors of every wire payload
├── schemas/configSchema.ts     Zod mirror of GameConfig — a form hint, not a gate
├── utils/storage.ts            alias, guest id, session_token, host_secret, display name
├── pages/                      one module per route, each exporting a `route` descriptor
│   ├── WelcomeScreen  HomePage  GameRoom  HostRoom
│   ├── GameRoomPlaying  HostConsole  ResultsPage  ProfilePage
│   ├── PlayerManualPage  HostManualPage
│   └── shellScreens.ts         lazy seam; the three screens it resolves export no `route`
├── components/
│   ├── shared/                 LoadingSpinner, Tooltip, AlertContainer, BackendWakeUp,
│   │                           Avatar, ErrorBoundary, NotFound, ScreenLoading,
│   │                           AuthGuard, BackendGuard
│   ├── lobby/                  the two lobbies, participant list, role cards, invite panel,
│   │                           and a self-contained QR encoder
│   ├── config/                 the host configuration panel and its react-hook-form pieces
│   ├── game/                   the player's week: decision panel, supply line, recap
│   │   └── views/Board2D.tsx   the registered board view
│   ├── host/                   host console: chain diagram, controls, presentation mode
│   ├── results/                charts, cost tables, debrief notes, CSV/JSON export
│   ├── profile/                match history, stats, role breakdown, guest-claim prompt
│   ├── charts/chartSetup.ts    piecemeal Chart.js registration + the pure config builders
│   └── manual/
└── __tests__/                  vitest, flat, one file per feature + setup.ts
```

### Four rules this codebase depends on

**The store is the single source of truth, and only socket handlers write to it.** Components
read. No component subscribes to the socket directly — a second interpreter of the wire gets
double-registered under StrictMode and left stale by a reconnect. There is no game arithmetic in
the client either: inventory, cost and eligibility all arrive from the server, including whether
the host's Start button may be pressed and the sentence explaining why not.

**Handlers are registered once, as a module side effect, before React renders.** `main.tsx`
imports `./api/socketHandlers` ahead of `createRoot`. A component-mounted handler registers twice
under StrictMode and every event applies twice.

**`autoConnect` is `false` and `auth` is a callback.** The socket module evaluates before Firebase
has restored a persisted session, so auto-connecting would hand a returning signed-in user a
throwaway guest identity. The callback re-runs on every reconnect and picks up a refreshed token
rather than freezing the first one.

**Pages register themselves.** A page module exports `route: RouteDescriptor` (or an array of
them) and `discoverRoutes()` finds it — so a new screen is a new file, and `App.tsx` is never
edited. The three screens behind `shellScreens.ts` are the exception: they are reached through
their shell, so they deliberately export no `route` and the registry's glob must not pick them
up.

### Storage scopes, which are not interchangeable

| Value | Where | Why |
|---|---|---|
| `alias` | `localStorage` | Public; the id in every broadcast. |
| guest id | `localStorage` | Stable per browser; what makes guest reconnection work. |
| `session_token` | `localStorage`, per room | Secret; the reconnect credential. |
| `host_secret` | **`sessionStorage`**, per room | Secret and **tab-scoped**. In `localStorage` it would leak host authority into every tab, including one opened from an invite link. |
| display name | `localStorage` | Display data, sanitised on write. |

A host who closes the tab loses the secret, and recovers by verified identity instead — the server
re-authorises the claim and replies with a fresh secret. That is why the host lobby emits
`join_waiting` *with or without* a stored secret, and why it must not show the recovery screen
before the server has answered.
