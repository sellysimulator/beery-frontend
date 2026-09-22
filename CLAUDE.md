# CLAUDE.md — Beery_Frontend

Orientation for an agent working in `Beery/Beery_Frontend`. Everything below was read out of
the code. Where something is unverified it says so.

---

## 1. What this app is

**Beery** is a web implementation of the **Beer Distribution Game** — a supply-chain
simulation. Four players form a chain `Customer → Retailer → Wholesaler → Distributor →
Factory`; orders flow upstream, shipments flow downstream, both with delays. Each simulated
*week* every role receives a shipment, fills its downstream order, pays holding/backlog cost
and decides a new order. A fifth participant, the **host**, configures and runs the session
but does not play and sees everything. The pedagogical payload is the **bullwhip effect**.
Missing roles can be filled by bots (Sterman anchor-and-adjust).

This repo is the **client only**:

| Piece | Where | What |
|---|---|---|
| `Beery_Frontend` (here) | Firebase Hosting, site `beersim`, project `beery-30d23` | React 19 + Vite 7 SPA |
| `Beery_Backend` | Render, `https://beery-backend.onrender.com` | FastAPI + Socket.IO, MySQL + Redis. Entry point `app.main:application`, dev port **8080** |
| `Novus/game_stack.md` | repo root, one level above `Beery/` | The shared "host + room" base stack every Novus game (Beery, Lemony, Pulky, Selly/Tequila, Supply) is built from |

`Novus/game_stack.md` is the **single source of truth**; `Beery/game_stack.md` and
`Beery_Frontend/docs/game_stack.md` are copies — never edit a copy. Selly ("Tequila Game")
is the working precedent whose *plumbing* was reused and whose *gameplay* was explicitly not.
Sections in `game_stack.md` marked `[HARD-WON]` encode bugs that shipped in Tequila; treat
them as non-negotiable.

## 2. Read these instead of re-deriving

- **`README.md`** (here) — prerequisites and the React `~19.2.0` tilde-pin rationale, setup,
  every npm script, the configuration table, the `src/` layout, the four architectural rules,
  and the storage-scope table. Read it first. It was corrected on 2026-09-21 (shipped-screen
  inventory, the three real env vars, test counts), so it now agrees with the code.
- **`DEPLOY.md`** (here) — hosting topology, build-time env vars and where CI gets them,
  the SPA rewrite, the "ship frontend and backend together" wire-contract rule, the deploy
  checklist and the two failure modes the config guards against.
- **`docs/`** (here) — `beer-game-spec.md` (game rules/parameters/roles; wins on game
  semantics), `beer-game-manual.md` (host + player manuals; wins on copy and UX voice),
  `game_stack.md` (copy of the root file).
- **`../docs/plan/`** — the 24 numbered section contracts the whole app was built against,
  plus `00-decisions.md` (frozen decisions, `D<n>`), `00-conventions.md` (naming, error and
  event shapes, testing rules), `BUILD-LOG.md` (authoritative build record, 149K) and
  `HANDOFF.md`. Code comments cite these constantly as `16 §3`, `D18`, `03-game-config.md §2`.
  When a comment cites a section, that document is the contract — go read it.

## 3. Directory layout

