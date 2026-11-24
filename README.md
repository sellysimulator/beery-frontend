# Beery — Frontend

React + TypeScript + Vite client for the Beer Distribution Game. Tailwind v4, Zustand, Socket.IO,
Firebase auth.

What the game does — rules, screens, data model, API — is specified in
`docs/beer-game-spec.md`; `docs/beer-game-manual.md` is the host and player manual.

This file is the human onboarding guide: how to run it, what the pieces are, and the handful of
rules that are easy to break by accident. `DEPLOY.md` covers hosting, CI and the deploy
checklist. `CLAUDE.md` is the agent-facing map of the same codebase, in more detail.

---

## Prerequisites

- **Node 22.23.4+, 24.22.1+ or 26.12.1+**, the `engines.node` range (Vite 7 alone needs 20.19 / 22.12, but Node 20 is end of life). `.nvmrc` pins 24.22.1, which CI builds on.
- The backend, for anything past the welcome screen and the manuals. See `../Beery_Backend/README.md`.

The toolchain is pinned to the combination the shared Novus stack verifies — React `~19.2.0`
(tilde, not caret), Vite 7, TypeScript 5.9, Tailwind 4, Vitest 4. React is pinned with a tilde
by the shared stack's rule for games that add a 3D dependency: `@react-three/fiber` declares a
narrow React peer range and lags React releases by months, so a caret lets npm pull a React it
refuses and the install fails with `ERESOLVE` naming a package nobody touched. Beery now ships
that dependency — the 3D board is `three` + `@react-three/fiber` + `@react-three/drei` — so the
tilde is no longer insurance, it is load-bearing. Do not widen it, and do not reach for
`--legacy-peer-deps`.

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
npm run test:run        # vitest run
npx tsc -b              # typecheck only, which is what CI runs first
```

`npm run build` type-checks all three TypeScript projects before building, so a type error fails
the build rather than shipping.

It also emits a separate **`three`** chunk — three.js, `@react-three/fiber`, `@react-three/drei`
and the transitive tiers they own (drei's `troika-*` text pipeline, fiber's `react-reconciler`).
That chunk is around 1.1 MB raw and that is expected: it is lazy, it is never in the entry graph,
and it is fetched only when a player switches to the 3D board. `vite.config.ts` raises
`build.chunkSizeWarningLimit` to 1200 so the size warning still means something when it fires.

A few test files shell out to the real toolchain — `routes.test.tsx` runs `tsc -b`, `eslint .`
and `npm run build`, and `envSurface.test.ts` reads `firebase.json`, the workflow YAMLs,
`DEPLOY.md`, `.env.example` and `.gitignore` as data. That is why the suite takes longer than a
pure unit suite, and why changing CI or deploy config breaks tests until they are updated too.

### What works today

The app covers the whole session: welcome screen, both manuals, the home page (create or join a
room), multi-game hosting (a batch of games made at once from one full base config, watched
from one dashboard), the
name form a player fills in on the game screen right before first joining a room, the
player and host lobbies with a full-screen join QR code, the host's configuration panel, the
week-by-week decision panel, the host console, the results screen with its charts and an
export anyone viewing it can download (once per format per browser session), and the player profile
with match history.

The two game shells and the host lobby load the playing screen, the host console and the
configuration panel through `pages/shellScreens.ts` (`React.lazy`). That is the code-split
boundary that keeps Chart.js, react-hook-form and Zod off the welcome and lobby path. The screens are lazy,
so they are fetched on the first render that actually shows one.

Without a backend, `/`, `/player-manual` and `/host-manual` still render — they need neither auth
nor the API. `/results/:publicId` and `/join/:roomCode` are also unguarded, but they have nothing
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
| `VITE_BOARD_VIEW` | `pages/GameRoomPlaying.tsx` | Optional, `2D` (the default) or `3D`. Both boards are registered. This is only the default for a browser that has *never chosen*: the in-game toggle writes `board_view` to `localStorage` and overrides it per browser. An unrecognised value falls through to `2D`. |

**There are no `VITE_FIREBASE_*` variables, and there must not be.** The Firebase web config is
six literals in `firebase.ts` at the repository root. Those values are public identifiers that
ship in the bundle to every visitor anyway — Firebase security comes from Auth rules and API-key
restrictions, not from hiding them — so keeping them in one committed file means there is exactly
one place to look and nothing to forget in CI. `src/__tests__/envSurface.test.ts` asserts both
halves of this: that `firebase.ts` is tracked at the root, and that no `VITE_FIREBASE_*` variable
exists anywhere.

`firebase.ts` is **committed** and must never be gitignored or moved into `src/`. The sibling
Tequila project once gitignored it while importing it from `src/` (since fixed): its CI could
not build the frontend, and the frontend silently never deployed while the backend kept
auto-deploying on push.

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
├── schemas/configSchema.ts     the host form's checks, built from GET /rooms/limits (no copy)
├── utils/storage.ts            alias, guest id, session_token, host_secret, host_room,
│                               host_batch, export_downloaded_*, display name, board_view
├── utils/clipboard.ts          copyToClipboard(): Clipboard API, then a textarea fallback
├── pages/                      one module per route, each exporting a `route` descriptor
│   ├── WelcomeScreen  HomePage  GameRoom  HostRoom
│   ├── MultiHostSetupPage (/multihost/new)  MultiHostDashboard (/multihost)
│   ├── GameRoomPlaying  HostConsole  ResultsPage  ProfilePage
│   ├── PlayerManualPage  HostManualPage
│   └── shellScreens.ts         the three `lazy()` screens, which export no `route`
├── components/
│   ├── shared/                 LoadingSpinner, Tooltip, AlertContainer, BackendWakeUp,
│   │                           Avatar, ErrorBoundary, NotFound, ScreenLoading,
│   │                           AuthGuard, BackendGuard, Select, JoinQrOverlay (full-screen
│   │                           join QR, drawn locally by qrcode.react), useMediaQuery
│   ├── lobby/                  the two lobbies, the player's name form (NameForm),
│   │                           participant list, role cards, invite panel
│   │                           (copy + Show QR), roomCode.ts (alphabet, inviteUrl)
│   ├── multihost/              the dashboard's GameCard (with a start refusal on the card),
│   │                           useRoomsSummary (polls POST /rooms/summary every 5 s, with
│   │                           asOf) and multihost.ts
│   │                           (openHostScreen, statusLabel, hostedRooms)
│   ├── config/                 the host configuration panel and its react-hook-form pieces;
│   │                           ConfigSections (the stateless form, shared by the lobby's
│   │                           ConfigPanel and /multihost/new), useConfigForm, useDraftConfig
│   │                           (a draft validated by POST /rooms/preview with a patch),
│   │                           useLimits (GET /rooms/limits) and useConfigPreview
│   │                           (POST /rooms/preview) — no generator, default or range here
│   ├── game/                   the player's week: decision panel, supply line, recap
│   │   └── views/              Board2D and Board3D (lazy) — the two registered board
│   │                           views — plus the 2D/3D toggle and the pure resolver
│   │       └── board3d/        the scene: buildSceneModel plus the three.js components
│   │                           that render its output and nothing else; the walk
│   │                           (keyboard + drag-look, and on touch screens the MovePad
│   │                           and a tappable Open button, spec §9.7)
│   ├── host/                   host console: chain diagram, controls, presentation mode
│   ├── results/                charts, cost tables, debrief notes, CSV/JSON export (by
│   │                           public_id, for every viewer)
│   ├── profile/                match history, games you hosted, stats, role breakdown, guest-claim prompt
│   ├── charts/                 chartSetup.ts (results view model + bullwhip builder),
│   │                           chartTheme.ts (every canvas colour), ChartBox, Legend,
│   │                           plugins/ (crosshair sync)
│   └── manual/                 ManualBook — the react-pageflip book both manuals are read in
└── __tests__/                  vitest, flat, one file per feature + setup.ts
```

