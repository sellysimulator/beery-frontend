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
Missing roles can be filled by bots (Sterman anchor-and-adjust), but only roles nobody holds:
the server refuses to start while a person in the room has no role, and the host lobby shows
its reason naming them (the host can seat people in Host assigns and Players choose).

This repo is the **client only**:

| Piece | Where | What |
|---|---|---|
| `Beery_Frontend` (here) | Firebase Hosting, site `beersim`, project `beery-30d23` | React 19 + Vite 7 SPA |
| `Beery_Backend` | Render, `https://beery-backend.onrender.com` | FastAPI + Socket.IO, PostgreSQL + optional Redis. Timestamps arrive as ISO-8601 UTC with `Z`. Entry point `app.main:application`, dev port **8080** |
| `Novus/game_stack.md` | repo root, one level above `Beery/` | The shared "host + room" base stack every Novus game (Beery, Lemony, Pulky, Selly/Tequila) is built from |

`Novus/game_stack.md` is the **single source of truth**; `Beery/game_stack.md` and
`Beery_Frontend/docs/game_stack.md` are copies — never edit a copy. Selly ("Tequila Game")
is the working precedent whose *plumbing* was reused and whose *gameplay* was explicitly not.
Sections in `game_stack.md` marked `[HARD-WON]` encode bugs that shipped in Tequila; treat
them as non-negotiable.

## 2. Read these instead of re-deriving

- **`README.md`** (here) — prerequisites and the React `~19.2.0` tilde-pin rationale, setup,
  every npm script, the configuration table, the `src/` layout, the four architectural rules,
  and the storage-scope table. Read it first.
- **`DEPLOY.md`** (here) — hosting topology, build-time env vars and where CI gets them,
  the SPA rewrite, the "ship frontend and backend together" wire-contract rule, the deploy
  checklist and the two failure modes the config guards against.
- **`docs/`** (here) — `beer-game-spec.md` is the product contract (rules, parameters,
  screens, data model, API; **§15 Decisions** holds the `D<n>` code comments cite, as in
  `D18`, and **§16 Not built yet**); `beer-game-manual.md` (host + player manuals) is the
  product voice; `game_stack.md` is a copy of the root file and wins on shared plumbing,
  except where spec §15 records a deliberate departure. Code comments cite spec sections as
  `spec §9.7`. Git history holds the build record.

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
  types/game.ts          TS mirrors of every wire payload
  schemas/configSchema.ts  buildConfigFormSchema(limits): the host form's checks, built
                         from the server's ranges (GET /rooms/limits) — no copy here
  utils/storage.ts       the only module that touches localStorage/sessionStorage
  pages/                 one module per route; each exports `route`
  components/
    shared/  lobby/  config/  game/  host/  results/  profile/  manual/  multihost/
    charts/              chartSetup.ts (results view model + bullwhip builder),
                         chartTheme.ts (every canvas colour), ChartBox.tsx, Legend.tsx,
                         plugins/crosshairSync.ts + plugins/CrosshairGroup.tsx
    results/resultsChartsConfig.ts, game/ownHistoryConfig.ts,
    host/demandCurveConfig.ts, profile/bullwhipTrendConfig.ts
                         the other charts' pure builders, one module beside each chart
    game/views/          Board2D.tsx, Board3D.tsx (lazy), BoardViewToggle.tsx,
                         boardViewChoice.ts — the two registered boards and the seam
    game/views/board3d/  the 3D scene. sceneModel.ts is the pure heart (see §6.14);
                         everything else either renders its output or is frozen data
                         (sceneLayout.ts, scenePalette.ts, roleSets.ts). playerMotion.ts
                         holds the controller's pure decisions, MovePad.tsx the touch pad
  __tests__/             all tests, flat, one file per feature + setup.ts