```
firebase.ts              Firebase web config, AT THE REPO ROOT, not in src/. Committed.
index.html               preconnects to Google's auth hosts; title/description live here
public/                  favicon.svg, icons.svg (sprite), and 3dmodels/
public/3dmodels/         box/truck/person/money .glb + ATTRIBUTION.txt. CC-BY-4.0, credited
                         in README and in-app; each .glb carries its record in asset.extras
                         — never strip it. Served by Hosting before rewrites; no road.glb
docs/                    product docs (above)
src/
  main.tsx               imports ./api/socketHandlers for side effect, THEN mounts:
                         StrictMode > ErrorBoundary > AuthProvider > BackendStatusProvider
                         > BrowserRouter > (AlertContainer + App)
  App.tsx                renders only <Routes>; names no page; owns guard composition
  index.css              Tailwind v4 CSS-first @theme — there is NO tailwind.config.js
  routes/registry.ts     collectRoutes() (testable) / discoverRoutes() (import.meta.glob)
  api/                   http.ts, socket.ts, socketHandlers.ts, games.ts, rooms.ts,
                         health.ts, users.ts
  auth/AuthContext.tsx   Firebase auth + socket (re)connect + /users/upsert
  contexts/BackendStatusContext.tsx   health poll, 'checking' | 'ok' | 'down'
  store/gameStore.ts     the one Zustand store
  types/game.ts          TS mirrors of every wire payload (647 lines)
  schemas/configSchema.ts  Zod mirrors of GameConfig — a UI hint, not a gate
  utils/storage.ts       the only module that touches localStorage/sessionStorage
  pages/                 one module per route; each exports `route`
  components/
    shared/  lobby/  config/  game/  host/  results/  profile/
    manual/  charts/chartSetup.ts
    game/views/          Board2D.tsx, Board3D.tsx (lazy), BoardViewToggle.tsx,
                         boardViewChoice.ts — the two registered boards and the seam
    game/views/board3d/  the 3D scene. sceneModel.ts is the pure heart (see §6.14);
                         everything else either renders its output or is frozen data
                         (sceneLayout.ts, scenePalette.ts, roleSets.ts)
  __tests__/             all tests, flat, one file per feature + setup.ts
```

Conventions: components are `PascalCase.tsx` with a **named export and a default export** of
the same symbol; non-component helpers are `camelCase.ts` (`roleCopy.ts`, `configPatch.ts`,
`demandSeries.ts`). Wire fields are `snake_case` (they mirror the Python models); local
TypeScript identifiers are `camelCase`. Comments are prose explaining *why*, and are load-
bearing documentation — match that style.

**Routes** (path, guard, from the `route` descriptors):

| Path | Guard |
|---|---|
| `/` | public |
| `/player-manual`, `/host-manual` | public |
| `/results/:roomCode` | public |
| `/join/:roomCode` | public (redirect into `/game/:roomCode`) |
| `/home`, `/game/:roomCode`, `/host/:roomCode` | auth+backend |
| `/profile`, `/profile/games/:gameId` | auth+backend |

## 4. Commands

```bash
npm ci                 # install (Node >= 20.19; .nvmrc pins 20.19.0)
npm run dev            # vite, http://localhost:5173, proxies /api + /socket.io to :8080
npm run build          # tsc -b (all three TS projects) && vite build -> dist/
npm run preview        # serve the built bundle
npm run lint           # eslint .
npm test               # vitest, watch
npm run test:run       # vitest run
npx tsc -b             # typecheck only (what CI runs)
firebase deploy --only hosting     # manual deploy; CI normally does it
```

Verified green on 2026-09-21: **760 tests / 26 files passed**, `eslint .` clean, `tsc -b`
clean. `vitest run --reporter=basic` no longer exists in Vitest 4 — use the default
reporter.

CI (`.github/workflows/firebase-hosting-{merge,pull-request}.yml`) runs, on push to `main`
and on PRs: `setup-node` from `.nvmrc` → `npm ci` → `npx tsc -b` → `npx eslint .` →
`npx vitest run` → `npm run build` (with `VITE_*` from repo *variables* and
`REQUIRE_BACKEND_ENV: '1'`) → `FirebaseExtended/action-hosting-deploy`.

## 5. Configuration that matters

**Env vars** — build-time only, read via `import.meta.env`. A change needs a rebuild.

| Var | Read in | Notes |
|---|---|---|
| `VITE_API_BASE_URL` | `api/http.ts`, `api/health.ts` | Empty → relative `/api/v1`, i.e. the dev proxy |
| `VITE_SOCKET_URL` | `api/socket.ts` | Must be the **backend host** in prod. Firebase Hosting does not proxy WebSocket upgrades |
| `VITE_BOARD_VIEW` | `pages/GameRoomPlaying.tsx` | Optional; `'2D'` (default) or `'3D'` — both are registered. Only the default for a browser with no stored `board_view`; the in-game toggle overrides it per browser. Unrecognised → `'2D'` (`24 §2.2`, **D20**) |