### Four rules this codebase depends on

**The store is the single source of truth, and only socket handlers write to it.** Components
read. No component subscribes to the socket directly — a second interpreter of the wire gets
double-registered under StrictMode and left stale by a reconnect. There is no game arithmetic in
the client either: inventory, cost and eligibility all arrive from the server, including whether
the host's Start button may be pressed and the sentence explaining why not. That covers every
figure a rule defines: the host form's demand preview and lead times come from
`POST /rooms/preview`, the preset cards' figures from `/rooms/presets`, a new demand kind's
defaults from the server's merge, and the arrival week, the stock after arrival, each pipeline
slot's weeks to go and the weeks played from `your_state` / `host_state`. What stays here is
formatting, layout, chart scales, sorting and filtering.

**Handlers are registered once, as a module side effect, before React renders.** `main.tsx`
imports `./api/socketHandlers` ahead of `createRoot`. A component-mounted handler registers twice
under StrictMode and every event applies twice.

**`autoConnect` is `false` and `auth` is a callback.** The socket module evaluates before Firebase
has restored a persisted session, so auto-connecting would hand a returning signed-in user a
throwaway guest identity. The callback re-runs on every reconnect and picks up a refreshed token
rather than freezing the first one. A signed-in user whose token cannot be fetched sends no identity
at all (never the guest id) and is retried every 5 s while still signed in, saying "Could not
reach the game server. Retrying…". With no identity at all (a first visit, the auth watchdog,
after logout) the socket is not connected: the welcome screen, the manuals and the results page
need none. Reconnection never gives up (backing off to 10 s); while it is reconnecting, the player
and host screens show "Connection lost. Reconnecting…", and the order form confirms nothing while
the socket is not connected. A tab that moves off a room reconnects its socket at once, so no late
event of the old room reaches the new room's store.

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
| `host_room` | `sessionStorage` | UI hint only: which room this tab hosts. Never trusted by the server. |
| `host_batch` | `sessionStorage` | The multi-game dashboard's room codes (a JSON array). Only codes: each secret is under `host_secret_<room>`. |
| `export_downloaded_<public_id>_<format>` | `sessionStorage` | The results screen's "already downloaded this session" flag. **UX only**, not a guard: the backend's per-address export limit (100 an hour) is the real one. |
| display name | `localStorage` | Display data, sanitised on write. Written by the game screen's name form and the host name fields; it only prefills the next form and rides along on a rejoin. |
| `vite_preload_reloaded` | `sessionStorage` | Set when the page reloads once after a deploy removed a code-split chunk it asked for (`vite:preloadError` in `main.tsx`), so it never reloads in a loop. |
| `board_view` | `localStorage` | Display preference, **not a credential**; browser-wide on purpose, so a second tab keeps the choice. An unrecognised value is treated as unset. |

