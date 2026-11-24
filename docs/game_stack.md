# Game Stack — Base Template

> **This file at `Novus/game_stack.md` is the single source of truth.** The copies inside
> `Beery/`, `Lemony/`, `Selly/` and `Beery/Beery_Frontend/docs/` are generated from
> it. Edit this one, then re-copy. Do not edit a per-game copy in place — it will be
> overwritten.
>
> Pulky has no copy: its spec (`Pulky/docs/spec/`) carries these rules in place, so a change
> here reaches Pulky only when it is written into that spec by hand.
>
> Derived from **Tequila Game** (`Selly/Selly_Frontend` + `Selly/Selly_Backend`) after its
> security and performance audit. Sections marked **[HARD-WON]** encode a bug that actually
> shipped, or nearly shipped, in Tequila Game. Treat those as non-negotiable — they are the
> reason this file exists rather than "just copy the repo".

Reusable base stack for host + room multiplayer simulation games. Game-specific logic (rules,
scoring, round structure) is intentionally excluded — this only covers the plumbing every game
in this family needs: identity, room lifecycle, real-time sync, persistence, and deploy shape.

Two independent projects/repos per game:

```
<GameName>/
├── <GameName>_Frontend/   React + Vite + TS
└── <GameName>_Backend/    FastAPI + Socket.IO
```

---

## 0. Security invariants — read before writing any handler

These are the rules the audit was written to enforce. Everything else in this document is
mechanism; this is the contract.

1. **The client never asserts who it is.** Identity comes from a Firebase ID token verified
   server-side, or from a guest id that can only ever be a guest id. A request that carries a
   user identifier in its body/payload is a bug, not a feature.
2. **Never broadcast a credential or a real user id.** Room broadcasts carry a per-room public
   alias only. A Firebase UID in a `week_results` payload is a data leak to every co-player.
3. **Authority is a capability, not a claim.** "I am the host" must be proved with a secret the
   server minted, compared with `hmac.compare_digest` — never inferred from "you were the last
   socket to say you were the host".
4. **The server owns all money/score state.** Any running total the client computes is an
   input to the UI, never an input to the game engine or the database.
5. **Every mutating handler is idempotent or explicitly deduplicated.** Sockets reconnect,
   React re-mounts, users double-click.
6. **Fail closed, and fail loudly.** A missing auth config must not silently become
   "everyone is trusted"; it must refuse and log at CRITICAL.
7. **The client renders derived state; it never derives it.** Capacity, start eligibility,
   whether the config is still editable, whose turn it is — each has exactly one definition,
   it is server-side, and it travels in the broadcast as a value. This is not invariant 4
   restated: 4 is about refusing what the client sends, and 7 is about refusing to make the
   client compute what the server already knows. The failure is quieter — two
   implementations of one rule that agree on the day they are written and drift afterwards —
   and it is a rule this family has broken three times in one game's planning documents
   alone.

**What invariant 7 does not forbid: display arithmetic in charts.** A chart may sum, average,
take a running total of, or divide figures the server sent, purely to draw them: a cumulative
profit line, a cost per unit, a market average, a share. The value never leaves the screen,
never feeds a decision or the engine, and the chart's table view shows the server figures it
came from. Anything with a game rule in it is still the server's: eligibility, capacity, a cost
formula, a forecast for a live decision. That is why a "what if I charge $X today?" curve is a
server preview, never the client re-running the demand model. Help and config screens that
explain the model with example numbers get those numbers from the server too: Lemony's and
Pulky's help show the figures of a `POST /config/preview` answer for the draft config. A game
may be stricter than this: Beery plots only server fields, and shows a combination with
geometry (stacking, drawing below the axis) instead of a computed number. The rest of the chart rules are in §1 *Charts*.

8. **Every unauthenticated path is bounded.** **[HARD-WON]** Anyone can open a guest socket or
   create a room, and the backend is one small instance holding live state in memory, so one
   script could OOM it and kill every running game. The limits are plain constants in one
   module, `app/core/abuse.py`, enforced at three choke points only, never per handler:
   - **REST:** one pure-ASGI middleware, added *before* CORS so a 429 keeps its CORS headers.
     It applies a per-IP request limit, stricter limits on public costly routes (room create,
     room status, config previews), and a 64 KB body cap that also counts chunked bodies.
   - **Socket handshake:** an open-socket cap per IP. The slot is released in `try/finally` on
     every disconnect and on every refused connect, or an IP drifts into a permanent lockout.
   - **Socket events:** a per-sid (and per-IP) event limit inside the existing `@guarded`
     wrapper. `max_http_buffer_size` is 64 KB, not the 5 MB default some copies carried.
   - **Client IP:** use `cf-connecting-ip`, then the RIGHTMOST `X-Forwarded-For` entry, then
     the peer. Render fronts services with Cloudflare, and `FORWARDED_ALLOW_IPS=*` makes
     `request.client` forgeable.
   - **Limiter memory:** the limiter's key table is bounded. When full it trims to 90%, not
     to exactly the cap, so it never rescans every key on each new one.
   - **Live state:** a room code or game id is validated in the state service before any
     lock or read. Process locks live in a `weakref.WeakValueDictionary` with no manual
     pops: the old pops used the wrong key, so no lock was ever freed. In-memory stores
     purge expired rooms on create and cap live rooms (503 past the cap). Rooms that never
     started get a short TTL (2 h); started rooms keep 24 h.
   - **Event loop:** Firebase verification runs in a thread (`asyncio.to_thread`), and a
     token over 4096 characters is rejected first. A route that does sync DB or CPU work is
     a plain `def`, never `async def`. `/health/deep` reuses its answer for 15 s.

   Size per-IP limits for a whole school behind one NAT (several classes, one public IP),
   never for one user; the per-sid limits are the real guard against one bad client. Floors
   every game meets: 400 open sockets, 3,000 REST requests and 15,000 socket events per IP per
   minute (where the game has those limiters), and 600 a minute per IP for lookups and config
   previews. Room creation and export budgets stay per game. A client action that a 429 would
   block (a config preview gating Start) retries after `Retry-After` instead of staying stuck.

---

## 1. Frontend

**Core**: React 19, Vite, TypeScript (strict, bundler-mode), Tailwind CSS v4 (CSS-first,
no `tailwind.config.js`), React Router 7, Zustand 5 (single store, updated only by socket
handlers), Firebase Web SDK (Auth + Analytics), `socket.io-client`, Axios, React Hook Form +
Zod, Vitest + Testing Library.

Versions are given at the major level on purpose — unlike the backend, the frontend has no
lockstep-with-an-image constraint, so take whatever `npm create vite@latest` gives you and keep
it current with `npm update`. Tequila Game is verified green on React 19.2 / Vite 7.3 /
TypeScript 5.9 / Tailwind 4.3; a fresh scaffold today lands on Vite 8 / TypeScript 6, which has
not been exercised against this stack.

Node ≥ 20.19 (or 22.12+) is Vite 7's realistic floor, and higher for Vite 8 — but Node 20
reached end of life on 30 April 2026 and gets no security fixes, so neither `engines.node` nor
`.nvmrc` should name it. Set `engines.node` to the patched release of each supported line
(`^22.23.4 || ^24.22.1 || >=26.12.1` as of the 21 October 2026 security release) and pin
`.nvmrc` to one of them. CI's `setup-node` reads `.nvmrc`, so a stale pin keeps every build on
a vulnerable Node; raise both after each Node security release.

> **A 3D dependency will pin your React version.** If a game adds `@react-three/fiber`, note
> that it declares a narrow React peer range (`>=19 <19.3` as of r3f 9.7) and lags React
> releases by months. `"react": "^19.2.0"` lets npm pull a React that r3f refuses, and the
> install fails with `ERESOLVE` — on a transitive bump, so the error names a package you did
> not touch. Express the real constraint with a tilde (`"react": "~19.2.0"`) rather than
> reaching for `--legacy-peer-deps`. **[HARD-WON]**