There are **no `VITE_FIREBASE_*` variables and there must not be.** The web config is six
literals in `/firebase.ts` at the repo root, imported as `'../../firebase'` by
`auth/AuthContext.tsx`, `api/socket.ts` and `api/http.ts`. That file is deliberately
**committed** — gitignoring it while `src/` imports it is what silently stopped Tequila's
frontend from ever deploying. `.env` *is* gitignored. `envSurface.test.ts` asserts all of this.

**`vite.config.ts`** (read it, it is commented):
- Exported from `vitest/config`, so test config lives in the same file:
  `{ environment: 'jsdom', setupFiles: ['./src/__tests__/setup.ts'], globals: true }`.
- Plugins: `@vitejs/plugin-react`, `@tailwindcss/vite`, and a local
  **`beery:require-backend-env`** plugin. It fails the build when `VITE_API_BASE_URL` or
  `VITE_SOCKET_URL` is empty or matches `web.app|firebaseapp.com` — but **only** when
  `REQUIRE_BACKEND_ENV=1`, which only the two CI workflows set. Local builds stay unaffected.
- `build.rollupOptions.output.manualChunks` splits vendors into `firebase`, `charts`,
  `socket`, `forms`, `react`, `three`, `vendor`. Keep `engine.io-*` with `socket.io-client`,
  `@firebase/*` with `firebase`, and drei's `troika-*` / `bidi-js` / `webgl-sdf-generator`
  and fiber's `react-reconciler` / `its-fine` / `suspend-react` with `three` — splitting any
  of them from their entry point breaks the chunking. `chunkSizeWarningLimit` is `1200`
  because the `three` chunk is ~1.1 MB, lazy, and never in the entry graph (`24 §6.4`).
- `server.proxy`: `/api → http://localhost:8080`, `/socket.io → :8080 with ws: true`.

**There are no path aliases.** No `resolve.alias`, no `compilerOptions.paths`. Every import
is relative; `firebase.ts` is `'../../firebase'` from inside `src/**/`.

**TypeScript is three projects** under a solution `tsconfig.json`:
`tsconfig.app.json` (`src` + `firebase.ts`, **excludes `src/__tests__`**, `types: ["vite/client"]`),
`tsconfig.node.json` (`vite.config.ts` only, node types),
`tsconfig.test.json` (`src/__tests__` + `src/vite-env.d.ts`, `types: ["node","vitest/globals","@testing-library/jest-dom"]`).
So: **test-only globals and node APIs are not available in app code, and vice versa.** All
three are strict with `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly` and
`verbatimModuleSyntax` — use `import type` for type-only imports or the build fails.

**Firebase**: `firebase.json` → `public: "dist"`, catch-all rewrite `** → /index.html` (the
SPA deep-link fix). `.firebaserc` default project `beery-30d23`; hosting **site** is `beersim`.

## 6. Architecture — the rules to not break

1. **One Zustand store (`store/gameStore.ts`), written only by socket handlers.** Components
   read. There is no game arithmetic in the client: inventory, cost, eligibility, even
   whether the host's Start button may be pressed and the sentence explaining why not, all
   arrive from the server. Client-derived state is the failure mode `game_stack.md`
   invariant 7 exists to prevent.
2. **Socket listeners are registered once, at module load,** in `api/socketHandlers.ts`,
   imported by `main.tsx` before `createRoot`. Never `socket.on(...)` inside a component:
   StrictMode double-registers it and a reconnect leaves it stale. Handlers call
   `useGameStore.getState()` so they never close over a stale snapshot.
3. **Every server→client game event carries a monotonic `seq`.** `applySequenced` drops any
   event with `seq <= lastSeq`, which is also what makes accidental double-application inert.
   `joined`, `join_error`, `host_claimed`, `leave_ack` and `error` carry no `seq`.
4. **The socket does not auto-connect.** `autoConnect: false`, and `auth` is a **callback**
   so it re-runs with a fresh ID token on every reconnect. `AuthContext` connects it once
   `onAuthStateChanged` resolves (or after an 8s watchdog). Auto-connecting would hand a
   returning signed-in user a guest identity.
