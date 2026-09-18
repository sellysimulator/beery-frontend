# Game Stack — Base Template

> **This file at `Novus/game_stack.md` is the single source of truth.** The copies inside
> `Beery/`, `Lemony/`, `Pulky/` and `Selly/` are generated from it. Edit this one, then
> re-copy. Do not edit a per-game copy in place — it will be overwritten.
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

Node ≥ 20.19 (or 22.12+) — Vite 7's realistic floor, and higher for Vite 8. Pin it with
`.nvmrc` / `engines.node`.

> **A 3D dependency will pin your React version.** If a game adds `@react-three/fiber`, note
> that it declares a narrow React peer range (`>=19 <19.3` as of r3f 9.7) and lags React
> releases by months. `"react": "^19.2.0"` lets npm pull a React that r3f refuses, and the
> install fails with `ERESOLVE` — on a transitive bump, so the error names a package you did
> not touch. Express the real constraint with a tilde (`"react": "~19.2.0"`) rather than
> reaching for `--legacy-peer-deps`. **[HARD-WON]**

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
- **Create/host flow**: `POST /rooms/create` → persist `host_secret` for that room id →
  navigate to the waiting room.
- **Join flow**: navigate to `/game/:roomId`, guarded by an auth/backend-ready guard.
- **Socket handlers registered once**, as a side effect in `main.tsx` *before* React renders,
  to avoid StrictMode double-mount bugs.
- **Zustand store is the single source of truth**, written only by socket event handlers.

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
                               .catch(() => cb({ idToken: null, guestId: getGuestId() }))
    else cb({ idToken: null, guestId: getGuestId() })
  },
})
```

`AuthContext` then calls `socket.disconnect().connect()` on every `onAuthStateChanged`
resolution (first resolution = initial connect; later ones = identity changed), and explicitly
in `continueAsGuest()`, since choosing guest mode fires no Firebase auth event.

Do **not** set `rejectUnauthorized: false`. It is a Node-only option that disables TLS
certificate validation and does nothing useful in a browser.

### Reconnection

On `connect`, re-emit `join_waiting` (host, with `host_secret`) or `join` (player, with the
stored `session_token`). Socket.IO issues a new `sid` on every reconnect, so identity must be
re-asserted; the server replies with a full state resync event.

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

### Firebase Auth wiring

`firebase.ts` holds the web config (public identifiers — safe to ship in the bundle):
```ts
export const auth = getAuth(app)
export const googleProvider = new GoogleAuthProvider()
```

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

### Env vars

```
VITE_API_BASE_URL=
VITE_SOCKET_URL=
```

### Deploy (Firebase Hosting)

```bash
npm run build
firebase deploy --only hosting
```
`firebase.json`: `public: "dist"`, SPA rewrite `**` → `/index.html`. Firebase Hosting does
**not** proxy WebSocket upgrades — the socket client must point directly at the backend host in
production; REST can go through either.

---

## 2. Backend

**Core**: Python 3.11, FastAPI, plain **uvicorn** (`--http h11 --proxy-headers` needed for a
correct WebSocket upgrade behind a reverse proxy), `python-socketio`, SQLAlchemy 2.0 (sync,
declarative), PyMySQL driver, Alembic migrations, Redis (`redis.asyncio`), `firebase-admin`,
Pydantic Settings.

> Driver note: use **PyMySQL**, not `mysql-connector-python`. The latter pins
> `protobuf<=4.21.12`, which conflicts with `firebase-admin` — pulling both into one venv breaks
> pip's resolver. PyMySQL is pure-Python and is a drop-in swap (`mysql+pymysql://...`).

### Bootstrap commands