A host who closes the tab loses the secret, and recovers by verified identity instead — the server
re-authorises the claim and replies with a fresh secret. That is why the host lobby emits
`join_waiting` *with or without* a stored secret, and why it must not show the recovery screen
before the server has answered.

## Third-party 3D assets

The 3D board loads four models from `public/3dmodels/`. All four are **CC-BY-4.0**
(<https://creativecommons.org/licenses/by/4.0/>), which is an *attribution* licence: shipping
the meshes without visible credit is a licence breach, not a polish item. The credits are
reachable in the running app behind the 3D board's "3D model credits" disclosure, and the same
records live in `public/3dmodels/ATTRIBUTION.txt` and in each file's own glTF `asset.extras`.
**Do not run these files through any tool that strips `asset.extras`**, and if one is ever
re-exported, re-copy the record from the extras rather than retyping it here.

| File | Title | Author | Licence | Source |
|---|---|---|---|---|
| `box.glb` | Box, Low Poly | [FLAREMEDIA](https://sketchfab.com/flaremedia) | CC-BY-4.0 | [Sketchfab](https://sketchfab.com/3d-models/box-low-poly-c7a1ecb2355145bc91337e64f57bd0ec) |
| `truck.glb` | Low Poly Truck | [Arifido._](https://sketchfab.com/Arifido._) | CC-BY-4.0 | [Sketchfab](https://sketchfab.com/3d-models/low-poly-truck-98826ebd44e2492298ac925461509216) |
| `person.glb` | FREE Mecha Chameleon Character Model! | [xtiborz095](https://sketchfab.com/xtiborz095) | CC-BY-4.0 | [Sketchfab](https://sketchfab.com/3d-models/free-mecha-chameleon-character-model-4ebee377a562402980aafea2c1d99e0f) |
| `money.glb` | Low Poly Stack of Money | [Courvois](https://sketchfab.com/CourvoisZ) | CC-BY-4.0 | [Sketchfab](https://sketchfab.com/3d-models/low-poly-stack-of-money-632cf7dbc59a496283d1a6092dc6f9b0) |

`road.glb` from the same upstream set is deliberately **not** shipped: 8.1 MB for thirty
triangles, almost all of it textures for surfaces this scene draws procedurally.