> **A walkable 3D view must be playable on touch.** (Ported from the Samby
> warehouse, `samby-frontend/src/features/analysis/warehouse/`.) A first-person view does not
> refuse a coarse pointer or a narrow window; it ships these instead:
> 1. **Drag to look** with pointer events on the canvas (or its wrapper), with pointer capture
>    and `touch-action: none`. Never `mousemove` on `window`: a touch drag sends none, and a
>    window listener turns the camera when a drag starts on a HUD control.
> 2. **A six-button move pad** on `(any-pointer: coarse)`: turn left, forward, turn right /
>    strafe left, back, strafe right. Buttons are *held*: `pointerdown` presses (with
>    `setPointerCapture`); `pointerup`, `pointercancel`, `lostpointercapture` and `blur`
>    release; Space/Enter drive them from a keyboard. Targets ≥ 44 px, inside the safe area
>    (rule below). The pad is hidden while a panel is open.
> 3. **Pad presses in their own set**, merged with the keyboard's in the pure motion step, and
>    cleared on window blur, a hidden tab and every panel open, so no key can stay stuck down.
>    Turning is looking: it may stay live while paused or after the game ends.
> 4. **A tappable Open button** on a coarse pointer wherever the desktop says "Press E", doing
>    exactly what `E` does: proximity plus a keypress is not reachable without a keyboard. A
>    fine pointer keeps the "Press E" prompt and gets no button.
>
> An orbit-camera view (Lemony's street) needs none of this: drei's `OrbitControls` already
> orbits with one finger and zooms with a pinch, so it only words its hint for touch.

> **WebGL does not see the page's CSS or its error boundary.**
> 1. CSS custom properties do not resolve inside a WebGL scene: the scene keeps its own palette
>    of hex literals copied from the CSS tokens, with a drift test like the charts' theme.
> 2. A lost WebGL context is an event, not a throw, so a React error boundary never sees it.
>    Listen for `webglcontextlost` in the capture phase, route to the same 2D fallback, and
>    store that choice so the next load does not retry.
> 3. Ignore movement keys while a form field has focus, or typing an order walks the player.
>    Never `setState` unconditionally inside `useFrame`, and avoid `PointerLockControls` when
>    DOM panels must stay clickable. **[HARD-WON]**

> **Every frontend draws edge to edge and keeps its controls inside the safe area.**
> `index.html` sets
> `<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />`.
> Without `viewport-fit=cover`, iOS letterboxes the page and every `env(safe-area-inset-*)`
> reads 0, so a padding written against the notch or the home indicator silently does
> nothing. With it, the page runs under the notch, so all three of these hold:
> 1. **`body` pads its sides** by `env(safe-area-inset-left)` / `env(safe-area-inset-right)`
>    in the global CSS, so flow content clears a landscape notch. Size flow content with
>    `100%`, not `100vw` / `w-screen`, which ignore that padding and overflow.
> 2. **Every `fixed` element anchored to a viewport edge** — and every `absolute` element
>    anchored to an edge of a full-viewport overlay, such as a 3D HUD — offsets from that edge
>    by `max(<gutter>, env(safe-area-inset-<edge>))`: `left-4` becomes
>    `left-[max(1rem,env(safe-area-inset-left))]`, `bottom-6` becomes
>    `bottom-[max(1.5rem,env(safe-area-inset-bottom))]`. Full-bleed layers (`fixed inset-0`
>    backdrops, the canvas) stay full-bleed; what sits inside them pads instead.
> 3. **A control stacked above another** adds its offset to the same expression,
>    `bottom-[calc(max(1rem,env(safe-area-inset-bottom))+3.5rem)]`, so the stack keeps one
>    baseline.
>
> On a desktop and on a phone without a notch every inset is 0 and the `max()` is the old
> gutter, so the layout there does not move. **[HARD-WON]**

### Bootstrap commands

```bash
npm create vite@latest <game>_frontend -- --template react-ts
cd <game>_frontend

npm install firebase socket.io-client axios zustand react-router-dom \
  react-hook-form @hookform/resolvers zod uuid

npm install -D tailwindcss @tailwindcss/vite \
  vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event \
  @types/node

npm install -g firebase-tools   # once per machine
firebase login                  # once per machine
firebase init hosting           # inside the project: SPA rewrite, public dir = dist
```

`vite.config.ts`:
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
      '/socket.io': { target: 'http://localhost:8080', ws: true },
    },
  },
})
```

`src/index.css`:
```css
@import "tailwindcss";
```

### Folder structure

```
src/
├── api/            http.ts (axios instance + errorMessage helper), socket.ts
│                   (socket.io-client instance), socketHandlers.ts (all socket.on()
│                   listeners), rooms.ts (REST calls)
├── auth/           AuthContext.tsx — Firebase Google auth + guest mode + socket (re)connect
├── store/          gameStore.ts — zustand, written only from socket handlers
├── pages/          WelcomeScreen, HomePage (create/join room), WaitingRoom (host lobby),
│                   GameRoom (active play), GameOverPage, ProfilePage
├── components/     game/, shared/ (LoadingSpinner, Tooltip, AlertContainer, BackendWakeUp)
├── types/          shared TS types for game domain + socket payloads
├── utils/          storage.ts — localStorage/sessionStorage: alias, session_token,
│                   host_secret, guest id
└── __tests__/
```

### The three identifiers **[HARD-WON]**

Tequila Game originally used **one** string for all three jobs below, and that string was the
user's raw Firebase UID, supplied by the client. That single decision produced three separate
critical findings (impersonation, account-state forgery, UID broadcast). Keep them distinct:

| Name | Visibility | Source | Purpose |
|---|---|---|---|
| `alias` (`P1..Pn`) | **public**, broadcast | server | the value sent as `player_id` in every broadcast |
| `session_token` | **secret**, owner only | server, `uuid4().hex` | reconnect credential |
| `identity` | **server-only**, never on the wire | verified Firebase uid, or `guest_<uuid4>` | DB attribution |

On the frontend this collapses pleasantly: **`store.myToken` is the alias.** Because the alias
is exactly what the server puts in `player_id` on every broadcast, all the
`lastResults[myToken]` / `player.player_id === myToken` comparisons keep working. The
`session_token` is stored separately and used *only* in the `join` emit — never displayed,
never compared.

### Host + room pattern (frontend side)

- **Host authority is a capability.** `POST /rooms/create` returns a one-time `host_secret`.
  Store it per-room in `sessionStorage` and send it with `join_waiting`, `config_update` and
  `start_game`. A `sessionStorage` "am I the host" boolean is a **UI hint only** — anyone can
  set it in devtools, so the server must never trust it.
- **The last host claim wins.** A second host tab takes over as the room's one host connection.
  The old tab is not told: it stops getting host-only events, still gets room broadcasts (so its
  screen is part current, part stale), and the server still accepts its host actions, because it
  holds the host secret. When the new tab closes, host-only events reach no one until a host tab
  reconnects or reloads; an old tab that reconnects takes the role back. The same in Tequila,
  Beer and Pulque; decided November 2026.
- **Create/host flow**: `POST /rooms/create` → persist `host_secret` for that room id →
  navigate to the waiting room.
- **Join flow**: navigate to `/game/:roomId`, guarded by an auth/backend-ready guard.
- **Socket handlers registered once**, as a side effect in `main.tsx` *before* React renders,
  to avoid StrictMode double-mount bugs.
- **Zustand store is the single source of truth**, written only by socket event handlers.
- **The host is not in the participant list.** They render the room; they do not appear in
  it, hold no alias and take no seat. A host counted as a player is an off-by-one that
  survives every test with four players in it.
- **No native `<select>`.** The browser draws a native select's popup in the operating
  system's chrome, the one part of every screen a game's theme cannot reach. Each game has
  its own `components/shared/Select.tsx`, a WAI-ARIA select-only combobox (a
  `button role="combobox"` that keeps focus, a `listbox` driven by
  `aria-activedescendant`, Up/Down/Home/End/Enter/Space/Escape/Tab, typeahead,
  outside-click close) styled in that game's own tokens. Name it with `<label htmlFor>`,
  `aria-labelledby` or `aria-label` and **never nest it in a `<label>`**: a click on an
  option bubbles to the label, which re-clicks the trigger and reopens the list. Beery's is
  the reference (`Beery/Beery_Frontend/src/components/shared/Select.tsx`).
- **A host's seat picker never offers a seat someone else holds.** List it, disabled, with
  the holder's name ("Taken by Ana"), and have the server **refuse** an assignment to a held
  seat rather than move it. Moving it silently unseats the holder, which the host reads as
  two people sharing a seat until one of them vanishes from it. Reassigning is two
  deliberate steps: unseat, then assign. (Found in Beery.)

### Socket handshake — `autoConnect: false` **[HARD-WON]**

The socket must carry a verified Firebase ID token, and the module is imported for its side
effect *before* Firebase has restored a persisted session. If the socket auto-connects, the
very first handshake is always anonymous and a returning signed-in user gets a throwaway guest
identity.

```ts
export const socket = io(SOCKET_URL, {
  transports: ['websocket', 'polling'],
  autoConnect: false,            // AuthContext connects once auth resolves
  reconnection: true,
  path: '/socket.io',
  // `auth` as a CALLBACK so it re-runs on every reconnect and picks up a
  // refreshed ID token, instead of freezing the first one.
  auth: (cb) => {
    const user = auth.currentUser
    if (user) user.getIdToken().then((idToken) => cb({ idToken, guestId: null }))
                               // never fall back to the guest id while signed in
                               .catch(() => cb({ idToken: null, guestId: null }))
    else cb({ idToken: null, guestId: getGuestId() })
  },
})
```

**Never play as a guest while signed in.** If a signed-in user's `getIdToken()` fails (a school
firewall blocking `securetoken.googleapis.com`, a flaky network), falling back to the stored
guest id would seat them under another identity and lose their game. The client sends no
identity instead, the server refuses the handshake, and the client shows its "could not reach
the game server" notice and calls `socket.connect()` again every 5 s while still signed in (a
server refusal is not retried by socket.io on its own). A visitor with neither a sign-in nor a
guest id does not connect at all.

`AuthContext` then calls `socket.disconnect().connect()` on every `onAuthStateChanged`
resolution (first resolution = initial connect; later ones = identity changed), and explicitly
in `continueAsGuest()`, since choosing guest mode fires no Firebase auth event.

Do **not** set `rejectUnauthorized: false`. It is a Node-only option that disables TLS
certificate validation and does nothing useful in a browser.

### Reconnection

On `connect`, re-emit `join_waiting` (host, with `host_secret`) or `join` (player, with the
stored `session_token`). Socket.IO issues a new `sid` on every reconnect, so identity must be
re-asserted; the server replies with a full state resync event.

**Never give up.** **[HARD-WON]** Leave `reconnectionAttempts` at socket.io's default
(Infinity) and set `reconnectionDelayMax: 10000`. A cap of 10 gave up after about 40 s, so a
closed lid, a Wi-Fi drop or a mid-class deploy left a student disconnected for good behind a
screen that still looked live. While the socket is down after having connected once, the play
and host screens show a small non-blocking "Reconnecting…" notice, and the decision's Submit
button is disabled: socket.io buffers an emit made while offline and sends it on reconnect
*before* the `connect` handler re-joins, so the server refuses it and the decision is lost.
Gate Submit on a store `connected` flag that is true only between `connect` and `disconnect`,
not on a "reconnecting" flag: the app's own `disconnect().connect()` never sets the latter.
The notice text is the same in every game: "Connection lost. Reconnecting…", and it ignores the
app's own disconnects (reason `io client disconnect`, e.g. the room-switch reconnect below).

**A tab that changes room reconnects its socket.** **[HARD-WON]** The store resets for the new
room and its `seq` filter starts over, but a socket still in the old room's channel keeps
hearing that room's events: one high-`seq` event from the old room makes the store drop every
event of the new one, and the player sits in an empty lobby. So when the room code changes the
client calls `socket.disconnect().connect()` in step with the store reset, and the server's
room-leave path takes the sid out of the Socket.IO room (and clears its sid maps, and any sid
the old room document keeps for direct sends) *before* broadcasting anything about the leave.
A **Leave** button resets and reconnects only after the server acknowledges the `leave` (its
`leave_ack`, or an emit ack with a timeout): reconnecting right behind the `leave` lets the
server's `disconnect` handler win the room lock first, and the seat stays taken.

**Reload once after a deploy.** A tab left open across a deploy asks for lazy chunks that no
longer exist. `main.tsx` listens for `vite:preloadError` and reloads the page, at most once per
session (`sessionStorage['vite_preload_reloaded']`, through the storage module where a repo
keeps Web Storage in one file).

### Rendering API errors **[HARD-WON]**

FastAPI returns `detail` as a **string** for `HTTPException` but as an **array of objects** for
422 validation errors. Putting that array into React state and rendering it throws
`Objects are not valid as a React child (found: object with keys {type, loc, msg, input, ctx, url})`
— turning a readable validation message into a white screen. Always funnel API errors through a
helper that guarantees a string:

```ts
export function errorMessage(err: unknown, fallback: string): string {
  const detail = (err as any)?.response?.data?.detail
  if (typeof detail === 'string' && detail.trim()) return detail
  if (Array.isArray(detail)) {
    const msgs = detail.map((d) => (typeof d?.msg === 'string' ? d.msg : null)).filter(Boolean)
    if (msgs.length) return msgs.join('; ')
  }
  return fallback
}
```

Also surface `connect_error` to the user. A refused handshake (bad/expired token, or Firebase
unconfigured server-side) otherwise presents as a page that silently never connects. Dedupe the
alert across the automatic retry attempts.

### Third-party avatars

Google profile images (`lh3.googleusercontent.com`) answer **429** to requests carrying a
`Referer` they dislike, which happens routinely on localhost. Render them with
`referrerPolicy="no-referrer"` and an `onError` fallback to the user's initial.

### Firebase Auth wiring — `initializeAuth`, never `getAuth` **[HARD-WON]**

`firebase.ts` holds the web config (public identifiers — safe to ship in the bundle):
```ts
export const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence],
})
export const googleProvider = new GoogleAuthProvider()
```

`getAuth(app)` is shorthand for `initializeAuth` with
`popupRedirectResolver: browserPopupRedirectResolver` already set, and Auth then **awaits** that
resolver while starting up: `initializeCurrentUser` runs `tryRedirectSignIn`, which loads a
cross-origin gapi iframe from `authDomain` (`<project>.firebaseapp.com/__/auth/iframe.js`,
~288 KB, plus `apis.google.com/js/api.js`) purely to check for a pending redirect result. The
app is served from `<site>.web.app`, so it is always cross-origin and always pays this.

That await sits directly in front of the auth-state resolution, so it delays
`onAuthStateChanged` — and with it the first paint of every screen gated on `loading` AND the
socket handshake, which by design does not connect until auth resolves. Measured at 10–15 s on
a real deploy, with nothing in the network tab that looks like the app's own traffic.

Pass the resolver at the one call site that needs it, so the iframe loads on click instead:
```ts
await signInWithPopup(auth, googleProvider, browserPopupRedirectResolver)
```
A call site that forgets it throws `auth/operation-not-supported-in-this-environment` — loud,
not silent.

**Keep analytics off the critical path.** `getAnalytics(app)` at module load, in the same module
that exports `auth`, puts Firebase Installations and `googletagmanager.com` in front of sign-in;
content blockers routinely stall those rather than failing them fast. Import it dynamically
after `load` and guard it with `isSupported()` — unguarded it throws in jsdom and in private
mode, and an unhandled throw in that module takes `auth` down with it, leaving the app spinning
forever.

**Do not gitignore `firebase.ts` while importing it from `src/`** — see §5, it breaks CI.
Prefer `VITE_FIREBASE_*` env vars so the file is reproducible from config.

`http.ts` attaches the Firebase ID token to every REST request when signed in:
```ts
http.interceptors.request.use(async (config) => {
  const user = auth.currentUser
  if (user) config.headers.Authorization = `Bearer ${await user.getIdToken()}`
  return config
})
```

### Identity already chosen — skip the welcome screen **[HARD-WON]**

The welcome screen must read `mode`, not only `loading`. A screen that knows whether auth has
*resolved* but not *what it resolved to* shows the sign-in page to a visitor whose session was
restored a moment ago, and asks them to sign in again on every single visit.

```tsx
if (mode === 'authenticated') return <Navigate to={destination} replace />
```

- Redirect to `destination` (`state.from` ?? `/home`), never a hardcoded `/home`, or an invite
  link is lost on reload — the guard parked the attempted location there for exactly this.
- `replace`, or Back out of `/home` lands on `/` and is bounced forward again, trapping the user.
- Place it **after** the `loading` guard. Redirecting on an unresolved `mode` sends a signed-in
  user to the sign-in page for a moment on every load.
- A screen that deliberately renders before auth resolves (to spare first-time visitors a
  spinner) will show a brief flash before the redirect. That is the right trade: do not block
  the public front door to fix a returning-visitor problem.
- Guests are a judgement call. A guest id is only a localStorage key, a weaker signal than a
  Firebase session, and the welcome screen is usually the one route to a real account — so
  leaving guests on it is defensible.

### Only signed-in users sign out

Show **Sign out** only to a signed-in user. A guest has no sign-out and leaves guest mode only
by signing in: the header offers a guest **Sign in** instead (a link to the welcome screen if it
keeps guests on it, else a direct Google sign-in). Pulky and Lemony also make the sign-out
function do nothing when no Firebase user is signed in, so a stray call cannot wipe a guest.
Why: the guest identity (the stored guest id) is what lets a guest claim the games they
played once they sign in; a guest who wiped it would lose them for good. (Hosting leaves no
guest record to claim: see "Host records" below.) The cost: a guest's keys stay on that
browser until they sign in and later sign out. (Decided 2026-11-20.)

### Host records: signed-in hosts only, for finding hosted games

A finished game stores its host in `games.host_user_id` (nullable FK to `users`, `ON DELETE
SET NULL`, explicitly named index `ix_games_host_user_id`) and nowhere else:

- **Signed-in hosts only, from a verified token.** The id is captured at `start_game`, after
  the `host_secret` check, from the starting connection's uid **only if the handshake verified
  a Firebase ID token**: never inferred from the absence of a `guest_` prefix. First start
  wins. It rides in a server-only room-document field that no broadcast or payload may carry.
  At persist the uid is looked up in `users`; no row means `NULL`, and a host's `users` row is
  never created there. A guest host is never recorded, under any column.
- **One use: "Games you hosted".** `GET /users/me/hosted-games` (signed in only) lists the
  caller's hosted games, newest first, as metadata plus a link to the game's open results page
  (`/results/:publicId`, see "Results by public id"). The profile shows it as its own section; match history and stats stay
  played-only (§4).
- **Nothing else reads it.** No export, results, claim or authority depends on the host
  record: hosts may be guests, so nothing is gated on a host account. The live room's host
  recovery by `host_identity` (Beery's D18) is untouched: it is live-room only, works for
  guests, and never reads the stored record.

Why: a teacher who hosts signed in can find last month's classes without having kept the link,
while a guest host, who has no account, loses nothing they had. Lemony is single-player and
has no host. (Decided 2026-11-20; replaces each game's earlier host bookkeeping.)

### Results by public id: one link, never expires

A finished game is shown in exactly one way, in every game:

- **Id.** `games.public_id` = `uuid4().hex` (32 characters, unique), set once when the game is
  stored and never changed. Internal ids and room codes never appear in a results URL: a room
  code is reissued and its room expires, so a room-code link would later name another game.
- **Backend.** `GET /api/v1/games/id/{public_id}/results` (and `/export` where the game has
  one): no sign-in, no secret, no time limit, `404` for an unknown id, and only what the
  results screen shows (players by their chosen display names, never a uid, email, user id,
  guest identity or token; the export names them only `P1`..`Pn`, see "Display names"). Only a per-address rate limit gates it (the game's general or heavy REST budget).
- **Frontend.** `/results/:publicId` on a public route is the only URL for a finished game: the
  end-of-game screen goes there once the game's `public_id` arrives, and the profile history,
  the "Games you hosted" list and any share link point there. The signed-in profile detail
  (`/profile/games/:publicId`) also keys on the public id.
- **Stored even when the database blinks.** The end-of-game write runs off the event loop and
  outside the room lock. If it fails it is retried in the background after 2, 10 and 30 s, one
  write in flight per game, and a host or player who (re)joins or asks for state in a finished,
  unstored room starts it again. The write is idempotent (keyed per game), so a retry never
  stores a game twice; the `public_id` reaches the clients when it finally succeeds.
- **Never expires.** The app never deletes a stored game, and nothing on the way to its results
  reads the live room, a room code, browser storage or a session, so a link copied today still
  opens years later.

Why: a teacher shares or bookmarks one link per game and it keeps working; anyone who has it
can already download the data, so the page grants nothing new. (Decided 2026-11-20.)

### Display names: chosen in the lobby, `P<N>` in every export

- **Where.** A player chooses their name on the game screen right before their first `join` of
  a room (a "Your name" form, prefilled from the last name this browser used). A rejoin with
  the room's stored `session_token` skips the form. The host types a name in the create-room
  form; it lives only in the room document and is never saved with the game.
- **Rules.** The server owns one sanitiser (control characters out, whitespace runs to one
  space, trimmed, clamped to 24 characters, re-trimmed; empty means the seat's fallback) and
  the frontend mirrors it. The name is fixed once the seat exists; a later `join` never
  renames. Duplicates are allowed, so nothing may identify a player by name: anything that
  points at another player (a buyer, a trade partner) is stored by seat alias and resolved to
  a name only for display.
- **Where it shows.** Lobby, game, results screen and profile show chosen names. Every CSV and
  JSON export names players only `P1`..`Pn`, so a file never carries a chosen name.

Why: players recognise each other in class, while exported data stays anonymous and nobody
has to keep a name-to-seat key. (Decided 2026-11-21.)

### Backend wake-up probe **[HARD-WON]**

A free-tier host sleeps and cold-starts in 30–60 s. Poll `GET /api/v1/health` and show a
wake-up screen over the routes that need the backend; keep that endpoint dependency-free
server-side, so a slow database cannot make the whole app look dead.

**`res.ok` is not enough.** With the SPA rewrite (`**` → `/index.html`) the Hosting origin
answers `/api/v1/health` with **200 `text/html`**. A probe that trusts the status code reports a
backend it never reached as awake, lets the app through, and leaves the real failure to surface
later as an unexplained socket error — which is a much harder bug to find than the
misconfiguration that caused it. Assert the payload:

```ts
if (!res.ok) return false
const body: unknown = await res.json()   // SyntaxError on HTML → caught below → false
return typeof body === 'object' && body !== null &&
       (body as { status?: unknown }).status === 'ok'