```bash
mkdir <game>_backend && cd <game>_backend
python3.11 -m venv venv
source venv/bin/activate

pip install fastapi "uvicorn[standard]" python-socketio pydantic pydantic-settings \
  sqlalchemy pymysql alembic firebase-admin python-dotenv httpx redis

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
pymysql==1.2.3
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
│   ├── state_service.py    Redis-backed room state + distributed lock + schema guard
│   ├── db_service.py, game_service.py, user_service.py
├── sockets/
│   ├── manager.py          AsyncServer + AsyncRedisManager + SocketManager
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

```python
socket_app = socketio.ASGIApp(socketio_server=sio, other_asgi_app=app, socketio_path="socket.io")
application = socket_app   # uvicorn app.main:application
```

```python
sio = AsyncServer(
    async_mode="asgi",
    client_manager=AsyncRedisManager(settings.REDIS_URL),
    cors_allowed_origins=settings.CORS_ORIGINS,   # same list as the REST CORS middleware
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
    elif guest_id and GUEST_RE.match(guest_id):   # ^guest_[0-9a-f-]{36}$
        identity = guest_id                   # a guest can never claim a Firebase UID
    else:
        identity = f"guest_{uuid.uuid4()}"
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
| `start_game` | `host_secret` | requires exact player count |
| per-round submit | server sid mapping | **deduplicated per round** |
| `disconnect` | — | cleanup |

```python
def _check_host_secret(game, data) -> bool:
    expected = str(game.get("host_secret") or "")
    return bool(expected) and hmac.compare_digest(expected, str((data or {}).get("host_secret") or ""))
```

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

Every state read-modify-write inside a handler is wrapped in `state_svc.lock(room_id)`.

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

### Per-round submit **[HARD-WON]**

Reject a second submission for the same round (`if player["last"] is not None: return`).
Without it, each call appends another history entry *and* re-serialises the whole room through
Redis — O(n²) work that one client can trigger in a loop.

### Redis — three distinct roles

1. **Room/game state store** (`services/state_service.py`): rooms as JSON blobs under
   `room:{room_id}` with a TTL.
2. **Distributed lock**: `redis_client.lock(f"lock:room:{room_id}")` around every mutation.
3. **Socket.IO cross-instance pub/sub**: `AsyncRedisManager(REDIS_URL)` — required the moment
   you run more than one uvicorn process.

**Version the room schema. [HARD-WON]** Room state outlives a deploy (it sits on a 24h TTL), so
after a release that changes the room dict, Redis still holds rooms in the *old* shape. Detect
them on read and discard them:

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

Sync SQLAlchemy 2.0, `DeclarativeBase` + `TimestampMixin`. Credentials come from separate env
vars assembled in `config.py` (`mysql+pymysql://...`).

```python
engine = create_engine(
    settings.db_url,
    pool_pre_ping=True,
    pool_recycle=3600,
    pool_size=10, max_overflow=20,     # don't silently inherit QueuePool's 5+10
    connect_args=settings.db_connect_args,
)
```
Plus a `connect` event listener running `SET time_zone = '+00:00'` — keep every timestamp UTC.

**`TimestampMixin` needs `server_default`, not just a Python default. [HARD-WON]**

```python
created_at = Column(DateTime(timezone=True), default=_utcnow,
                    server_default=func.now(), nullable=False)
updated_at = Column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow,
                    server_default=func.now(), nullable=False)
```

`default=`/`onupdate=` are **ORM-side** and only fire for ORM inserts. Bulk result-upload paths
use raw `text()` INSERTs, which bypass them — so a `NOT NULL` column with no DB-side default
fails hard under a strict `sql_mode` (`STRICT_ALL_TABLES`) with
`Field 'created_at' doesn't have a default value`, swallowed by the upload's `except` and
silently dropping every completed game. Let the database supply the value and do **not** name
those columns in the raw INSERT — that keeps the same SQL correct against a schema that has the
columns and one that doesn't.

**Migrations are Alembic-managed**, not `create_all()` at startup:
```bash
alembic revision --autogenerate -m "describe the change"
alembic upgrade head          # fresh/dev database
alembic stamp head            # adopt Alembic on a DB whose tables already exist
```
`alembic/env.py` imports `Base`, sets `target_metadata = Base.metadata`, and pulls the URL from
`app.config.settings.db_url` at runtime.

> **Verify the live schema before trusting the migration. [HARD-WON]** Tequila Game's production
> database was built by the old `create_all()`, was never stamped, and has no `alembic_version`
> table — so the migration file and the real schema disagree (the live tables have no
> `created_at`/`updated_at` at all). Running `alembic upgrade head` there would try to recreate
> existing tables. On any inherited database, inspect `information_schema.COLUMNS` first.

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
    CORS_ORIGINS: list[str] = ["https://<game>.web.app", "http://localhost:5173"]

    DB_HOST: str = "localhost"
    DB_PORT: int = 3306
    DB_USER: str = "root"
    DB_PASSWORD: str = ""
    DB_DATABASE: str = "app_db"
    DB_REQUIRE_SSL: bool = False   # opt-in; see note below
    DB_SSL_CA: str = ""

    REDIS_URL: str = ""
    FIREBASE_SERVICE_ACCOUNT_JSON: str = ""

    # Hard ceilings for host-supplied room config
    MAX_WEEKS_LIMIT: int = 100
    MAX_PLAYERS_LIMIT: int = 12

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True, extra="ignore")
```

> TLS to a managed MySQL: PyMySQL negotiates TLS opportunistically, so a managed provider may
> already be encrypting the connection even with no `ssl` connect args — verify with
> `SELECT * FROM performance_schema.session_status WHERE VARIABLE_NAME='Ssl_cipher';` before
> assuming it isn't. The durable control is `require_secure_transport=ON` on the server, which
> covers every client; `DB_REQUIRE_SSL` is belt-and-braces.

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
CMD ["sh", "-c", "uvicorn app.main:application --host 0.0.0.0 --port ${PORT:-8080} \
     --http h11 --proxy-headers --forwarded-allow-ips=${FORWARDED_ALLOW_IPS}"]
```