5. **Pages register themselves.** A module in `src/pages/*.tsx` exports
   `route: RouteDescriptor | RouteDescriptor[]`; `discoverRoutes()` globs them. Adding a
   screen is adding a file — **never edit `App.tsx`'s route table** (there isn't one).
   Guards compose auth-outside-backend via the descriptor's `guard` field.
6. **`pages/shellScreens.ts` is a lazy, non-eager glob seam.** `GameRoomPlaying`,
   `HostConsole` and `ConfigPanel` are resolved by path+name into `React.lazy`, so they are
   code-split away from the welcome/lobby path. Those three modules therefore export **no**
   `route` — the registry's glob must not pick them up.
7. **Emits go through `api/games.ts`, REST through `api/rooms.ts` / `users.ts` / `http.ts`.**
   One function per wire event. Authority is always the `host_secret` (socket payload, or
   `X-Host-Secret` header); the store's `isHost` is a UI hint and is never sent. No payload
   carries a client-computed total, and no path or body carries a user id — the backend
   derives it from the bearer token that `http.ts`'s interceptor attaches.
8. **Types mirror the backend by hand** in `src/types/game.ts` (there is no codegen).
   `X | None` on the Python side is `X | null` here, never `undefined`; `?` means the key can
   be *absent*. Wire-shape changes must land in `Beery_Backend` and here **in the same deploy
   window, backend first** (DEPLOY.md).
9. **Data fetching**: no react-query. REST is plain `async` axios calls in `useEffect` /
   handlers; live data is push-only over the socket into the store. The health probe
   (`api/health.ts`) uses bare `fetch` on purpose (no interceptors) and requires
   `{"status":"ok"}` in the body — a 2xx alone would be satisfied by the Hosting SPA rewrite.
10. **Errors**: every axios error goes through `errorMessage(err, fallback)` in `api/http.ts`.
    FastAPI returns `detail` as a string for `HTTPException` but an **array of objects** for
    422 — rendering that array directly white-screens React. Server `error` events land in
    `store.lastError` (`{message, code}`) plus an alert; a screen maps a specific `code` to
    its own copy. `ErrorBoundary` is the outermost component in `main.tsx`.
11. **Styling is Tailwind v4, CSS-first.** All design tokens are `@theme` variables in
    `src/index.css` (surface/ink/brand/role/quantity colours, `--text-figure`). Use the
    semantic tokens (`bg-surface`, `text-ink-muted`, `text-role-retailer`), not raw hexes.
    Palette is Okabe-Ito for colour-blind safety, and **colour is never the only signal** —
    backlog and alerts always carry an icon and a label too.
12. **Forms**: react-hook-form + Zod, only in the host config panel.
    `schemas/configSchema.ts` is a *hint* — a value it rejects is still sent, because the
    server clamps and the panel renders the clamped value back. `useConfigSave` debounces
    400ms, sends over the socket when connected and falls back to
    `PUT /rooms/{code}/config` when not (that REST reply has no `seq`, so it goes through
    `setConfig`, never `applyConfigUpdated`).
13. **Charts**: Chart.js + react-chartjs-2, registered piecemeal in
    `components/charts/chartSetup.ts`, which also owns the `ResultsView` view model and the
    pure `buildBullwhipConfig` builder — a canvas is opaque to jsdom, so the *config object*
    is what tests assert.
14. **The 3D board computes nothing and emits nothing.** `board3d/sceneModel.ts`'s
    `buildSceneModel(props)` returns a plain object — every pile count, sign string, fixture
    id, model placement, light, accent and prompt — and `WarehouseScene` walks it and emits
    meshes, *adding nothing the model does not carry*. A geometry decision taken inside a
    component instead of inside the model is untestable and is therefore a defect: jsdom has
    no WebGL, so the object is what `Board3D.test.tsx` asserts, exactly as rule 13's config
    object stands in for a Chart.js canvas. The interaction layer is the same rule from the
    other side — pressing E at a station mounts the **existing** 2D components
    (`DecisionForm`, `WaitingForOthers`, `SettlementRecap`, `DecisionPanel`) with the same
    props and the same callbacks, so the only emit the 3D view can produce is `submit_order`
    through `api/games.ts` (rule 7), and there is no new event, endpoint or `GameConfig`
    field behind any of it. **A figure on screen that cannot be traced to a `PlayerView`
    field is a bug**, including a plausible one: a settlement whose
    `holding_cost ≠ closing_inventory × rate` renders the server's figure, never the product
    (`24 §8.1`, `24 §9` AC 6, `19` FM 4). This is rule 1 wearing a different hat.