```

### Number inputs blur on wheel **[HARD-WON]**

Chrome and Edge step a focused `<input type="number">` under the mouse wheel, so scrolling the
page silently changes a config value or an order. React's wheel listeners are passive, so
`preventDefault()` cannot stop it: put `onWheel={(e) => e.currentTarget.blur()}` on every
number input. Keep the raw text in state and never clamp or refill while typing: an empty or
out-of-range value stays in the field, shows its own message and disables the button.

### Charts

The family's chart standard. It goes as far as removing real duplication and closing
accessibility gaps; per-game identity (palette, font, chart heights, screen layouts) stays
per game.

**Library and kit.** Every game draws charts with Chart.js 4 + react-chartjs-2 5
(`npm install chart.js react-chartjs-2`); moving to another library was ruled out. There is
no shared npm package, because the repos deploy on their own schedules: each repo carries
its own copy of a small kit under `src/components/charts/`, and Pulky's copy is the
reference.
- `chartSetup.ts`: registration and the global defaults (below).
- `chartTheme.ts`: the canvas colour literals in one place (mirrored from the CSS tokens),
  the font, the entity style function, a cached `hatchPattern(color)` and the emphasis
  colours. Pulky keeps these in `chartSetup.ts`; Lemony keeps its validated palettes there.
- `ChartBox.tsx`, `Legend.tsx` and, where used, `DataTable.tsx`. Pulky keeps them in
  `components/shared/` with its other shared UI.
- `plugins/` only for the plugins a game uses: `eventBands` (Tequila Game, Pulky),
  `crosshairSync` with a crosshair group (Beery, Lemony, Pulky), `referenceRule` (Lemony).
  Pulky defines its plugins inside `chartSetup.ts`.

**Registration and defaults.** `registerCharts()` in `chartSetup.ts` runs once at module
load; a chart pulls it in with a side-effect import. It registers piecemeal (a new chart
type must be registered there), never registers the Title plugin (titles are HTML headings
in the `ChartBox`) and turns the canvas legend off (legends are DOM). Global defaults:
tooltip style, a hairline grid from a token, linear scales starting at zero, the game's
body font, `interaction: { mode: 'index', intersect: false }` on line charts, and animation
off under `prefers-reduced-motion: reduce`. Change an object default with
`Chart.defaults.set(…)`, never `Chart.defaults.x = {…}`: assigning drops the keys Chart.js reads
and crashes on the first data update. `hitRadius: 12` is set once there, never per chart.

**`ChartBox`.** Every chart sits in one. Props: `title`, `caption?`, `ariaLabel`, `height`,
`controls?`, `legend?`, `table`, `children`. The title is an HTML heading; the canvas
wrapper has `role="img"` and the aria label; a visible "Show table" toggle swaps the chart
for a table of the same figures; the canvas sits in an error boundary whose fallback says
"The chart could not be drawn here. The same figures are in the table." Per game: Lemony
defaults `ariaLabel` to the title and `height` to 240 and takes `{ head, rows }` through
`tableFromRows`; Beery adds `headingLevel` and keeps its table in the DOM for screen
readers, so its toggle reads "Show table" / "Hide table".

**`Legend`.** Legends are DOM, never canvas. Items are
`{ key, label, swatch: { kind: 'line' | 'fill', color, dash?, pointStyle?, hatched? } }`
(Beery's swatch carries `dash` and `width`). The swatch repeats the mark's non-colour
channel (dash, marker, hatch), so a legend never relies on colour alone. Given
`hidden: ReadonlySet<string>` and `onToggle(key)`, each item is a `role="switch"` button
with `aria-checked`, keyed by `key`, never by position. Given `onFocusItem(key | null)`,
hovering or focusing an item emphasises that series.

**Entity identity and emphasis.** One style function per game, keyed by a stable id,
returns colour, point style, dash and hatch: `playerStyle(alias)` in Tequila Game (P1–P6
distinct colours, a dash and a hatch from P7 up), `roleStyle(role)` in Beery,
`PERSON_SERIES` by customer type in Lemony, `pulqueriaStyle(alias)` in Pulky. Never style
by rank: an entity keeps its style on every chart, and filtering never repaints the
survivors. Emphasis: the focused entity keeps its style and every other one turns the
context grey; with about six lines or fewer, label the line ends.

**Numbers.** Both axes carry a title with units. Tooltips use the game's own money and
quantity formatters. A missing value is `null` (a gap in the line), never `0`. One y-axis
per chart. What a chart may compute is the display-arithmetic note under invariant 7 (§0).

**Builders and tests.** Each chart has one pure builder, `build<Thing>Config(input):
ChartConfiguration`, in a plain `.ts` module: no React in it, and the component passes its
result straight through. Tests assert the builder's output (or the config a chart receives)
and never mock the builder. Tequila Game, Lemony and Pulky mock only `react-chartjs-2`
(jsdom has no canvas); Beery never mocks Chart.js. Apply this to new or rewritten charts;
charts nobody is touching are not retrofitted. Every game's chart-kit tests cover the
`ChartBox` toggle, aria label and fallback, the `Legend` switch semantics and swatch, and
each plugin (bands at the right indices, the crosshair broadcasting the hovered index to
the other charts in its group). Where canvas literals mirror CSS tokens, a drift test
asserts each literal equals its `--color-*` value in `src/index.css` (Beery, Pulky; Tequila
Game has no colour tokens, and Lemony's palette is the validated dataviz set rather than
tokens).

**Interaction rules (games and the catalog).**
- Every hover detail is also reachable without a pointer: a keyboard-driven crosshair
  index, or the table view.
- Hit areas are at least 24 px (point `hitRadius` ≥ 12).
- Legend toggles work from the keyboard.
- Every chart has a table view, including the catalog's hand-built admin charts.

**Deliberately not standardized.** Palettes, fonts, heights and layouts. Beery's frozen
seams (DOM legend, screen-reader table, builder pass-through) and its one-file-one-owner
rule, so a Beery change adds modules rather than moving code between them. Lemony's
validated palette. The catalog (`Novus/Supply`), whose admin charts are hand-built HTML on
its `Table` primitive with no charting library and follow only the interaction rules.

**Gotchas.**
- A canvas cannot read CSS variables, so chart colours are literals, and only the drift
  test stops them drifting from the tokens.
- Keep plugin ids, exports and option shapes stable (about 30 of Pulky's test files read
  them, e.g. the `peakShading` id): add, don't rename.
- Beery's tests find legend switches by accessible name, so a series name must stay in its
  button text.
- The crosshair costs redraws: one group per screen, redrawing only that group's charts.

### Env vars

```
VITE_API_BASE_URL=
VITE_SOCKET_URL=
```

**Fail the build when these are empty. [HARD-WON]** `.env*` is gitignored, so CI has them only
if the repository variables are actually set. Unset, Vite substitutes empty strings, the build
goes green, and the bundle asks the Hosting origin for everything: REST survives by accident
(the `**` rewrite answers 200 with `index.html`) while WebSocket upgrades are not proxied at
all. Every real-time feature then fails on a deploy whose own CI run passed.

A Vite plugin, armed by a flag the deploy workflow sets, turns that into a red build:

```ts
function requireBackendEnv(env: Record<string, string>): Plugin {
  return {
    name: 'require-backend-env',
    apply: 'build',
    buildStart() {
      // Opt-in, so a bare `npm run build` and the dev proxy stay green.
      if (process.env.REQUIRE_BACKEND_ENV !== '1') return
      for (const key of ['VITE_API_BASE_URL', 'VITE_SOCKET_URL']) {
        const value = (env[key] ?? '').trim()
        if (!value) this.error(`${key} is empty — set the repository variable vars.${key}.`)
        if (/web\.app|firebaseapp\.com/.test(value))
          this.error(`${key} is ${value}, a Hosting origin. It must be the backend host.`)
      }
    },
  }
}
```
Read the values with `loadEnv(mode, process.cwd(), 'VITE_')`, which sees both the `.env` files
and the prefixed variables the workflow passes in. Then verify a deploy actually carried them:
```bash
curl -s https://<site>.web.app/assets/index-*.js | grep -c <backend-host>
```

### Deploy (Firebase Hosting)

```bash
npm run build
firebase deploy --only hosting
```
`firebase.json`: `public: "dist"`, SPA rewrite `**` → `/index.html`, and these `headers` in
every game (a test pins them): `/assets/**` `Cache-Control: public, max-age=31536000,
immutable`; `/index.html` and `{"regex": "^/[^.]*$"}` `Cache-Control: no-cache`, so a deploy
is never hidden behind a cached page that asks for deleted chunks; and on `**`
`X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin`. No
X-Frame-Options or CSP yet: Firebase Auth's `/__/auth/*` handler is served by the same site
and must be tested first. **Deploy the backend before the frontend** whenever a release
changes the wire contract (handshake, health, events): a new backend must keep accepting tabs
still running the old frontend, while a new frontend may rely on the new backend. Firebase Hosting does
**not** proxy WebSocket upgrades — the socket client must point directly at the backend host in
production; REST can go through either.

One Firebase project per game, set up once in the console: enable the **Google** sign-in
provider (Authentication), add a Hosting site with the game's own site id
(`sellysim`, `beersim`, `lemonysim`, `pulkysim`), register a Web app to get the
`firebaseConfig` for `firebase.ts`, and generate a service-account key for the backend
(Project settings → Service accounts). That key is the one real secret: it goes only into
the backend's `FIREBASE_SERVICE_ACCOUNT_JSON` on Render. The project id and the site id are
different things: `.firebaserc` takes the **project** id, `firebase.json`'s `"site"` takes
the **site** id. Hosting serves the app on both `<site>.web.app` and
`<site>.firebaseapp.com`; a browser on the second sends that as its `Origin`, so list it in
`CORS_ORIGINS` too if players can reach it.

---

## 2. Backend

**Core**: Python 3.11, FastAPI, plain **uvicorn** (`--http h11 --proxy-headers` needed for a
correct WebSocket upgrade behind a reverse proxy), `python-socketio`, SQLAlchemy 2.0 (sync,
declarative), psycopg 3 driver (PostgreSQL), Alembic migrations, a room-state store (Redis only
where the game needs it, see "Live state" below), `firebase-admin`, Pydantic Settings.

> Database note: every game persists to **PostgreSQL 18** (its own managed Neon project, one
> per game) through **psycopg 3** (`psycopg[binary]`, URL scheme `postgresql+psycopg://`). The
> binary wheel bundles libpq, so the slim Docker image needs no system packages for it.

### Bootstrap commands

```bash
mkdir <game>_backend && cd <game>_backend
python3.11 -m venv venv
source venv/bin/activate

pip install fastapi "uvicorn[standard]" python-socketio pydantic pydantic-settings \
  sqlalchemy "psycopg[binary]" alembic firebase-admin python-dotenv httpx redis

pip install pytest pytest-asyncio pytest-cov pytest-mock black ruff mypy  # dev/test

alembic init alembic
```

### requirements.txt (pinned)

Runtime only. Test and lint tooling goes in a separate `requirements-dev.txt` so it is not
baked into the production image — `.dockerignore` excludes `tests/`, so an image carrying
pytest ships a dependency it cannot even reach.

```
fastapi==0.141.1
uvicorn[standard]==0.53.0
python-socketio==5.17.0
pydantic==2.13.5
pydantic-settings==2.15.0
sqlalchemy==2.0.54
psycopg[binary]==3.3.9
alembic==1.20.0
firebase-admin==7.6.0
python-dotenv==1.2.3
httpx==0.28.1
redis==8.1.0
```

`requirements-dev.txt`:

```
pytest==9.1.1
pytest-asyncio==1.4.0
pytest-cov==7.1.0
pytest-mock==3.15.1
black==26.5.1
ruff==0.16.8
mypy==2.3.1
testcontainers[postgres]==4.15.0
```

Install both for local work: `pip install -r requirements.txt -r requirements-dev.txt`.

**Pin everything, and never list `asyncio`.** The PyPI package named `asyncio` is an abandoned
2015 backport, not the standard library module; installing it shadows the real one.

> **Match the venv interpreter to the image.** `python3.11 -m venv venv`, never bare `python3 -m
> venv venv`. On a machine whose default `python3` has moved on (3.13/3.14), the bare form
> silently builds the venv on a different interpreter than `python:3.11-slim` runs — a
> "works locally, breaks on Render" generator. **[HARD-WON]**

> **`pytest-asyncio` 1.x fails unmarked async tests instead of skipping them.** Under 0.21 an
> `async def test_*` with no `@pytest.mark.asyncio` was silently skipped, so a file of "tests"
> could sit in the repo for months having never run once. 1.x errors with *"async def functions
> are not natively supported"*. That is the correct behaviour — the fix is a `pytest.ini` that
> scopes collection to the real suites, not a downgrade: **[HARD-WON]**
>
> ```ini
> [pytest]
> testpaths = tests app/tests
> asyncio_mode = strict
> asyncio_default_fixture_loop_scope = function
> ```

### Folder structure

```
app/
├── main.py                 FastAPI + Socket.IO ASGI entry point (application = socket_app)
├── config.py               pydantic-settings Settings (env-var driven)
├── core/
│   ├── firebase.py         firebase_admin bootstrap (lazy init, reads a JSON env var)
│   └── game_engine.py      game rules/simulation — the part that differs per game
├── api/
│   ├── deps.py             verify_firebase_id_token(), get_current_firebase_user()
│   └── v1/                 health.py, rooms.py, users.py
├── db/
│   ├── base.py             re-exports Base  ->  from ..models.base import Base
│   └── session.py          sync SQLAlchemy engine/session, get_db() dependency
├── models/
│   ├── base.py             DeclarativeBase + TimestampMixin
│   └── game.py             domain models — game-specific
├── schemas/                Pydantic request/response models
├── services/
│   ├── state_service.py    live room state + room lock + schema guard (store per "Live state")
│   ├── db_service.py, game_service.py, user_service.py
├── sockets/
│   ├── manager.py          AsyncServer (+ AsyncRedisManager when Redis is on) + SocketManager
│   └── handlers.py         all @sio.event handlers — the room-lifecycle logic
└── tests/
alembic/
```

> `db/base.py` must be `from ..models.base import Base`. Writing `from .base import Base`
> inside `app/db/base.py` is a self-import that raises `ImportError` on any use. **[HARD-WON]**

### Auth — Firebase ID token verification

`config.py`:
```python
FIREBASE_SERVICE_ACCOUNT_JSON: str = ""   # full service account JSON, one env var, one line
```

`core/firebase.py` — lazy singleton init from that JSON blob (works on platforms like Render
where mounting a credentials file is awkward).

`api/deps.py` exposes **one** verification helper, reused by both REST and the socket layer:

```python
def verify_firebase_id_token(token: str) -> dict | None:
    """Decoded claims, or None when Firebase is unconfigured OR verification fails.
    Callers MUST treat None as 'reject' — never fall back to trusting the raw value."""
```

Apply `get_current_firebase_user` to every route returning or mutating a specific user's data;
derive `firebase_uid` from the verified token, never from the request body, and check that a
path-param uid matches the caller's own uid.

**Setting the `.env` value:** the JSON must be one line. In a `.env` file use **single quotes**
or no quotes — with double quotes python-dotenv applies escape decoding, turns the `\n` inside
`private_key` into real newlines, and then fails to parse the line at all, leaving the variable
silently unset. **[HARD-WON]**

**Fail loudly when unconfigured.** Because the handshake rejects unverifiable tokens, a missing
`FIREBASE_SERVICE_ACCOUNT_JSON` means *every signed-in user is refused a socket connection*
while guests still work — a confusing partial outage. Log it at CRITICAL on startup:

Use a **lifespan handler**, not `@app.on_event("startup")`. FastAPI deprecated `on_event`; it
still runs but emits a `DeprecationWarning` on every boot and will eventually be removed.

```python
from contextlib import asynccontextmanager

def _check_auth_config() -> None:
    if init_firebase() is None:
        logger.critical("FIREBASE_SERVICE_ACCOUNT_JSON is not set — signed-in users will be "
                        "REJECTED at the Socket.IO handshake and /users/* will 503.")

@asynccontextmanager
async def lifespan(app: FastAPI):
    _check_auth_config()
    yield
    # shutdown work goes here

app = FastAPI(title=settings.APP_NAME, version=settings.VERSION, lifespan=lifespan)
```

> Note that `TestClient` only runs the lifespan handler inside a `with` block —
> `with TestClient(app) as c:`. A bare `TestClient(app)` skips startup entirely, so a test
> asserting on startup behaviour will silently never exercise it.

### Real-time layer — the reusable "host + room" pattern

> **The transport is Socket.IO, and it is not a per-game choice.** If a game's own
> specification asks for Server-Sent Events, long polling, or raw WebSockets, that document is
> superseded on this point — see §4.
>
> SSE is a reasonable fit for one-way server-to-client streaming, and on paper a host + room
> game looks like that: clients POST an action, the server streams state back. The reason this
> stack does not use it is that **the transport is not the part you are choosing.** What you
> are choosing is the identity, authority, reconnection and fan-out layer built on top of it,
> and that layer is what §0 through §2 of this file actually describe. On Socket.IO it already
> exists, has been through a security audit, and carries every fix marked **[HARD-WON]** below.
>
> Choosing SSE means rebuilding all of it, and specifically:
>
> - **There is no handshake.** Socket.IO establishes identity once, in `connect`, from a
>   verified Firebase ID token or a regex-checked guest id, and every later handler reads it
>   from `sid_to_identity`. An `EventSource` cannot send headers, so the token has to travel
>   in a query string — where it lands in access logs and proxy logs — and has to be
>   re-verified per request on the action channel, which is a second identity path to keep
>   correct. §0 invariant 1 gets materially harder to hold.
> - **Client actions need a separate channel.** SSE is one-way, so every action is an ordinary
>   POST. That splits one ordered, authenticated stream into two independently-failing halves,
>   and the ordering between "the action arrived" and "the state that reflects it went out" is
>   yours to guarantee.
> - **Per-recipient redaction gets no help.** `emit_to_sid` versus `emit_to_room` is the
>   mechanism that keeps a player's private state out of a room broadcast. With SSE you hold
>   the response objects yourself and write the fan-out, the per-connection filtering and the
>   backpressure handling by hand — on the path where a leak is a data-disclosure bug, not a
>   glitch.
> - **Reconnection changes shape.** `Last-Event-ID` replay needs a durable, ordered,
>   per-room event log, which is a table and a retention policy. Socket.IO reconnects with a
>   fresh `sid`, re-asserts identity, and takes a full state resync — no event log, and the
>   resync path is one you need anyway for a first join.
> - **Multi-instance fan-out is on you.** `AsyncRedisManager` makes a second uvicorn process
>   a configuration line. With SSE, a client is pinned to whichever instance holds its
>   response object, and cross-instance delivery is yours to build.
>
> None of that is impossible. It is simply a large amount of security-sensitive work to
> re-earn something this stack already has, and the games in this family have no requirement
> that Socket.IO fails to meet. Corporate proxies that break WebSockets are the usual argument
> for SSE, and the `transports: ['websocket', 'polling']` fallback already covers that case.
>
> The one thing worth taking from the SSE design is the **event sequence number**. Giving every
> broadcast a monotonic per-room `seq` lets a client discard an event it already applied after
> a resync, and costs one integer.

```python
socket_app = socketio.ASGIApp(socketio_server=sio, other_asgi_app=app, socketio_path="socket.io")
application = socket_app   # uvicorn app.main:application
```

```python
sio = AsyncServer(
    async_mode="asgi",
    # Tequila Game: always Redis. The other games: only when REDIS_ENABLED.
    client_manager=AsyncRedisManager(settings.REDIS_URL) if settings.REDIS_ENABLED else None,
    cors_allowed_origins=settings.CORS_ORIGINS,   # same list as the REST CORS middleware
    ping_timeout=120, ping_interval=25,           # the same in every game
    logger=settings.DEBUG,          # NOT True — see below
    engineio_logger=settings.DEBUG,
)
```

> **Never hardcode `logger=True` / `engineio_logger=True`.** engine.io logs *every packet's
> full payload at INFO* (`'%s: Sending packet %s data %s'`). In production that is significant
> CPU on the hot path, large log egress, and it writes wire data — including player ids — into
> your logs. **[HARD-WON]**

**The handshake establishes identity, once:**

```python
@sio.event
async def connect(sid, environ, auth=None):
    id_token = (auth or {}).get("idToken")
    guest_id = (auth or {}).get("guestId")
    if id_token:
        decoded = verify_firebase_id_token(id_token)
        if not decoded:
            return False                      # reject — do not silently downgrade to guest
        identity = decoded["uid"]
    elif not guest_id:
        return False                          # no identity at all: refuse (a signed-in
                                              # client whose token failed sends none)
    elif GUEST_RE.match(guest_id):            # ^guest_[0-9a-f-]{36}$
        identity = guest_id                   # a guest can never claim a Firebase UID
    else:
        identity = f"guest_{uuid.uuid4()}"    # malformed guest id: a fresh guest
    socket_manager.sid_to_identity[sid] = identity
```

**Lifecycle events** (`sockets/handlers.py`):

| Event | Authority | Notes |
|---|---|---|
| `create_room` (REST) | none | returns `host_secret` **once** |
| `join_waiting` | `host_secret` | host claims the room for emit targeting |
| `join` | handshake identity | capacity-checked; reconnect via `session_token` |
| `leave` | server sid mapping | pre-start only |
| `config_update` | `host_secret` | **rejected once `started`** |
| `start_game` | `host_secret` | gated by `can_start()` and nothing else — see below |
| per-round submit | server sid mapping | **deduplicated per round** |
| `disconnect` | — | cleanup |

Every event in that table has a defined server response — an acknowledgement to the sid, a
broadcast, or an error. An event whose only outcome is a mutation leaves the client with
nothing to wait on, and the client then either hangs or invents a timeout. Declare the
response alongside the event, in the same table, or it will be added later by whoever
notices the hang.

**The host holds no seat.** In this pattern the host runs the room; they are not a player in
it. They hold no `alias`, are absent from the participant list, occupy no role and are never
written into any sid-to-alias map. Two consequences that are easy to get wrong:

- `join_waiting` puts the host's socket in the Socket.IO room with `await
  sio.enter_room(sid, room_id)`, **not** with the manager's `join_room(sid, room_id, alias)`
  helper — that helper exists to record a player's alias, and the host has none to record.
- Capacity is **seats occupied by people**, not slots filled in the game. Count
  `len(participants)`, never the non-null entries of a role/slot map. A player can be seated
  before they have picked anything, so a slot-derived count lets an extra person in, and the
  overflow only becomes visible at the moment the game starts. Same family of bug as the
  alias-allocation note below, and it reaches the same place: two people holding one seat.

```python
def _check_host_secret(game, data) -> bool:
    expected = str(game.get("host_secret") or "")
    # `bool(expected)` is load-bearing, not defensive noise: hmac.compare_digest("", "")
    # returns True, so without it a payload carrying no host_secret at all authorises
    # against any room whose stored secret is empty or missing. Whatever mints the secret
    # today may never produce an empty one -- which is exactly why nothing else catches
    # this, and why the guard keeps getting deleted as redundant.
    return bool(expected) and hmac.compare_digest(expected, str((data or {}).get("host_secret") or ""))
```

**Eligibility is one function, and it returns its reason.** Do not let `start_game` decide
for itself whether the room may start. Write one server-side
`can_start(room) -> tuple[bool, str | None]`, send both values on every room broadcast so the
host's Start button can *say why* it is disabled, and have the handler call the same function
and emit its sentence verbatim on refusal. The two call sites are usually a few paragraphs
apart in the same file, which is precisely how they end up as two rules: the button greys out
for one reason and the refusal names another, and the host is told something that is no
longer true. The reason string is UI copy, so pin its exact wording — a client test will
assert on it.

**`join` resolution order** — session_token first, then identity:

```python
alias = _find_alias_for_reconnect(game, session_token, identity) if session_token else None
if alias is None:
    alias = _find_alias_for_identity(game, identity)   # makes join IDEMPOTENT
```

> **Join must be idempotent. [HARD-WON]** One browser emits `join` several times in normal
> operation (page mount, the `connect` handler, and the deliberate reconnect when auth
> resolves), each on a fresh `sid` and the first with no `session_token` yet. Without the
> identity fallback, **one person fills the entire room** and is then told "Room is full".
> Matching on identity is safe precisely because identity is never client-asserted.

> A `session_token` is only honoured when the stored `identity` matches the current
> connection's verified identity — so a stolen token cannot be replayed by someone else.

> **Alias allocation must be collision-free. [HARD-WON]** Use the lowest unused `P<N>`, not
> `len(players) + 1`: a pre-start `leave()` frees a slot, and the count-based form then reissues
> a live player's alias and silently overwrites their record.

**Never put a secret in a room broadcast.** `emit_to_room` payloads carry `alias` only.
`session_token` appears in exactly one event — `joined` — sent via `emit_to_sid`. Per-player
content (feedback, private results) must also use `emit_to_sid`: broadcasting it to the room and
filtering client-side is both a leak and an O(N²) amplification.

**A redacted subset keeps the shape of the thing it is a subset of.** When a broadcast carries
the public part of the host's config, keep every surviving field at the same path it occupies
in the full object — nested where the original nests. The client stores the subset in the slot
the full object came from, so a field flattened on the way out lands where nothing reads it,
and the symptom is a control silently taking its default rather than an error. Build the
subset by *removing* keys from the real object, never by hand-assembling a new flat dict.

Every state read-modify-write inside a handler is wrapped in `state_svc.lock(room_id)`.

**The room lock is not reentrant: emit after release.** Re-acquiring the per-room lock inside
itself deadlocks the room for the lock timeout. Read, mutate, save, build the payloads and mint
`seq` inside the lock; emit, and call any other service method that takes the lock, only after
it is released. Drive a cascade (an all-bot game closing round after round) with a loop of
short acquisitions, never with recursion between two public methods. **[HARD-WON]**

**Every `start_game` refusal carries `room_code`.** Reply `join_error {message, room_code}` on
every refusal, including the rate-limit and server-error replies of the guard decorator, so a
dashboard that runs several games can put each refusal on its own game's card. Listeners that
read only `message` are unaffected.

**Disconnect cleanup runs in order.** The room-level disconnect hook (pause the game, tell the
host) runs *before* the socket manager drops the sid maps. Reversed, there is no room code left
to look the participant up by, and the game silently never pauses.

**Host recovery by identity never matches a null.** A game that lets a host reclaim a room by
verified identity after losing the tab must return `False` when the stored host identity is
null, and only a claim authorised by `host_secret` may record that identity. Otherwise the
recovery path hands a fresh room to the first stranger who asks.

**Two maps will exist, and only one is authoritative.** A `SocketManager` holding
`sid_to_alias` in process memory is convenient, and the room document holds the same
mapping. The moment `AsyncRedisManager` is configured, a second uvicorn process exists, and
the in-process map is a **cache of one worker's connections** — a handler that reads it
instead of the room document answers correctly on the worker that took the join and wrongly
on every other one. Say in one place which map is the source of truth (it is the room
document), write both on join, clear both on leave and on a reconnect's stale sid, and read
only the authoritative one inside the lock. The same applies to `sid_to_identity`, with one
difference that makes it safe: it is written at the handshake by the worker that owns the
socket, and only that worker ever handles that socket's events.

### Server-authoritative game state **[HARD-WON]**

Never accept a running total from the client. Tequila Game took a client-computed
`totalCostAccum`, used it to pick the round's "cost leader" (who received a gameplay bonus), and
persisted it as the value backing the leaderboard — so a player could send `0` and win forever.
The server already computes the per-round cost; accumulate it server-side on the player record
and let the client value be display-only.

### Room config validation **[HARD-WON]**

Host-supplied config needs **upper** bounds and cross-field checks, not just floors:

- Cap `max_weeks`, `player_num`, and any supplier/demand magnitude from settings. An uncapped
  round count is an unbounded-work (and, with AI enabled, unbounded-spend) lever.
- Enforce `min <= max` on every pair. An inverted range makes `random.randint(min, max)` raise
  `ValueError` on **every subsequent round resolution**, and because the exception fires before
  the state is persisted, the room is wedged permanently — an unauthenticated denial of service
  on that game.
- Reject `config_update` once `started`.

### Game maths and round events **[HARD-WON]**

Rules every game's core follows, each learned from a bug:

- **Round quantities half-up, never with Python's `round()`** (banker's rounding). Guard a
  `floor` of a computed fraction against float noise: `60 × (0.3 ÷ 3)` is `5.999…`, so use
  `floor(x + 1e-9)`.
- **Round each money line to cents when the round's record is written**, and build totals from
  the rounded lines, so the closing balance equals opening plus profit to the cent.
- **Every draw comes from the room's seed.** A test scans the core for module-level
  `random.*()` calls.
- **Ties never depend on dict order.** An explicit chain, then a seeded draw. Say how a null
  ratio compares, and sort aliases numerically (P2 before P10).
- **An affordability check never blocks a round.** "Do nothing" is always accepted, and costs
  already committed stay out of the check, or one broke player stalls everyone.
- **A balance identity counts the free starting units.** Units shipped, lost, delivered and in
  transit only balance if the starting stock and the pre-filled pipeline are in it.
- **A round sends the new record, not the whole history.** The client appends it and skips a
  round it already holds; full history goes at game start, on reconnect and on request.
- **A room broadcast skips the host's socket** when the host has a fuller version of the same
  payload (the config with its hidden keys), and the host gets its own copy.
- **Each resync event has its own, higher `seq`**; the client drops `seq` it has already passed.
- **"Play again" creates a new room** with the same settings, and results open from a "See the
  results" button, never an automatic redirect.

### Per-round submit **[HARD-WON]**

Reject a second submission for the same round (`if player["last"] is not None: return`).
Without it, each call appends another history entry *and* re-serialises the whole room into
the state store — O(n²) work that one client can trigger in a loop.

### The host's "who has submitted" tracker, through the last round

A host console that ticks players off as they submit reads those ticks from the host's
state, so the server sends the host a fresh state **on every submission — including the one
that completes the round.** Do not skip it on the reasoning that the round close which
follows sends a state for the next round anyway: the **final** round's close ends the game
and sends no next round, so the host's last state is the one from before the last
submission, and the console ends every game showing that player as still deciding. A host
view built after the game finishes must not reset the per-player submitted flags either (an
engine that clears its pending submissions on close reports everyone as undecided at
FINISHED). A client store that also applies the room-wide "X submitted" event to the host's
view is a cheap second line of defence, not a substitute. Test it end to end: humans plus
bots, played to the last round, and assert the host's last state marks every seat
submitted. (Beery and Pulky each shipped a variant of this.)

**Broadcast every participant the server creates.** Bots filled in at `start_game` are
participants like any other, and a client only knows a participant from a participant-list
event. If start emits only "game started" plus a role map, every client holds a list with
no entry for the bot seats, and anything rendered from that list — names, a Bot badge, the
live results' cost cards — comes out blank for exactly those seats. Emit the lobby /
participant-list payload again after the seats are filled. (Found in Beery.)

### Live state: Redis only in the Tequila Game

| Game | Live state | A restart or deploy |
|---|---|---|
| Tequila | Redis, always (`REDIS_URL` required) | games in progress survive |
| Beer, Pulque | the process's memory (`REDIS_ENABLED=false`) | games in progress are lost |
| Lemonade | the `live_games` table in PostgreSQL (`REDIS_ENABLED=false`) | games in progress survive |

With `REDIS_ENABLED=false` the service runs **one instance** (`numInstances: 1`), because the
room locks, the socket maps and Socket.IO's rooms live in that process. `REDIS_ENABLED=true`
needs `REDIS_URL`; it is one switch for all three roles Redis has:

1. **Room/game state store** (`services/state_service.py`): rooms as JSON blobs under
   `room:{room_id}` with a TTL.
2. **Distributed lock**: `redis_client.lock(f"lock:room:{room_id}")` around every mutation.
   Without Redis it is an in-process lock per room, used the same way.
3. **Socket.IO cross-instance pub/sub**: `AsyncRedisManager(REDIS_URL)` — required the moment
   you run more than one uvicorn process.

**Version the room schema. [HARD-WON]** Stored room state outlives a deploy (in Redis it sits on
a 24h TTL), so after a release that changes the room dict, the store still holds rooms in the
*old* shape. Detect them on read and discard them:

```python
def _is_current_schema(room) -> bool:
    return "sid_to_alias" in room and "host_secret" in room

async def get_room(self, room_id):
    ...
    if not _is_current_schema(room):
        await redis_client.delete(f"room:{room_id}")   # report as "room does not exist"
        return None
```

Do **not** migrate an old room in place: its `players` dict is keyed by the *old* identifier,
which is exactly the raw UID the new schema exists to stop broadcasting.

### Database

PostgreSQL 18 on **Neon**, one project per game (Free plan, AWS US East 1, the region of the
Render services), reached over TLS. Each project holds its game's database (`sellydb`,
`lemonydb`, `pulkydb`, `beerydb`; Neon's default `neondb` holds no game), and the game connects
as the project's owner role `neondb_owner` with its own password, so a leaked password exposes
one game only. `DB_HOST` is the project's **direct** endpoint (`ep-….aws.neon.tech`, never the
`-pooler` host): the pooled endpoint is PgBouncer in transaction mode, which rejects the
`options` startup parameter `db_connect_args` sends. The Free plan fixes the compute at 0.25 CU
(`max_connections` 112) and scales it to zero after 5 minutes idle, so the first request after a
pause waits a cold start (under a second) and `pool_pre_ping` replaces the dropped connections.
Its restore window is short: keep your own `pg_dump -Fc` backups. Sync
SQLAlchemy 2.0 with psycopg 3, `DeclarativeBase` + `TimestampMixin`. Credentials come from
separate env vars that `config.py` assembles into a URL-encoded
`postgresql+psycopg://user:pass@host:port/db` (encode them: a `@` or `%` in a password otherwise
breaks the URL).

```python
engine = create_engine(
    settings.db_url,
    pool_pre_ping=True,
    pool_recycle=3600,
    pool_size=settings.DB_POOL_SIZE,       # 7 (Lemony 20)
    max_overflow=settings.DB_MAX_OVERFLOW, # 2 (Lemony 4)
    pool_timeout=10,                       # fail fast instead of hanging a request 30 s
    connect_args=settings.db_connect_args,
)
```

**Size the pools to the game's connection budget.** Each game has a budget for its whole
project, deploys included: **20 connections, Lemony 50** (its live play goes through the
database while Redis is off). During a deploy Render runs the old and new instance side by side,
the new one's startup migration opens one more, and an operator `psql` one more, so
2 × (`DB_POOL_SIZE` + `DB_MAX_OVERFLOW`) + 1 + 1 ≤ budget:

| | Per instance | Normal | Deploy overlap | + migration | + `psql` |
|---|---|---|---|---|---|
| Selly, Pulky, Beery (7 + 2) | 9 | 9 | 18 | 19 | **20 of 20** |
| Lemony (20 + 4) | 24 | 24 | 48 | 49 | **50 of 50** |

Projects are separate, so games deploy independently. A backend run locally against the game's
Neon project is one more instance and takes the game over budget while it deploys; develop
against a local Docker PostgreSQL 18. To change a pool, set the two env vars; there is no code
change. Sync handlers hold a connection only for the length of a query or
transaction, so a few per instance serve many concurrent players. A burst beyond that waits up
to `pool_timeout` and then fails that one request, rather than exhausting the server for the
other games.

`db_connect_args` always carries `options="-c timezone=UTC"`, so every session runs in UTC
without a connect listener, and `connect_timeout=10`: libpq otherwise waits forever, so one
stalled connection to Neon could hang a save, a route or the deep health probe. (No
`statement_timeout` in the startup options: Neon's pooled endpoint may refuse it.) With a CA it adds `sslmode="verify-full"` and
`sslrootcert=<file>`. psycopg needs a **file path**, so `DB_SSL_CA` (PEM text or a path) is
written once to a temp file when it holds PEM text. Without a CA and with `DB_REQUIRE_SSL` it
adds `sslmode="require"`, which encrypts the connection but does not verify the server. For
SQLite test URLs it returns `{}`.

**Constraint names come from a naming convention.** `Base.metadata = MetaData(naming_convention=
{"ix": "ix_%(column_0_label)s", "uq": "uq_%(table_name)s_%(column_0_N_name)s", "ck":
"ck_%(table_name)s_%(constraint_name)s", "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
"pk": "pk_%(table_name)s"})`. A later migration then drops a constraint by a name the code
chose, not by one the database invented. Pulky once had to drop a unique key whose only name
was whatever the database had generated.

**Every timestamp is `timestamptz` in UTC, and the API says so.** Columns are
`DateTime(timezone=True)` and writers pass aware UTC datetimes. Responses serialize them as
ISO-8601 with a `Z` suffix through one annotated type, `UtcDateTime` in `app/schemas/types.py`
(`PlainSerializer` plus `WithJsonSchema({"type": "string", "format": "date-time"})`, so the
OpenAPI document keeps `format: date-time`). It treats a naive value as UTC (SQLite unit tests
return naive values). Exports and socket payloads use the same format. Pulky's schemas carry
`str` fields filled by its one formatter, `results_service.iso_utc`, with the same output. A naive `2026-11-18T14:00:00` on the wire is parsed by a browser
as *local* time, which is a silent offset bug.

**Booleans are `sa.Boolean`.** PostgreSQL has a real `boolean` and rejects an integer bound into
it, so raw SQL binds Python `True`/`False`, never `1`/`0`, and never filters with `flag = 1`.

**String equality is case-sensitive.** Normalize identifiers such as room codes (`.upper()`) at
the API boundary instead of relying on a collation.

**`char(n)` comes back space-padded.** Use `CHAR(n)` only for values that are always exactly
`n` characters (a `uuid4().hex` public id, a fixed-length room code). Otherwise use
`String(n)`.

**Dialect-specific SQL:**

| Need | Write |
|---|---|
| Upsert | `postgresql.insert(t).on_conflict_do_update(index_elements=[...], set_={c: stmt.excluded[c]})` |
| Id of a new row | `RETURNING id` (`.returning(t.c.id)`, then `.scalar_one()`) |
| Update joined to another table | `UPDATE a SET ... FROM b WHERE ...` |
| Nullable sort | `ORDER BY x DESC NULLS LAST` when NULLs must sort last |

SQLite, used by the fast unit tests, supports `RETURNING`, `ON CONFLICT ... DO UPDATE` and
`NULLS LAST`, so this SQL stays portable.

**Server defaults: timestamps only.** `server_default` exists only on the `TimestampMixin`
columns (`created_at`/`updated_at` = `now()`). Every fact column is written explicitly by the
app, with no value defaults such as `false`, `0` or `20`. A database default that silently fills
a fact hides a write bug and stores a fact nobody played.

**`TimestampMixin` needs `server_default`, not just a Python default. [HARD-WON]**

```python
created_at = Column(DateTime(timezone=True), default=_utcnow,
                    server_default=func.now(), nullable=False)
updated_at = Column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow,
                    server_default=func.now(), nullable=False)
```

`default=`/`onupdate=` are **ORM-side** and only fire for ORM inserts. Bulk result-upload paths
use raw `text()` INSERTs, which bypass them. A `NOT NULL` column with no DB-side default then
fails with `null value in column "created_at" violates not-null constraint`. The upload's
`except` swallows that error and silently drops every completed game. Let the database supply
the value and do **not** name those columns in the raw INSERT.

**Migrations are Alembic-managed**, not `create_all()` at startup. Revisions are numbered
(`0001_postgres_baseline`, `0002_...`), and the baseline builds the whole schema on an empty
database:

```bash
alembic revision --autogenerate -m "describe the change"   # then review it by hand
alembic upgrade head
```

`alembic/env.py` imports `Base`, sets `target_metadata = Base.metadata`, and passes
`settings.db_url` + `settings.db_connect_args` straight to `create_engine`. Never route the URL
through `config.set_main_option`: configparser treats a `%` in the password as interpolation.

**Migrations run at container startup.** The services are on Render's free plan, which has no
pre-deploy command, so the Dockerfile CMD runs `alembic upgrade head && exec uvicorn …`. A
failed migration exits before uvicorn starts, the new instance never passes its health check,
and Render keeps the previous deploy live. Run one instance, so Alembic never races itself.
Auto-Deploy is `After CI checks pass`, set in the Render dashboard (`render.yaml` records it as
`autoDeployTrigger: checksPass`, but the services are not Blueprint-linked, so Render does not
read the file). Back up before a migration that drops or rewrites data (`pg_dump -Fc`).

**The DDL is generated and checked in.** `Novus/scripts/db/gen_ddl.py --backend <Game>_Backend`
runs `alembic upgrade head` against a throwaway `postgres:18` container and writes the
normalized `pg_dump --schema-only` to `<Game>_Backend/db/schema.postgres.sql`. The backend's
`dbschema` suite repeats that dump against its Testcontainers database and fails if the
committed file differs, and a second test requires `compare_metadata(Base.metadata) == []`. So
models, migrations and the committed DDL cannot drift. Regenerate the file in the same change as
any migration.

**Tests.** Fast unit tests use SQLite. Tests marked `dbschema` run against a real
`postgres:18` through Testcontainers (`testcontainers[postgres]`): `alembic upgrade head`
once per session, and `TRUNCATE ... RESTART IDENTITY CASCADE` between tests. CI runs them as
their own job.

**Store facts, derive the rest. [HARD-WON]** A stored game must
read back exactly as it was played, and the schema stays normalized: nothing the database can
compute is stored.

- **Facts** are stored: the players; each round's record (the decision and what the round
  resolved: deliveries, sales, costs, inventory); the room config the game was played with, as
  real columns (one row per game, plus one row per vehicle or option), never a JSON blob; and
  what each round drew that cannot be recomputed, such as a winner picked by a seeded tie-break.
- **Derived values** (revenue, profit, budget, comparisons, flags) are not columns. One pure
  function derives them from the facts, and both the engine during play and the stored-game
  reader call it, so the two cannot drift. A new derived value goes in that function.
- **A parity test** plays whole games through the real path, stores them, reads them back and
  requires equality field for field. A second test compares the config model to the config
  columns, so a new setting cannot ship without its column and migration.
- **Exact types.** Money is `NUMERIC(20,2)` (prices rounded to the cent where they enter);
  host settings that are any number in their bounds are `double precision` (`sa.Double`). Read
  `NUMERIC` back as `float` (`Numeric(..., asdecimal=False)`), the type the engine wrote.
  Money goes over the wire as a JSON number, never a Decimal string.

Tequila Game's implementation: `Selly_Backend/app/core/records.py` (`derive_week`),
`db_service.load_game`, `tests/test_services/test_stored_parity.py`, and
`Selly/database_schema.md`.

### Query shape

- **No N+1.** Aggregate per-game/per-user stats with one grouped query using
  `text(...).bindparams(bindparam("gids", expanding=True))` and a `WHERE ... IN :gids`, then
  rank in Python. One query per game inside a loop is 1+N round trips to a cloud database —
  seconds of latency on a profile page.
- **Batch child inserts.** End-of-game persistence should be one executemany-style
  `db.execute(stmt, [ {...}, ... ])` per child table, not one INSERT per row (~150 round trips
  per game otherwise).
- **Never return `str(e)` to a caller.** `logger.exception(...)` server-side and return a
  generic message; driver errors leak host, port and user.

### Config (`app/config.py`, pydantic-settings)

```python
class Settings(BaseSettings):
    DEBUG: bool = False
    HOST: str = "0.0.0.0"
    PORT: int = 8080

    # NEVER ["*"] — the app sets allow_credentials=True, and the two together are an
    # invalid, permissive combination. Keep in sync with sockets/manager.py.
    # Local default; production sets only the site's two origins (below).
    CORS_ORIGINS: list[str] = ["http://localhost:5173"]

    DB_HOST: str = "localhost"
    DB_PORT: int = 5432
    DB_USER: str = "postgres"
    DB_PASSWORD: str = ""
    DB_DATABASE: str = "<game>db"  # the game's database in its Neon project
    DB_REQUIRE_SSL: bool = False   # true on Render; see note below
    DB_SSL_CA: str = ""            # PEM text or path of the CA bundle (note below)
    DB_POOL_SIZE: int = 7          # see "Size the pools to the game's connection budget"
    DB_MAX_OVERFLOW: int = 2

    REDIS_ENABLED: bool = False    # not in the Tequila Game, which always uses Redis
    REDIS_URL: str = ""
    FIREBASE_SERVICE_ACCOUNT_JSON: str = ""

    # Hard ceilings for host-supplied room config
    MAX_WEEKS_LIMIT: int = 100
    MAX_PLAYERS_LIMIT: int = 12

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True, extra="ignore")
```

> TLS to the managed PostgreSQL: set `DB_SSL_CA` to the Let's Encrypt roots that Neon's
> certificates chain to, ISRG Root X1 and ISRG Root X2 in one PEM bundle, so the backend
> connects with `sslmode=verify-full`, which checks both the certificate chain and the hostname.
> The bundle is public and the same for all four games. Keep the one local copy at
> `Novus/novus-secrets/neon-ca.pem` (outside every game repo; exported from macOS's
> `SystemRootCertificates` keychain) and point each local `DB_SSL_CA` at that path; on Render
> paste the PEM text of both certificates. Neon only accepts TLS connections, so
> `DB_REQUIRE_SSL` without a CA still encrypts. It does not verify the server, and the startup
> log warns about that. Confirm TLS on the client side: the boot log line, `psql`'s `\conninfo`
> (`SSL Connection | true`) or `Novus/scripts/db/verify_live_db.py`. Not with `pg_stat_ssl`:
> Neon's proxy terminates TLS, so that view reports `ssl = f` even for an encrypted link.

### Dockerfile

```dockerfile
FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y gcc && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE ${PORT:-8080}
ENV FORWARDED_ALLOW_IPS=*
# Free Render instances have no pre-deploy step: migrate, then serve.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:application --host 0.0.0.0 --port ${PORT:-8080} \
     --http h11 --proxy-headers --forwarded-allow-ips=${FORWARDED_ALLOW_IPS}"]
```

`alembic upgrade head` runs first, so the container needs its database at startup (CI only
builds the image). `exec` makes uvicorn PID 1, so it gets Render's stop signal. `--http h11` is required for a reliable WebSocket 101 upgrade. `--forwarded-allow-ips` is an
**env var, not a hardcoded `*`**, so a platform that publishes proxy IPs can narrow it; `*`
remains the default because Render does not publish fixed proxy addresses and the container is
only reachable through their proxy. Ensure `.dockerignore` excludes `.env`.

**The Render service.** A Docker web service on the free plan, built from the backend
repo's root (leave Root Directory blank), Health Check Path `/api/v1/health`. Do not set
`PORT`: Render injects it and the CMD's `${PORT:-8080}` picks it up. Each backend's
`render.yaml` records these settings (it is not Blueprint-linked; the dashboard is the source).
`CORS_ORIGINS` on the platform is a JSON array of the site's two origins,
`["https://<site>.web.app","https://<site>.firebaseapp.com"]`: never a bare comma list, never
`["*"]`, and no `localhost` in production.

> The image bakes in a **code snapshot** — there is no bind mount. A source change needs a
> rebuild, and a running container will happily keep serving the old code (which looks exactly
> like "my fix didn't work"). For iteration use `uvicorn app.main:application --reload`.

### Env vars (backend)

```
DEBUG=
CORS_ORIGINS=
DB_HOST=
DB_PORT=
DB_USER=
DB_PASSWORD=
DB_DATABASE=
DB_REQUIRE_SSL=
DB_SSL_CA=
DB_POOL_SIZE=
DB_MAX_OVERFLOW=
REDIS_ENABLED=      # Beer, Lemonade, Pulque
REDIS_URL=          # Tequila, or REDIS_ENABLED=true
FIREBASE_SERVICE_ACCOUNT_JSON=
```

### Tooling, the same in every game

- Backend: the `[tool.black]` and `[tool.ruff]` blocks of `pyproject.toml` are identical (88
  columns, Python 3.11, rules `E F I B UP`). A `noqa` carries its reason.
- Frontend: `npm test` is `vitest run`, `npm run test:watch` watches, and CI calls `npm test`.
- The build fails when the entry chunk statically reaches three.js
  (`<game>:forbid-three-in-entry-graph` in `vite.config.ts`).
- A 3D model's bytes never change under the same name: `/3dmodels/**` is cached as immutable, so a
  changed model gets a new file name.
- `.gitignore` ignores every dotenv file except `.env.example`.

### Tests **[HARD-WON]**

- **Wait for the work, not for a number of loop turns.** Code that runs in a thread
  (`asyncio.to_thread`) is not finished after N `sleep(0)`s on a slow CI runner: await the task.
- **A concurrency test needs a forced suspension point.** Against an in-memory store or
  FakeRedis, a lock test proves nothing unless the critical section yields
  (`await asyncio.sleep(0)`) between read and write. Confirm the test goes red with the lock
  removed.
- **See every new regression test fail once.** Break the code, watch the test go red, restore
  it. When a database constraint is named as the backstop for a race, check that the race can
  actually reach that constraint.
- **Package markers.** Every `tests/test_<area>/` has an `__init__.py` and `tests/` itself has
  none; otherwise a second `conftest.py` makes `from conftest import …` bind to the wrong
  module. A throwaway mapped class in a test gets its own `DeclarativeBase`, never the app's
  `Base`, which it would pollute and so break the schema comparisons.
- **No test skips itself once later code lands.** A skip-if-missing guard written for a file
  that does not exist yet keeps skipping silently after it does; delete the guard when the file
  arrives.
- **No two file names differ only by case.** On case-insensitive macOS and Windows filesystems
  an extensionless import of `demandCurve` next to `DemandCurve.tsx` resolves to the wrong file
  (TS1261). Name chart builders `*Config.ts`.
- **Test the empty case of `import.meta.glob` against an explicit record.** The glob expands at
  transform time, so the live registry is never empty once the files exist. Expose a
  `collectRoutes(record)`-style function and test that instead of the live glob.

---

## 3. Explicitly excluded

- **OpenRouter / any AI feedback provider** — cleanly separable; add per-game if wanted. If you
  do: send each player's output with `emit_to_sid`, not `emit_to_room`; put a hard daily call
  budget across every room behind a setting (`AI_MAX_CALLS_PER_DAY`, sized to the provider's
  quota), because anyone can open rooms and a paid model is an unauthenticated route to
  unbounded spend on your API key (a per-room cap stops neither, and cuts long games short);
  and make a provider failure degrade to a neutral message rather than blocking the round.
- **Gunicorn** — plain uvicorn only.

---

## 4. What changes per game

- `core/game_engine.py` — the actual rules/scoring/round logic.
- `models/*.py` + the matching Alembic migration — the domain schema.
- `schemas/*.py` — per-round decision/result payloads.
- The per-round submit/results slice of `sockets/handlers.py`, and the matching frontend
  `pages/`, `components/game/`, and socket payload types.
- Firebase project (`firebase.ts` config, `.firebaserc` project id), DB name, Redis namespace.

### What does NOT change per game

The plumbing is the point of this file, and a per-game specification does not get to
re-decide it. Specifically: the **real-time transport** (Socket.IO — see §2), the identity
model (verified Firebase ID token or guest id, established at the handshake), the
authority model (`host_secret` compared with `hmac.compare_digest`), the three identifiers
(`alias` / `session_token` / `identity`), one server-side store and lock for live rooms (see
"Live state"), and the deploy shape. Likewise, a user's game history and stats count only the games they
**played**; games they hosted appear only in the profile's separate "Games you hosted" list
(see "Host records" in §1).

A game's own spec document is authoritative on **game semantics** — rules, costs, scoring,
round structure, what a player sees. This file is authoritative on **plumbing**. Where the
two conflict, the game document is superseded on the plumbing point, and the conflict should
be written down in that game's spec rather than silently resolved in code.

---

## 5. Deployment & ops checklist

- [ ] **The wire protocol is shared.** Frontend and backend must ship **together** — an old
      frontend against a new backend means nobody can play.
- [ ] **Make CI able to build the frontend.** The workflow needs `actions/setup-node` **and**
      `npm ci`, and every file imported from `src/` must be committed. Tequila Game gitignores
      `firebase.ts` while importing it from three modules, so its CI cannot build and the
      frontend silently never deploys while the backend auto-deploys on push — the worst
      possible split. **[HARD-WON]**
- [ ] Backend env set on the platform (not only in local `.env`):
      `FIREBASE_SERVICE_ACCOUNT_JSON`, `CORS_ORIGINS`, DB vars, and `REDIS_URL` (Tequila).
- [ ] **Tequila: `REDIS_URL` points at a live instance.** Managed free-tier Redis databases get reclaimed
      when idle; the hostname then returns `NXDOMAIN` and every room operation fails. All room
      state lives there — this takes the whole game down.
- [ ] Schema: the Dockerfile CMD runs `alembic upgrade head` before uvicorn, and
      `db/schema.postgres.sql` matches it (`python scripts/db/gen_ddl.py --backend <Game>_Backend --check`).
- [ ] Startup logs show Firebase verification is **active**, not the CRITICAL warning.
- [ ] Smoke test in the deployed environment: sign in → create → join from a second browser →
      play a full round → **finish a game** (that last step is the only one that exercises the
      DB write path and account attribution).
- [ ] Test as a **guest** too — it is a separate identity path.
- [ ] Secrets: never commit `.env`; treat a service-account JSON as a credential and rotate it
      if it is ever printed, logged, or pasted anywhere.