```

Conventions: components are `PascalCase.tsx` with a **named export and a default export** of
the same symbol; non-component helpers are `camelCase.ts` (`roleCopy.ts`, `configPatch.ts`,
`useConfigPreview.ts`). Wire fields are `snake_case` (they mirror the Python models); local
TypeScript identifiers are `camelCase`. Comments are prose explaining *why*, and are load-
bearing documentation — match that style.

**Routes** (path, guard, from the `route` descriptors):

| Path | Guard |
|---|---|
| `/` | public |
| `/player-manual`, `/host-manual` | public |
| `/results/:publicId` | public — the one results URL (D22), by the game's `public_id`; never a room code |
| `/join/:roomCode` | public (redirect into `/game/:roomCode`) |
| `/home`, `/game/:roomCode`, `/host/:roomCode` | auth+backend |
| `/multihost/new`, `/multihost` | auth+backend |
| `/profile`, `/profile/games/:publicId` | auth+backend |

## 4. Commands

```bash
npm ci                 # install (engines ^22.23.4 || ^24.22.1 || >=26.12.1; .nvmrc pins 24.22.1)
npm run dev            # vite, http://localhost:5173, proxies /api + /socket.io to :8080
npm run build          # tsc -b (all three TS projects) && vite build -> dist/
npm run preview        # serve the built bundle
npm run lint           # eslint .
npm test               # vitest, watch
npm run test:run       # vitest run
npx tsc -b             # typecheck only (what CI runs)
firebase deploy --only hosting     # manual deploy; CI normally does it
```

`vitest run --reporter=basic` no longer exists in Vitest 4 — use the default reporter.

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
| `VITE_BOARD_VIEW` | `pages/GameRoomPlaying.tsx` | Optional; `'2D'` (default) or `'3D'` — both are registered. Only the default for a browser with no stored `board_view`; the in-game toggle overrides it per browser. Unrecognised → `'2D'` (spec §9.7, **D20**) |

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
  because the `three` chunk is ~1.1 MB, lazy, and never in the entry graph.
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
SPA deep-link fix), and `headers`: `/3dmodels/**` and `/assets/**` immutable for a year,
`/index.html` and every extensionless path (`^/[^.]*$`) `no-cache`, and `nosniff` +
`strict-origin-when-cross-origin` on everything. No `X-Frame-Options` or CSP: Firebase Auth's
iframe and handler could break. `envSurface.test.ts` pins them. `main.tsx` reloads once on
`vite:preloadError` (a chunk a deploy removed; `claimPreloadReload()` in `utils/storage.ts`). `.firebaserc` default project `beery-30d23`; hosting **site** is `beersim`.

## 6. Architecture — the rules to not break

1. **One Zustand store (`store/gameStore.ts`), written only by socket handlers.** Components
   read. There is no game arithmetic in the client: inventory, cost, eligibility, even
   whether the host's Start button may be pressed and the sentence explaining why not, all
   arrive from the server. Client-derived state is the failure mode `game_stack.md`
   invariant 7 exists to prevent. **Every figure a rule defines is the server's** (spec §15):
   no demand generator, delay sum, default, preset number, cost, ratio or running total is
   worked out here. The server sends the figures a client would be tempted to sum:
   `your_state.order_arrival_week` (never `week + order_arrival_lead_weeks`),
   `settlement.inventory_after_arrival` (never `opening_inventory + arrived`),
   `supply_line_slot_weeks` / `orders_in_flight_slot_weeks` (never a slot's `index + 1`) and
   `host_state.weeks_played` (never `host_state.week`). If a screen needs a new figure, add it to
   the backend payload or route — never a formula here. Allowed: formatting, layout, chart
   scales and axes, sorting, filtering.
2. **Socket listeners are registered once, at module load,** in `api/socketHandlers.ts`,
   imported by `main.tsx` before `createRoot`. Never `socket.on(...)` inside a component:
   StrictMode double-registers it and a reconnect leaves it stale. Handlers call
   `useGameStore.getState()` so they never close over a stale snapshot.
3. **Every server→client game event carries a monotonic `seq`.** `applySequenced` drops any
   event with `seq <= lastSeq`, which is also what makes accidental double-application inert.
   `joined`, `join_error`, `host_claimed`, `leave_ack` and `error` carry no `seq`.
   `seq` is per room, so **`setRoomCode` with a different code starts the store over**
   (keeping only the alerts, the connection state and the dashboard's batch): "Play again"
   or Home's create/join in the same tab would otherwise keep the finished room's `lastSeq`
   and drop every event of the new one. The same code changes nothing.
   Three appliers merge rather than replace: `applyYourState` keeps the held `own_history`
   when the payload omits it (the per-round `your_state`), but only for the same role;
   `applyYourWeekClosed` appends the record unless that week is already held; and
   `applyGameStarted` never writes `config_public` into `config` (it would overwrite the
   host's full config). `join_error` both sets `joinError` (the durable signal HostRoom's
   recovery screen keys on, since before the first reply "refused" and "not answered yet"
   look identical) and raises an alert; `applyJoined` clears it.
4. **The socket does not auto-connect.** `autoConnect: false`, and `auth` is a **callback**
   so it re-runs with a fresh ID token on every reconnect. `AuthContext` connects it once
   `onAuthStateChanged` resolves (or after an 8s watchdog), but **never with no identity**:
   with no Firebase user and no stored guest id (a first visit, the watchdog, after logout)
   `reconnectSocket` calls `socket.disconnect()` and returns, because the server would refuse
   the handshake and the refusal is an alert over the welcome screen, manuals or results page,
   which need no socket. Auto-connecting would hand a
   returning signed-in user a guest identity. A signed-in user whose `getIdToken()` fails
   sends `{ idToken: null, guestId: null }`, **never** the guest id (the server refuses a
   handshake with no identity), and `socketHandlers.ts` retries that refusal with
   `socket.connect()` every 5 s (`SIGNED_IN_RETRY_DELAY_MS`) while `auth.currentUser` is set,
   saying "Could not reach the game server. Retrying…" (an info alert, no sign-out advice).
   **Reconnection never gives up**: no `reconnectionAttempts` (Socket.IO's default,
   Infinity), `reconnectionDelayMax: 10000`. A drop after the first connect sets
   `store.reconnecting` (written by the `connect`/`disconnect` handlers; this page's own
   `disconnect()` does not count), which shows `shared/ReconnectingNotice` ("Connection lost.
   Reconnecting…") on `/game/:roomCode` and `/host/:roomCode` (mounted in their route
   elements). `DecisionForm`'s Confirm (and its submit handler) is gated on `store.connected`,
   true only while the socket is connected, never on `reconnecting`, which stays false through
   the page's own `disconnect().connect()`: Socket.IO would buffer the emit and replay it before
   the rejoin, where the server refuses it. `connected` and `reconnecting` belong to the tab:
   `setRoomCode`, `reset` and `applyLeaveAck` keep them.
   **A tab that moves off a room reconnects its socket** (`useGameStore.subscribe` in
   `socketHandlers.ts`: `roomCode` changed from a code, socket connected →
   `disconnect().connect()`), synchronously with the store's reset. One late event of the old
   room, with its higher `seq`, would otherwise make the fresh store drop every event of the
   new one, and a player on the new room's name form sends no `join` that could move the
   socket. The server treats the old connection's drop as leaving that room.
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
   window, backend first** (DEPLOY.md). The handoff-hardening release is backend first too: the old
   frontend connects with no identity on a first visit, which the new backend refuses.
9. **Data fetching**: no react-query. REST is plain `async` axios calls in `useEffect` /
   handlers; live data is push-only over the socket into the store. The health probe
   (`api/health.ts`) uses bare `fetch` on purpose (no interceptors) and requires
   `{"status":"ok"}` in the body — a 2xx alone would be satisfied by the Hosting SPA rewrite.
10. **Errors**: every axios error goes through `errorMessage(err, fallback)` in `api/http.ts`.
    FastAPI returns `detail` as a string for `HTTPException` but an **array of objects** for
    422 — rendering that array directly white-screens React. Server `error` events land in
    `store.lastError` (`{message, code}`) plus an alert; a screen maps a specific `code` to
    its own copy. `ErrorBoundary` is the outermost component in `main.tsx`.
    **Abuse limits** (backend `app/core/abuse.py`) are mapped in those same two places only:
    `errorMessage` turns 429 (with `Retry-After` seconds when CORS exposes it), 503 and 413
    into fixed sentences whatever the `detail`, and `isRateLimited(err)` lets
    `useConfigPreview` keep its last answer silently on a 429. In `socketHandlers.ts`,
    `error` with `code: "RATE_LIMITED"` and a `join_error` carrying the backend's
    rate-limit sentence get friendly text, and that `join_error` is alert-only (as
    `joinError` it would put up HostRoom's recovery screen). A refused handshake is told apart by its message: the per-IP socket cap raises
    `ConnectionRefusedError` with exactly `CAP_REFUSAL_MESSAGE` ("Too many connections from
    your network. Try again in a minute."), which `classifyConnectError` calls `cap` and
    retries with bounded jittered backoff because Socket.IO never retries a `CONNECT_ERROR`
    itself; any other refusal (the generic `Connection rejected by server`, a failed ID token)
    is `auth`: while signed in it says "Could not reach the game server. Retrying…" and is
    retried every 5 s (rule 4); otherwise the sign-in message, not retried.
    A 429 that would leave the UI stuck is retried after its `Retry-After`
    (`retryAfterMs(err)` in `http.ts`, 1–60 s, 5 s when hidden): `useConfigPreview` asks for
    the same draft again, and `useDraftConfig` resends the edit (it stays in flight, so
    `/multihost/new`'s Create comes back by itself instead of sitting behind an error).
11. **Styling is Tailwind v4, CSS-first.** All design tokens are `@theme` variables in
    `src/index.css` (surface/ink/brand/role/quantity colours, `--text-figure`). Use the
    semantic tokens (`bg-surface`, `text-ink-muted`, `text-role-retailer`), not raw hexes.
    Palette is Okabe-Ito for colour-blind safety, and **colour is never the only signal** —
    backlog and alerts always carry an icon and a label too.
    **Safe area** (`game_stack.md` "edge to edge … inside the safe area"):
    `index.html` sets `viewport-fit=cover`, `body` pads by the left/right insets, and every
    `fixed` control (and every edge-anchored element of the 3D HUD) offsets by
    `max(<gutter>, env(safe-area-inset-<edge>))`, e.g. `left-[max(1rem,env(safe-area-inset-left))]`;
    a stacked one uses `calc(max(…)_+_<offset>)`. Never a bare `left-4`/`top-4` on a fixed
    element, and size flow content with `w-full`, not `w-screen`/`100vw`.
12. **Forms**: react-hook-form + Zod, only in the host config form (the lobby's `ConfigPanel`
    and, over a draft, `/multihost/new`; both render `ConfigSections`). **The ranges are the
    server's, never ours**: `useLimits()` fetches `GET /rooms/limits` once and
    `buildConfigFormSchema(limits)` builds every check, `min`/`max` and hint from it (sections
    read `ConfigFormContext.limits`); there is no `FORM_LIMITS` and must never be one — add a
    bound to the backend's `core/limits.py`. Until the ranges arrive the panel shows its
    loading line. **A value outside its range is refused, never clamped**: `NumberField` does
    not send it and the Zod message shows beside it; the server refuses one that arrives
    anyway (422 / `join_error` naming the field and the range). The order form does the same
    with `your_state.min_order_quantity`/`max_order_quantity`. There are no negative orders.
    `useConfigSave` debounces 400ms, sends over the socket when connected and falls back to
    `PUT /rooms/{code}/config` when not (that REST reply has no `seq`, so it goes through
    `setConfig`, never `applyConfigUpdated`). Tests that mount the panel must serve
    `/rooms/limits` (`src/__tests__/limitsFixture.ts`).
    **The preview is the server's too**: `useConfigPreview(draft)` posts the
    stored config (with the just-picked generator or the unsaved `CUSTOM` paste in place of
    its demand) to `POST /rooms/preview`, debounced 300ms, answers shared by draft, so
    `DemandPreview` and the starting grid's `LeadTimeRow` make one request. Until the answer
    for that exact draft arrives they show a placeholder (`DemandPreview` carries no
    `data-series` until then); a refused draft shows the server's 422 text. There is no
    `demandSeries.ts`, no `demandDefaults.ts` and no placeholder config: a kind change sends
    `{demand: {kind}}` and the server fills the defaults (the block says it is loading them);
    choosing `CUSTOM` sends nothing until a series is pasted, which goes as
    `{kind: 'CUSTOM', values}`. Preset cards print the server's `label`/`description`
    verbatim. Tests that mount the panel serve `/rooms/preview` too and call
    `resetPreviewCacheForTests()` in `beforeEach`. The bot slider must not call β=1
    "steady" — it is milder, not steady (spec §8.5).
    Inputs render from the stored config (`store.config`, or the draft on `/multihost/new`);
    react-hook-form only holds the in-flight keystrokes of the field being edited. A numeric
    blur and any switch toggle save immediately (otherwise the 400ms debounce), and every
    patch is leaf-level and carries `preset_name: null` (e.g.
    `{roles: {RETAILER: {initial_inventory: 14}}}`). Each control's `name` is its dotted wire
    path (`roles.RETAILER.initial_inventory`, `bot.beta`) and its `id` is `config-` + the path
    with dots as dashes; a server-rejected field gets `aria-invalid` with its message via
    `aria-describedby`. Tests find fields by these.
13. **Charts**: Chart.js + react-chartjs-2, registered piecemeal (each chart module
    registers what it uses; `ChartJS.register` is idempotent). `components/charts/chartSetup.ts`
    owns the `ResultsView` view model and `buildBullwhipConfig`. Every chart has a **pure
    builder** whose output the component passes straight through: a canvas is opaque to
    jsdom, so the *config object* is what tests assert, and tests never mock `chart.js` or
    `react-chartjs-2`. The kit (the charts themselves are spec §9.8):
    - **`charts/chartTheme.ts`** is the only place a canvas colour literal may live
      (`CHART_TOKENS`, keyed by the `--color-*` token it mirrors, plus `roleStyle(role)` and
      `withAlpha`). `chartTheme.test.ts` fails when a literal drifts from `src/index.css`. A
      new hex anywhere else in `src/` is a bug, except in `board3d/`'s own frozen palette.
    - **`charts/ChartBox.tsx`** holds every new chart: an HTML title, the canvas in a
      `role="img"` wrapper inside an `ErrorBoundary`, and a "Show table" toggle that unhides
      the *same* screen-reader table, never a second copy.
    - **`charts/Legend.tsx`** is the DOM legend. Its switches are `role="switch"` +
      `aria-checked` + `data-series`, named exactly by the series label. The canvas legend
      stays off.
    - **`charts/plugins/crosshairSync.ts`** syncs the hovered week across charts that opt
      in with `plugins.crosshairSync.group`. Wrap them in `plugins/CrosshairGroup.tsx` and
      import `CrosshairGroup`/`useCrosshairGroup` from there. Inside a group, `ChartBox`
      makes the canvas wrapper focusable (`tabIndex` 0) and ArrowLeft/ArrowRight step the
      shared crosshair, clamped to the shortest series in the group.

    Plot **server fields only**: a combination of two values is shown with geometry
    (stacking, a sign flip below the axis), never as a computed series (rule 14's principle).
    **B5 and B6, the host's live order streams on `DemandCurve` and the lane chips on
    `ChainDiagram`, render on the host console only, never under `presenting`**: players
    watch the projector, and mid-game order quantities on it would leak exactly what the game
    hides. Under `presenting` the demand curve also stops at the current week
    (`revealedDemand`), so no future demand reaches the projector; the console's own curve
    keeps the whole series. A lane chip shows what travels along *that* link: beer is the
    downstream role's `supply_line`, orders the **upstream** role's `orders_in_flight` (on
    `host_state` that is a role's own incoming-order pipeline, so reading the downstream
    role's would put every count one link too high).
14. **The 3D board computes nothing and emits nothing.** `board3d/sceneModel.ts`'s
    `buildSceneModel(props)` returns a plain object — every pile count, sign string, fixture
    id, model placement, light, accent and prompt — and `WarehouseScene` walks it and emits
    meshes, *adding nothing the model does not carry*. A geometry decision taken inside a
    component instead of inside the model is untestable and is therefore a defect: jsdom has
    no WebGL, so the object is what `Board3D.test.tsx` asserts, exactly as rule 13's config
    object stands in for a Chart.js canvas. The interaction layer is the same rule from the
    other side — pressing E (or tapping the HUD's Open button, which calls the same
    `openStation`) at a station mounts the **existing** 2D components
    (`DecisionForm`, `WaitingForOthers`, `SettlementRecap`, `DecisionPanel`) with the same
    props and the same callbacks, so the only emit the 3D view can produce is `submit_order`
    through `api/games.ts` (rule 7), and there is no new event, endpoint or `GameConfig`
    field behind any of it. **A figure on screen that cannot be traced to a `PlayerView`
    field is a bug**, including a plausible one: a settlement whose
    `holding_cost ≠ closing_inventory × rate` renders the server's figure, never the product
    (spec §9.7). This is rule 1 wearing a different hat. The scene does no arithmetic at
    all: the ledger prints
    `inventory_after_arrival` and the lane/order placards read the server's slot weeks.
    **The 3D board is offered on every pointer** (spec §9.7): `BoardViewToggle` does not
    disable it on a coarse pointer. On `(any-pointer: coarse)` the HUD shows
    `MovePad` (six held buttons: turn ↶ ↷, walk ↑ ↓, strafe ← →) and the touch legend; drag-look
    works by finger because the canvas wrapper is `touch-none`. Pad presses live in a set of
    their own (`padHeld` in `Board3D`), merged with the keyboard's by `mergeHeldKeys` so
    `stepPlayer` stays the only walk; turning is `stepYaw` at 1.7 rad/s and counts as look
    (allowed while paused). Window blur, a hidden tab and a panel opening all release the pad.
    **The seams.** `Board3D` is registered in `GameRoomPlaying`'s `BOARD_VIEWS` only via
    `lazy()` (a static import puts three.js in the entry chunk); `BoardViewToggle` is a sibling
    of `<Board>`, never a prop, and `BoardViewProps` does not grow for 3D. A new `PlayerView`
    field must be mapped in `buildSceneModel` as well as `Board2D`. `roleSets.ts` is the only
    place the scene branches on role, and its labels are imported from `RoleBanner.tsx` /
    `roleCopy.ts`, never retyped. A visibility gate omits the fixture from the `SceneModel`
    (asserted on the fixture list), never `visible={false}`. The 2D panels are mounted once and
    toggled `sr-only`/visible: never render them twice (a duplicate "What you have" landmark).
15. **No screen says "Week cost".** Wherever a week's cost appears (recap, decision panel,
    3D ledger and cost corner) it is two figures: "Holding & backlog"
    (`settlement.carrying_cost` / `week_holding_backlog_cost`) and "Order cost"
    (`week_order_cost`, *"not yet charged"* while it is `null`). The stored sum is
    `WeekRecord.total_week_cost` and is never shown as a single figure.

### Multi-game hosting and the join QR code

`/multihost/new` (`MultiHostSetupPage`) takes a count, a host name and **the full base config**
every game in the batch starts with, and calls `createRoomBatch` (`POST /rooms/batch-create`,
spec §9.10) with `{count, preset, config, host_display_name}`: `preset` is the preset the
draft started from, `config` the validated draft itself. The count's range is the server's
(`Limits.min_batch_rooms`/`max_batch_rooms` via `useLimits()`), refused, never clamped. The
config is the lobby's own form: `config/ConfigSections.tsx` is the stateless
rendering (no store, no room), `config/useConfigForm.ts` the form state (ranges, Zod, `useForm`,
pending demand kind, preset/kind handlers), and each caller supplies a `ConfigSaveApi`.
`ConfigPanel` supplies the store's config and `useConfigSave`; the
setup page supplies `config/useDraftConfig.ts`, whose save posts the current draft **and the
patch** to `POST /rooms/preview`. The server merges the patch (`merge_config_patch`: a changed
demand kind replaces the block and gets its defaults), validates, and returns `config`, which
becomes the draft; the figures prime `useConfigPreview`'s cache (`primePreview`). A 422
`"field: message"` is parsed by `fieldFromPreviewError` and shown beside the field. The draft
starts from the preset marked `is_default` on `/rooms/presets`. Create stays disabled while an
edit is queued or in flight, the server refuses one, a field is out of range, or a picked demand
generator has no settings yet. Never copy the merge rule or a kind's defaults into the client.
Each game's own host screen still offers the form until that game starts. The page stores every
secret with `setHostSecret` and the codes with `setHostBatch` before navigating, and nothing at
all if any room came back without a secret.

`/multihost` (`MultiHostDashboard`) is a grid of `multihost/GameCard`s polled from
`getRoomsSummary` (`POST /rooms/summary`, every 5 s, `useRoomsSummary`). It never joins a
room's socket channel, and on mount it `reset()`s the store if `roomCode` is set, so
`rejoinAfterConnect` cannot re-claim an old room on the next reconnect. **"Open host screen"
is a `<button>` calling `openHostScreen`: `setHostRoom(code)` then `window.open(url, '_blank')`
without `noopener`**, so the browser copies this tab's sessionStorage (`host_room`,
`host_secret_<code>`) into the new tab, which runs the ordinary `/host/:roomCode`. Never turn it
into an `<a target="_blank">`: that implies `noopener`, the new tab starts with no secret, and
a room made over REST has no `host_identity` yet for D18 to recover. **"Start all ready
games"** emits the ordinary `startGame` (`api/games.ts`) for each room whose summary says
`can_start`; the server authorises `start_game` by `host_secret` alone and re-checks
`can_start`, and sends `host_state` to the claimed host tab (or, if none is open, to the
dashboard, which ignores it).

**"Start all" refusals go on their card** (identical in every Novus game). The
server names the room on every `start_game` refusal (`join_error` `{message, room_code}`). The
dashboard registers its codes with the store's `setBatchRooms` (cleared on unmount), and the
`join_error` handler in `socketHandlers.ts` sends a refusal whose `room_code` is in the batch to
`setBatchStartError` instead of `applyJoinError` + a global alert; the card shows
"Game N (CODE): <server message>" (`startErrorText`) until a later summary shows the game
started (`hasStarted`: `RUNNING`/`PAUSED`/`FINISHED`). A refusal with no `room_code`, or for a
room outside the batch, goes through `applyJoinError` and a global alert as usual. After "Start all" one status line reads
"Started X of Y games." (+ "Z couldn't start, see their cards."; `startAllStatus`), X counted once
from the first summary **sent** at or after the refresh ~1 s after the click:
`useRoomsSummary` returns `asOf`, the send time of the answer it holds, so a poll already in
flight does not count. The store writes here are the one exception to "only socket handlers
write the store" that the dashboard needs: it registers which rooms are its own.

`components/shared/JoinQrOverlay.tsx` is the full-screen QR of the invite link
(`inviteUrl(code)` in `lobby/roomCode.ts`, `/join/:roomCode`), drawn locally by `qrcode.react`.
It encodes the player link only, never a secret, and closes on Close, Escape or a backdrop
click. The host lobby's `InvitePanel` opens it with **Show QR** / **Hide QR**; every
dashboard card shows a small inline QR and opens it too. `utils/clipboard.ts`'s
`copyToClipboard` is the one copy helper both use.

### Results export is open to every viewer

`results/ExportControls.tsx` renders CSV and JSON for anyone viewing a persisted game (one with a
`public_id`), host or player, guest or signed in, and downloads from
`GET /games/id/{public_id}/export` with no `X-Host-Secret` — the host too. The export is not
bound to the host because a guest host has no account to fall back on once the room or tab is
gone (D22). There is no export or results route by room code on the server. Each game and format can be downloaded **once per browser
session**: after a success the button is disabled and reads "CSV already downloaded this
session"; a failure marks nothing. That flag is UX only; the server's per-address limit (100
exports an hour, both formats) is the real guard, and its 429 arrives through `errorMessage`.
Don't reintroduce a host check, an expiry warning or "only the host can export" copy, and
`GuestClaimPrompt` must not sell an account as the way to keep exporting.

### Results are shown only by `public_id` (D22)

The one results URL is `/results/:publicId` (`utils/resultsPath.ts`), and `ResultsPage` renders
only what `GET /games/id/{public_id}/results` answers: never the live store's `game_finished`
payload, a room code or anything in browser storage (the host tab's hidden-costs default is the
one presentation detail storage still decides). The end screens (`GameOverPanel`, the finished
`HostConsole`) link there once `game_persisted` has put `gamePublicId` in the store and say
"Saving the results…" until then — never a fallback link by room code. The profile names games
by `public_id` too: history rows and the best game open `/profile/games/:publicId`
(`GET /users/me/games/{public_id}`), and no wire field here is an internal `games.id`.

### Games you hosted (D23)

`profile/HostedGamesList.tsx` is the profile's separate "Games you hosted" section, from
`GET /users/me/hosted-games` (the profile's third request on mount; it pages with
`?hosted_page=N`). Each entry links to `/results/:publicId`. It is a list only: the match
history and the stats stay played-only, and `GuestClaimPrompt` is offered only to a guest whose
browser played a seat in the room (a `session_token`) — a guest host is never recorded, so there
is no host claim and no "records your account as its host" copy.

## 7. Storage scopes — not interchangeable

`utils/storage.ts` is the only module allowed to touch Web Storage.

| Value | Area | Why |
|---|---|---|
| `alias` | localStorage | Public; the id in every broadcast |
| `guest_id` (`guest_<uuid4>`) | localStorage | Stable per browser; makes guest reconnect work |
| `session_token_<room>` | localStorage | Secret; the reconnect credential |
| `host_secret_<room>` | **sessionStorage** | Secret **and tab-scoped** — in localStorage it leaks host authority into a tab opened from an invite link |
| `host_room` | sessionStorage | UI hint only; never trusted by the server |
| `host_batch` | sessionStorage | The multi-game dashboard's room codes (JSON array; `getHostBatch()` is null when absent or malformed). Codes only — each secret is under `host_secret_<room>` |
| `export_downloaded_<public_id>_<format>` | sessionStorage | The results screen's once-per-session download flag (`markExportDownloaded` / `wasExportDownloaded`). **UX only**: the server's per-address export budget (100 an hour, backend `core/abuse.py`) is the real guard |
| `display_name` | localStorage | Display data, sanitised on write (max 24, control chars handled two different ways — read the comment before touching it). Written by `NameForm`'s submit and the host name fields (Home's create form, `/multihost/new`); read to prefill them and by every token-bearing `join` |
| `vite_preload_reloaded` | sessionStorage | Set by `claimPreloadReload()` when `main.tsx` reloads after a `vite:preloadError` (a stale chunk after a deploy), so it reloads once per tab, never in a loop. Same key in every Novus game |
| `board_view` (`'2D'` \| `'3D'`) | localStorage | Display preference, **not a credential**, and deliberately browser-wide rather than tab-scoped: it is the one choice a player should not have to re-make in a second tab, and it grants nothing. Unrecognised → treated as unset, never an error (spec §9.7) |

**D18 host recovery**: closing the tab loses `host_secret`. The host lobby therefore emits
`join_waiting` **with or without** a stored secret, and the server re-authorises against the
verified identity and replies `host_claimed` with a fresh one. Guarding that emit on
`getHostSecret() !== null` silently disables the whole recovery path — the symptom is a
permanently paused game, not an error.

`rejoinAfterConnect` runs on every `connect`: it emits `join_waiting` when the route is
`/host/:roomCode` or the tab holds `host_room` for that room (with the stored secret if any),
otherwise `join` with the stored `session_token` and display name, so a reconnect keeps the
chosen name — **but only when that room's `session_token` is stored**. Without one it emits
nothing: the player has not chosen a name yet (below), and a `join` from here would create the
seat first. A shell may also emit `join` on mount, so a cold load can send two; that is
intended (`join` is idempotent by identity), and no emitter should try to guess whether the
other fired.

**Players name themselves on the game screen, right before their first `join`** (spec §4.2,
`game_stack.md` "Display names"). `GameRoom` reads `getSessionToken(roomCode)` on every
render. With none it shows `lobby/NameForm` ("Your name", prefilled from `getDisplayName()`
only, `maxLength` `MAX_DISPLAY_NAME_LENGTH`) and sends no `join`; the submit stores a
non-empty name with `setDisplayName` and joins with what was stored (an empty submit joins
with no `display_name`, so the server uses the alias, and leaves storage alone). After the
submit the lobby shows; a `join_error` while still tokenless brings the form back with the
reason. With a token it skips the form and joins on mount as before. The server keeps the name
a seat was created with, so there is no rename. The welcome screen and Home's join form ask for
no name — don't add one back; Home's create form ("Name to host as") and `/multihost/new` are
the only other name fields, and they send `host_display_name`.

`store.myAlias` is the alias, the value every broadcast's `player_id` is compared against. The
`session_token` is read only by the `join` emit (`storage.getSessionToken`) and is never
displayed or compared.

## 8. Gotchas

- **Don't add a `tailwind.config.js`** — v4 is CSS-first and the theme is in `index.css`.
- **No native `<select>`.** Dropdowns are `components/shared/Select.tsx` (a WAI-ARIA
  select-only combobox drawn in the theme's tokens; disabled options carry a `detail` reason).
  Name it with `<label htmlFor>` / `aria-labelledby` / `aria-label` — **never wrap it in a
  `<label>`**, or an option click bubbles to the label and reopens the list. Tests drive it by
  clicking the `combobox`, then the `option` (`Select.test.tsx`).
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
- **Test the empty case of a glob against an explicit record.** `import.meta.glob` is
  expanded at transform time, so the live `discoverRoutes()` and the `shellScreens.ts`
  resolvers can never be empty once the files exist. Test the empty or missing case through
  `collectRoutes(record)` / `resolveShellScreen(record, path, name)` with an explicit module
  record, never against the live glob (that assertion holds until the file lands, then fails
  for good).
- **Every numeric input blurs on wheel** (`onWheel={(e) => e.currentTarget.blur()}`): Chrome
  and Edge step a focused number input under the wheel, so scrolling the page would silently
  change a config value or an order. React's wheel listeners are passive, so
  `preventDefault()` cannot do it; keep the blur on any new number input.
- **No two modules in one directory may differ only in case** (e.g. `DemandCurve.tsx` beside
  `demandCurve.ts`): on case-insensitive macOS/Windows filesystems the extensionless import
  resolves to the wrong file (TS1261 and a missing default export). That is why chart
  builders are named `*Config.ts`.

### The 3D board

- **CSS custom properties do not resolve inside WebGL**, so `board3d/scenePalette.ts` holds
  hexes copied from the `index.css` tokens. Accent hexes go only on architecture, quantity
  hexes only on crates; stock crates are deliberately neutral grey because
  `--color-inventory` equals the Retailer accent.
- **`PlayerController` ignores keys while an INPUT/TEXTAREA/SELECT is focused**
  (`isTypingTarget`), or typing an order walks the player. Never call `setState`
  unconditionally from `useFrame` (report the nearest station only on change). No
  `PointerLockControls`: it steals the cursor from the DOM panels and the toggle.
- **The models need no Draco/Meshopt/KTX2 decoder**, and every model goes through the
  `Box3` normalise-and-ground step (authors' units and pivots differ). The truck's materials
  are baked to vertex colours to keep two draw calls per truck.
- **Budgets are constants asserted by `Board3D.test.tsx`:** `MAX_LIGHTS=1` (hemisphere only;
  a point light is unrepresentable), `MAX_DRAW_CALLS=90` via `estimateDrawCalls`,
  `MAX_INSTANCE_POOLS=8`, `MAX_SIGNS=40`. Over budget, merge geometry first, then fold signs;
  never drop a truck (it identifies the Wholesaler).
- **A lost WebGL context is an event, not a throw**, so `ErrorBoundary` never sees it:
  `contextLoss.ts` listens in the capture phase and routes to the same 2D fallback.
- **jsdom has no WebGL:** tests never import `Board3D.tsx` or `WarehouseScene.tsx`.