## 7. Storage scopes — not interchangeable

`utils/storage.ts` is the only module allowed to touch Web Storage.

| Value | Area | Why |
|---|---|---|
| `alias` | localStorage | Public; the id in every broadcast |
| `guest_id` (`guest_<uuid4>`) | localStorage | Stable per browser; makes guest reconnect work |
| `session_token_<room>` | localStorage | Secret; the reconnect credential |
| `host_secret_<room>` | **sessionStorage** | Secret **and tab-scoped** — in localStorage it leaks host authority into a tab opened from an invite link |
| `host_room` | sessionStorage | UI hint only; never trusted by the server |
| `display_name` | localStorage | Display data, sanitised on write (max 24, control chars handled two different ways — read the comment before touching it) |
| `board_view` (`'2D'` \| `'3D'`) | localStorage | Display preference, **not a credential**, and deliberately browser-wide rather than tab-scoped: it is the one choice a player should not have to re-make in a second tab, and it grants nothing. Unrecognised → treated as unset, never an error (`24 §2.3`) |

**D18 host recovery**: closing the tab loses `host_secret`. The host lobby therefore emits
`join_waiting` **with or without** a stored secret, and the server re-authorises against the
verified identity and replies `host_claimed` with a fresh one. Guarding that emit on
`getHostSecret() !== null` silently disables the whole recovery path — the symptom is a
permanently paused game, not an error.

## 8. Gotchas

- **Don't add a `tailwind.config.js`** — v4 is CSS-first and the theme is in `index.css`.
- **Don't put `firebase.ts` in `.gitignore`** and don't move it into `src/`. `DEPLOY.md`'s
  checklist and `envSurface.test.ts` both assert it stays tracked at the root.
- **Don't point `VITE_SOCKET_URL` at `beersim.web.app`** or any `*.web.app` /
  `*.firebaseapp.com` origin. REST would appear to work (the `**` rewrite answers 200 with
  `index.html`) while every realtime feature dies.
- **Tests run real toolchain commands.** `routes.test.tsx` shells out (`execFileSync`) to
  `tsc -b` / `eslint .` / `npm run build`, and `envSurface.test.ts` reads `firebase.json`,
  both workflow YAMLs, `DEPLOY.md`, `.env.example`, `.gitignore` and `firebase.ts` as data.
  Editing CI or deploy config will break tests — update them together.
- **`src/__tests__/setup.ts` deliberately uses jsdom's real `localStorage` and
  `sessionStorage`** (a shim only fills in when the runtime shadows them). Don't replace them
  with one shared double: the difference between the two areas is the most important storage
  assertion in the suite. It also clears both, resets the URL to `/`, and stubs `matchMedia`,
  `ResizeObserver` and `scrollTo`.
- **Effects that emit must be StrictMode-idempotent.** `GameRoom` uses a `useRef` latch
  around its `join` emit. Server-side idempotency exists to survive reconnects, not to paper
  over a double-joining UI.
- **`eslint-plugin-react-refresh` fires on a module that exports both a component and a
  hook.** `AuthContext.tsx` and `BackendStatusContext.tsx` carry a targeted
  `// eslint-disable-next-line react-refresh/only-export-components`. Follow that pattern
  rather than disabling the rule globally.
- **Third-party avatars**: `lh3.googleusercontent.com` 429s on some `Referer`s (routine on
  localhost). `Avatar` uses `referrerPolicy="no-referrer"` plus an initial fallback.
- `App.tsx` mounts **no router and no provider** — that is what lets tests render `<App />`
  inside a `<MemoryRouter initialEntries={[...]}>` at any path. Keep it that way.
- Without a backend, only `/`, `/player-manual` and `/host-manual` render; everything else
  sits behind `BackendGuard`'s wake-up screen (Render free tier cold-starts in 30–60s).