`--http h11` is required for a reliable WebSocket 101 upgrade. `--forwarded-allow-ips` is an
**env var, not a hardcoded `*`**, so a platform that publishes proxy IPs can narrow it; `*`
remains the default because Render does not publish fixed proxy addresses and the container is
only reachable through their proxy. Ensure `.dockerignore` excludes `.env`.

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
REDIS_URL=
FIREBASE_SERVICE_ACCOUNT_JSON=
```

---

## 3. Explicitly excluded

- **OpenRouter / any AI feedback provider** — cleanly separable; add per-game if wanted. If you
  do: send each player's output with `emit_to_sid`, not `emit_to_room`; put a hard per-room call
  budget behind a setting (`AI_MAX_CALLS_PER_ROOM`), because an uncapped round count plus a
  paid model is an unauthenticated route to unbounded spend on your API key; and make a provider
  failure degrade to a neutral message rather than blocking the round.
- **Gunicorn** — plain uvicorn only.

---

## 4. What changes per game

- `core/game_engine.py` — the actual rules/scoring/round logic.
- `models/*.py` + the matching Alembic migration — the domain schema.
- `schemas/*.py` — per-round decision/result payloads.
- The per-round submit/results slice of `sockets/handlers.py`, and the matching frontend
  `pages/`, `components/game/`, and socket payload types.
- Firebase project (`firebase.ts` config, `.firebaserc` project id), DB name, Redis namespace.

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
      `FIREBASE_SERVICE_ACCOUNT_JSON`, `CORS_ORIGINS`, `REDIS_URL`, DB vars.
- [ ] **`REDIS_URL` points at a live instance.** Managed free-tier Redis databases get reclaimed
      when idle; the hostname then returns `NXDOMAIN` and every room operation fails. All room
      state lives there — this takes the whole game down.
- [ ] Schema: `alembic upgrade head` (new DB) or `alembic stamp head` + a manual
      `information_schema` check (inherited DB). Never assume the migration matches production.
- [ ] Startup logs show Firebase verification is **active**, not the CRITICAL warning.
- [ ] Smoke test in the deployed environment: sign in → create → join from a second browser →
      play a full round → **finish a game** (that last step is the only one that exercises the
      DB write path and account attribution).
- [ ] Test as a **guest** too — it is a separate identity path.
- [ ] Secrets: never commit `.env`; treat a service-account JSON as a credential and rotate it
      if it is ever printed, logged, or pasted anywhere.
