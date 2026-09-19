# Beery — Frontend

React + TypeScript + Vite client for the Beer Distribution Game. Tailwind v4, Zustand, Socket.IO,
Firebase auth.

Built section by section against `../docs/plan/`. Each section document is the contract; the
plan's `BUILD-LOG.md` records what is done and every specification defect found along the way.

---

## Prerequisites

- **Node >= 20.19** (or 22.12+), pinned in `.nvmrc` and `engines.node`.
- The backend, for anything past the welcome screen and the manuals. See `../Beery_Backend/README.md`.

The toolchain is pinned to the combination the shared Novus stack verifies — React `~19.2.0`
(tilde, not caret), Vite 7, TypeScript 5.9, Tailwind 4, Vitest 4. React is pinned with a tilde
because `@react-three/fiber` declares a narrow React peer range and lags releases by months; a
caret lets npm pull a React it refuses, and the install then fails with `ERESOLVE` naming a
package nobody touched.

## Setup

```bash
npm ci
cp .env.example .env    # then fill it in — see Configuration
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
npm run test:run        # vitest run — 321 passed, 11 files
```

`npm run build` type-checks all three TypeScript projects before building, so a type error fails
the build rather than shipping.

### What works today

The welcome screen, both manuals, the home page (create or join a room), and the player and host
lobbies. Everything from week 1 onward — the decision panel, the host console, the results screen
and the profile — is sections 18 through 22 and not built yet.

The two game shells and the host's configuration panel resolve their screens **by discovery**, so
until those sections land the shells render *"This screen is not available yet."* rather than
failing to compile. That is a build-time seam, not a runtime error.

Without a backend, the public routes still render: `/`, `/player-manual` and `/host-manual` need
neither auth nor the API. Every other route sits behind a guard that shows the wake-up screen while
`/api/v1/health` is failing.

## Configuration

`.env`, read through `import.meta.env`. All six `VITE_FIREBASE_*` keys are **required** for Google
sign-in.

| Variable | Notes |
|---|---|
| `VITE_API_BASE_URL` | Empty falls back to the Vite dev proxy on `/api`. |
| `VITE_SOCKET_URL` | Must point **directly** at the backend host in production: Firebase Hosting does not proxy WebSocket upgrades. |
| `VITE_FIREBASE_*` | The web config — public identifiers, safe to ship in the bundle. |

There is **no literal fallback** behind the Firebase variables. A hardcoded project id makes a
missing or misspelled variable invisible, and in this monorepo of sibling Novus games that means
silently authenticating against a *different game's* Firebase project. When a key is missing the
app logs the full list at `console.error` and `signInWithGoogle()` rejects with the same message —
it does not throw at module load, because `firebase.ts` is imported transitively by `socket.ts` and
`http.ts`, and throwing there would black-screen the welcome page and the manuals.

`firebase.ts` is **committed** and must never be gitignored. The sibling project gitignores it
while importing it from `src/`, so its CI cannot build the frontend and the frontend silently never
deploys while the backend auto-deploys on push.

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
│   ├── rooms.ts  games.ts  health.ts
├── auth/AuthContext.tsx
├── contexts/BackendStatusContext.tsx
├── store/gameStore.ts          the Zustand store — written only by socket handlers
├── types/game.ts               TypeScript mirrors of every wire payload
├── utils/storage.ts            alias, guest id, session_token, host_secret, display name
├── pages/                      one module per route, each exporting a `route` descriptor
│   ├── WelcomeScreen  HomePage  GameRoom  HostRoom
│   ├── PlayerManualPage  HostManualPage
│   └── shellScreens.ts         resolves sections 18, 19 and 20 by discovery
├── components/
│   ├── shared/                 LoadingSpinner, Tooltip, AlertContainer, BackendWakeUp,
│   │                           Avatar, ErrorBoundary, NotFound, AuthGuard, BackendGuard
│   ├── lobby/                  the two lobbies, participant list, role cards, invite panel,
│   │                           and a self-contained QR encoder
│   └── manual/
└── __tests__/                  vitest; setup.ts installs the jsdom storage shim
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
edited. The same seam carries the two game shells and the configuration panel, which belong to
sections built later.

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
