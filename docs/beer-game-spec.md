# The Beer Game — Multiplayer Web Application
## Functional & Domain Specification

**Status:** Describes the shipped game.
**Audience:** Anyone changing Beery, human or agent.
**Architectural precedent:** the **Tequila Game** (see §1.3) and the shared stack in `game_stack.md`.

---

## 0. Purpose of this document

This document defines **what the game is, what its rules are, what every parameter does, what every role is responsible for, and what a player sees at every moment**. It is exhaustive about game semantics. Implementation detail lives in the code and in the two repositories' `CLAUDE.md` and `README.md`; where this document names a module, it is to say where a rule lives.

Where this document says **MUST**, the behaviour is a hard requirement. **SHOULD** is a strong default that may be revisited. **MAY** is optional scope.

§15 Decisions records where this spec deliberately departs from `game_stack.md` or the Tequila Game, and why. Code comments cite those decisions by number (`D7`). §16 lists what is not built yet.

---

## 1. Overview

### 1.1 The game

The Beer Distribution Game is a supply-chain simulation. Four players form a linear chain:

```
Customer → [Retailer] → [Wholesaler] → [Distributor] → [Factory] → (production)
   demand flows upstream as orders  ◄────────────────────────────
   beer flows downstream as shipments ──────────────────────────►
```

Each simulated week, every player receives a shipment, fulfils the order placed by their downstream neighbour, pays holding and backlog costs, and decides how much to order from their upstream neighbour. Orders and shipments both take time to arrive. Nobody except the Retailer sees true customer demand.

The pedagogical payload is the **bullwhip effect**: a small, stable change in customer demand produces oscillations that amplify upstream. The application's job is to make that effect *visible and measurable*, not to hide it.

### 1.2 What this version adds over the classic game

- Real-time multiplayer over the web, with a host who configures and observes but does not play.
- Far greater configurability than the MIT board version: every delay, cost, starting condition and demand pattern is a host-set parameter.
- Per-round clarity: an explicit, unambiguous statement of the player's options each week and a settlement recap of what changed and why.
- Optional accounts, so results can be tracked across sessions.
- An optional first-person 3D warehouse view of the same figures (§9.7).

### 1.3 Relationship to the Tequila Game

The **Tequila Game** (`Selly/`) is the multiplayer game whose plumbing `game_stack.md` was distilled from. It is a **software precedent only**. Its gameplay is *not* relevant and is not copied.

What Beery takes from it, through `game_stack.md`:

- Room/lobby lifecycle and invite-link mechanics.
- Session and participant modelling, reconnection handling.
- The real-time event/broadcast pattern.
- Round orchestration: how a turn is opened, collected, closed and persisted.
- Project layout, naming conventions, and error/response envelope conventions.

**This document wins on game semantics; `game_stack.md` wins on plumbing**, except where §15 records a deliberate departure.

---

## 2. Technology stack

| Layer | Technology | Notes |
|---|---|---|
| Backend framework | **Python 3.11 + FastAPI** | Async endpoints |
| Real-time transport | **Socket.IO** | `python-socketio` ASGI app wrapping FastAPI, mounted at `/socket.io`; `socket.io-client` on the frontend (D1) |
| ORM | **SQLAlchemy 2.0** | Declarative models |
| Migrations | **Alembic** | Every schema change ships a migration |
| Database | **PostgreSQL 17 (Aiven, cloud-hosted)** | Credentials from environment file only |
| Live room state | **In-process store by default, Redis optional** | `REDIS_ENABLED` (D4) |
| Auth | **Firebase Authentication (Google)**, verified by `firebase-admin`, plus guests | D2 |
| Frontend | **React + Vite + TypeScript**, state in **Zustand** | |
| Styling | **Tailwind CSS** | |

**Hard constraints:**

1. **The database is reachable only through the backend.** The frontend MUST NOT hold DB credentials or construct SQL. Every read and every mutation goes through the backend.
2. **Every table the game uses MUST be fully manageable from the backend** — created, migrated, read, written and deleted via SQLAlchemy models and Alembic revisions. No manual, out-of-band DDL.
3. **Connection credentials live in a `.env` file** (host, port, database, user, password, pool settings), loaded via a settings object. No credential ever appears in source, in the client bundle, or in a log line.
4. Game actions are socket emits and state changes travel back over the socket. REST (`/api/v1`) carries room creation, configuration, previews, results, export and the profile (§11).

---

## 3. Users and accounts

### 3.1 Account modes

Login is **optional**. Both modes are supported end to end.

| Mode | How they identify | Stats tracked | Notes |
|---|---|---|---|
| **Registered user** | Google sign-in through Firebase Auth | Yes, permanently | Can review past games |
| **Guest** | A client-minted `guest_<uuid4>` kept in `localStorage`, plus a display name | Not until claimed | Finished games are stored under the guest id and can be claimed later |

**Registered users.** The backend verifies the Firebase ID token at the socket handshake and on every `/users` and claim route; the identity is the verified uid. An ID token that fails verification, or verifies with an empty or non-string uid, rejects the connection and never falls back to an accompanying guest id. Identity is fixed at connect and never accepted from a later payload.

**Guests.** The guest id is stable per browser, which is what lets a guest reconnect. It is accepted only if it matches `^guest_[0-9a-f-]{36}$`; anything else, including a non-string, gets a fresh one. Guests are never written to `users`.

**Claiming a guest's games.** A guest's finished games are persisted under their guest id. `POST /games/claim` (signed in) attributes every participant row holding that guest id and no `user_id` to the caller — every seat that browser played; hosting is never claimed, because a guest host is never recorded (D23) — recomputes their stats and returns the count. An unknown id returns 0 and writes nothing (no `users` row either), and a second claim is a no-op. The guest id is a bearer capability: a uuid4 that never leaves the browser that minted it, sent only in the claim body, never broadcast or logged; v1 adds no further protection. The results page and the profile offer the claim (§9.8, §9.9).

### 3.2 User types within a game

There are exactly two participant types.

#### HOST
- Creates the room and owns it.
- Configures every game parameter.
- Assigns or delegates roles.
- Starts, pauses, resumes, and ends the game.
- **Does not play.** The host holds no inventory, places no orders, incurs no cost, and holds no alias or seat.
- Sees a **god view**: the full chain, every player's inventory, backlog, orders, costs, and the true demand curve — at all times, regardless of the visibility settings imposed on players.
- Is the only user with access to the room before the game starts and before players have joined.
- **Needs no account** (D3). Anyone, guest or signed in, may host: `POST /rooms/create` needs no sign-in and returns a `host_secret` once. Host authority is that secret (compared with `hmac.compare_digest`), or the verified identity that claimed the room with it, for recovery after a lost tab (D18).
- **Is recorded only when signed in** (D23). The finished game keeps the host's account (`games.host_user_id`) only if the connection that started it presented a verified Firebase token; a guest host is never recorded. The record lists the game under "Games you hosted" on that account's profile and does nothing else.

#### PLAYER
- Joins a room via the invite link or the room code.
- Occupies exactly one of the four chain roles.
- Makes one decision per week: the order quantity.
- Sees only what the host's visibility settings permit.
- May be a registered user or a guest.

**One role per player. One player per role.** A user cannot hold two roles in the same game, and a role cannot be shared.

---

## 4. Room lifecycle

```
LOBBY ──► CONFIGURING ──► RUNNING ◄──► PAUSED
  │                          │            │
  └──────────────────────────┴─► FINISHED ◄┘
```

| State | Who is present | What happens |
|---|---|---|
| `LOBBY` | Host + joining players | The room exists and has its code. Players arrive, name themselves as they join, and take seats |
| `CONFIGURING` | Host + waiting players | The first accepted config change moves `LOBBY` here. Players see a waiting screen with a live participant list |
| `RUNNING` | All | Weeks execute |
| `PAUSED` | All | Set by the host, or by a player disconnecting (D7). Nothing resumes it but the host |
| `FINISHED` | All | Results screen, charts, exports |

`RoomState` also declares `READY` and `ABANDONED`; the code never enters either (they are treated as pre-start and over respectively). A room is never archived: its live document expires 24 hours after its last save (§11.3), and a finished game lives on in PostgreSQL (§10). The host leaving never changes the state. A game starts straight from `LOBBY` or `CONFIGURING`; `RUNNING` and `PAUSED` end in `FINISHED` when the last week closes or the host ends the game early.

### 4.1 Creation and invitation

1. Anyone, guest or signed in, creates a room; no account is needed. The server mints:
   - a **room code** (6 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` — no `0/O`, `1/I/L`), and
   - a **`host_secret`**, returned once. The browser keeps it in tab-scoped `sessionStorage`.
2. The host claims the room over the socket with `join_waiting`, by secret — or, if the tab holding the secret is gone, by a verified connection identity equal to the room's recorded `host_identity`, which re-issues the secret (`host_claimed`, sent to that socket only). Only a secret claim records `host_identity`, and a room with no recorded identity can only be claimed by secret, so the recovery path can never be used to become host. Without it a closed host tab would leave a paused game nobody can resume. A second tab with the secret simply becomes the current host socket.
3. The host shares the invite link (`/join/:roomCode`) out of band, or shows the full-screen join QR code.
4. Players open the link, choose an identity (Google or guest), and on the game screen type the name the room should call them right before their first `join` (§4.2), then land in the lobby. They do not see game parameters while the host is configuring — only the room code, host name, participant list, their own seat/role status, and a clear "waiting for the host" state.

### 4.2 Joining rules

- A newcomer may join only in `LOBBY`, `CONFIGURING` or `READY` ("Game has already started.") and only while fewer than 4 participants are present ("Room is full."). Seats taken counts participants, not filled roles, and the host is never counted.
- `join` resolves the caller first by `session_token` (honoured only when the stored identity matches the connection's verified identity), then by identity alone, so repeated joins from one browser never create a second seat.
- **Reconnection is always permitted** for a participant who already holds a seat, at any state. A returning participant gets the same alias and token; mid-game they also get `game_started` and `your_state` to rebuild the screen. A `PAUSED` game is never resumed by a reconnect.
- `leave` works only before the start and removes only the caller (the alias is read from the server's socket map, never from the payload).
- **Display names are chosen on the game screen, before the first `join`** (`game_stack.md` "Display names"). A browser holding no `session_token` for the room shows a "Your name" form, prefilled from the last name this browser used (`localStorage['display_name']`), capped at 24 characters, and sends no `join` until it is submitted; the submit stores the name and joins with it, and an empty submit joins with no name. A browser holding the room's `session_token` is rejoining: it skips the form and joins at once, re-sending the stored name, as every reconnect does; a reconnect without a token sends no `join`. The name is set when the seat is created, and a later `join` for the same seat keeps it. The welcome screen and the home screen's join form ask for no name; the host types theirs in the create-room form (and on multi-game setup), sent as `host_display_name`.
- Display names are sanitised server-side: whitespace control characters become a space, other control characters are removed, whitespace is collapsed, the result is trimmed, clamped to 24 characters and trimmed again. An empty name falls back to the alias (`P1`..`P4`), or "Host".

### 4.3 Filling empty seats and starting

Whether the game may start is one rule (`RoomService.can_start`); the first match wins:

1. Already running → "The game is already running."
2. Over → "This game has already finished."
3. The config does not build → "The configuration is not valid yet."
4. Bot fill off and roles unfilled → "*One/Two/Three/Four* role(s) is/are still empty. Assign them, or turn on bot fill." (Under `RANDOM`, occupied means participants present.)
5. A person in the room holds no role (never under `RANDOM`) → "*names* has/have no role yet. Give everyone in the room a role first; bots fill only the seats nobody holds."

The same `(can_start, start_blocked_reason)` pair is on every `lobby_update` and is the only gate `start_game` applies, so the Start button and the refusal show the same sentence. The game never starts with an empty link in the chain.

With **bot fill** on, bots take only the roles nobody holds, named "*Role* (bot)" with the next free `P<N>` alias, and are labelled as bots to every participant. A repeated start on a running room is silently ignored.

---

## 5. Role assignment

The host picks one of three modes in the lobby:

| Mode | Behaviour |
|---|---|
| `HOST_ASSIGNS` | Only the host's `assign_role` works; a player's `claim_role` is refused ("The host is assigning roles."). The host picks a role for each participant from a select. |
| `PLAYER_CHOOSES` | Players claim a free role from the lobby, first come first served. A claim is atomic under the room lock, and the claimant's previous role is released in the same step. The host can still seat anyone who has not picked. |
| `RANDOM` | Both claim and assign are refused. Roles are dealt at start with `random.Random(f"{seed}:roles")` over the participants in alias order, where `seed` is `config.random_seed` or a fresh `randrange(2**31)` stored on the room. Players learn their role on the first game screen. |

Assigning a role someone already holds is refused ("That role is already held by another participant. Set them to No role first."), so a host override is unseat, then assign. Changing the mode, even to the same value, clears every assignment.

The four roles are fixed in identity and order:

| Index | Role | Downstream neighbour | Upstream neighbour |
|---|---|---|---|
| 0 | **Retailer** | End customer (demand generator) | Wholesaler |
| 1 | **Wholesaler** | Retailer | Distributor |
| 2 | **Distributor** | Wholesaler | Factory |
| 3 | **Factory** | Distributor | Production line (no supplier) |

---

## 6. Game parameters

All parameters below are set by the host before the start, validated server-side, and **frozen at start** in the live room state. When the game finishes they are written as normalised rows (`game_configs`, `role_configs`, `demand_configs`), one column per parameter (§10, D5).

**Presets** populate the whole config:

- **`CLASSIC_MIT`** is every default in this section (36 weeks, `STEP` demand 4 → 8 at week 5). It is the preset `/rooms/create` uses (marked `is_default` on `/rooms/presets`).
- **`FAST_GAME`** is `CLASSIC_MIT` at 20 weeks.
- **`CHAOS`** is 52 weeks; every role has shipping delay 4, information delay 3 and inventory 8; the Factory has production delay 4 and capacity 20; demand is `STOCHASTIC` `NORMAL` with mean 8 and standard deviation 4 in [0, 25]; the supply-line prompt is off.

A preset card's figures are written by the server from the preset itself (`scenario_summary`), and every preset must pass the host validator unchanged. A fully manual configuration is always available.

### 6.1 Game-level

| Parameter | Type | Default | Range | Meaning |
|---|---|---|---|---|
| `duration_weeks` | int | 36 | 8–104 | Number of weeks played |
| `stage_count` | int | 4 | 4 (fixed for v1) | Reserved for chains of other lengths (§16) |
| `role_assignment_mode` | enum | `HOST_ASSIGNS` | `HOST_ASSIGNS` \| `PLAYER_CHOOSES` \| `RANDOM` | See §5 |
| `pause_on_disconnect` | bool | true | — | Auto-pause if a player drops mid-game (D7) |
| `bot_fill_empty_roles` | bool | false | — | See §4.3 and §8.5 |
| `random_seed` | int \| null | null | ±(2^53−1) | Set for reproducible demand and role dealing |
| `currency_symbol` | str | `$` | at most 4 characters | Display only |
| `preset_name` | str \| null | null | — | The preset the config started from; cleared by any later edit |

`random_seed`'s range is the largest integer a browser holds exactly. Null means the server draws one at start and stores it on the room and as `games.rng_seed`. An unreadable seed reads as null, never 0, because 0 is a fixed seed.

There is no turn timer (D6) and no chat (§13).

### 6.2 Per-role starting conditions

Configured **per role** (Retailer / Wholesaler / Distributor / Factory), with an "apply to all" convenience control.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `initial_inventory` | int | 12 | Units on hand at week 1 |
| `initial_backlog` | int | 0 | Unfulfilled units carried in |
| `shipping_delay_weeks` | int | 2 | Weeks a shipment spends in transit from the upstream neighbour |
| `information_delay_weeks` | int | 2 | Weeks an order from this role's **downstream customer** takes to reach **this role** (the role's own incoming-order pipeline). It is set on the role the order travels *to*: the Wholesaler's value is how long the Retailer's orders take, and it is part of the Retailer's lead time; a Distributor delay of 4 makes the Wholesaler's lead time 6 with 2-week shipping. Unused for the Retailer, whose customers' orders arrive at once |
| `initial_pipeline_quantity` | int | 4 | Units pre-loaded into **each** in-transit slot |
| `initial_order_in_pipeline` | int | 4 | Order quantity pre-loaded into **each** slot of this role's incoming-order pipeline: the customer's orders already on their way at week 1. The customer sees them as "Orders you've placed" (so the Retailer's screen shows the **Wholesaler's** value). The Retailer has no incoming-order pipeline: its value only seeds a Retailer bot's first demand estimate |

The Factory has no upstream supplier; its `shipping_delay_weeks` is replaced by:

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `production_delay_weeks` | int | 2 | Weeks between a production order and finished goods arriving |
| `production_capacity_per_week` | int \| null | null (unlimited) | Max units the factory can start per week. `0` (or blank) also means unlimited; the excess over capacity is queued, never lost |

A role's **lead time** is its supplier's information delay plus its own shipping delay; the Factory's is its production delay alone. The server computes it once (`GameConfig.order_arrival_lead_weeks`) and sends it both to the player (`your_state`) and to the host form (`POST /rooms/preview`), so no screen adds delays up. The Factory's inherited `shipping_delay_weeks` is stored but unused, and the form hides it.

### 6.3 Costs

Per role, overridable individually.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `holding_cost_per_unit_week` | decimal | 0.50 | Charged on end-of-week on-hand inventory |
| `backlog_cost_per_unit_week` | decimal | 1.00 | Charged on end-of-week backlog |
| `fixed_order_cost` | decimal | 0.00 | Charged once per non-zero order placed |
| `unit_purchase_cost` | decimal | 0.00 | Optional cost of goods; 0 keeps the classic scoring |
| `starting_capital` | decimal | 0.00 | Display only (D8): when > 0, that player's view also carries `balance = starting_capital − accumulated_cost` |

The server always accumulates cost. `starting_capital` changes no scoring, ranking or statistic, and there is no bankruptcy. The currency symbol is the game-level `currency_symbol`.

### 6.4 Demand pattern (end-customer demand seen by the Retailer)

Host picks exactly one generator:

| Generator | Parameters (defaults) | Week *w* = 1..N |
|---|---|---|
| `CONSTANT` | `value` (4) | `value` |
| `STEP` | `initial_value` (4), `step_week` (5), `step_value` (8) | `initial_value` while *w* < `step_week`, then `step_value` |
| `RAMP` | `initial_value` (4), `slope_per_week` (1.0), `start_week` (5), `cap` (null) | `initial_value` before `start_week`; from it, `initial_value + slope·(w − start_week + 1)` (the first ramped week already carries one step), then capped |
| `SEASONAL` | `base` (8), `amplitude` (4), `period_weeks` (12), `phase` (0.0 rad) | `base + amplitude·sin(2π(w−1)/period + phase)`, so week 1 sits at `base` |
| `STOCHASTIC` | `distribution` (`NORMAL`), `mean` (8), `stdev` (2), `min` (0), `max` (20) | One draw per week, in week order. `NORMAL`: Gaussian, rounded and clamped to [`min`, `max`]. `POISSON`: Knuth's algorithm with λ = `mean`, clamped. `UNIFORM`: an integer in [`min`, `max`] |
| `CUSTOM` | `values: int[]` of length ≥ `duration_weeks` | The first N values; extras are ignored. Pasted or uploaded as CSV |

All rounding is half-up (never banker's) and every value is floored at 0. Only `STOCHASTIC` reads the seed: it uses the game's `random_seed` through the named stream `Random(f"{seed}:demand")`, separate from the role deal's `Random(f"{seed}:roles")`, so changing one does not shift the other, and a longer game extends the series rather than reshuffling it.

The full demand series is generated **at game start** and kept in the live room state; it is written to `demand_series` when the game finishes, so the game is reproducible and the results screen can chart true demand against every player's orders.

### 6.5 Visibility and difficulty

These are the levers that let a host teach a specific lesson.

| Parameter | Type | Default | Effect |
|---|---|---|---|
| `show_true_customer_demand_to_all` | bool | false | When true, every player sees real end demand — demonstrates the value of shared POS data |
| `show_neighbour_inventory` | bool | false | Reveal immediate neighbours' on-hand/backlog |
| `show_all_inventories` | bool | false | Full chain transparency |
| `show_supply_line_prominently` | bool | true | Highlights in-transit units in the decision panel — the single biggest driver of good play |
| `show_running_cost_to_players` | bool | true | Players see their own accumulated cost |
| `show_leaderboard_during_game` | bool | false | Compare costs across roles mid-game |
| `max_order_quantity` | int \| null | null | Caps a single order. `0` (or blank) means no per-game cap; the global ceiling (9 999) still applies. An order above the cap is refused, not cut down |

Orders have a floor of 0; there are no negative orders. A stored config, room or export that still carries an `allow_negative_orders` key loads and ignores it.

### 6.6 Validation rules (server-side)

Every range lives once, in the backend (`app/core/limits.py`), and is served at `GET /api/v1/rooms/limits`; the host form builds its checks from that response and keeps no copy. **A value outside its range is refused with a message naming the range — never silently clamped.** The only repairs change nothing a host chose: a cap of `0` means unlimited, and an inverted stochastic `min`/`max` is swapped.

| Field | Range |
|---|---|
| `duration_weeks` | 8..104 |
| Every delay (shipping, information, production) | 1..8 — a zero delay collapses the pipeline and removes the phenomenon, so it is refused |
| `initial_inventory`, `initial_backlog`, `initial_pipeline_quantity`, `initial_order_in_pipeline` | 0..9 999 |
| Every cost and `starting_capital` | 0..1 000 000 |
| `max_order_quantity`, `production_capacity_per_week` | 1..9 999, or 0/blank = unlimited |
| Demand quantities (`value`, initial/step values, `base`, `amplitude`, `min`, `max`, `cap`, each `CUSTOM` entry) | 0..9 999 |
| `slope_per_week` | ±9 999 |
| `STEP` `step_week` | 2..`duration_weeks` |
| `RAMP` `start_week` | 1..`duration_weeks` |
| `SEASONAL` `period_weeks` / `phase` | 2..104 / ±2π |
| Stochastic `mean`, `stdev` | 0..9 999 |
| `CUSTOM` `values` | length ≥ `duration_weeks` |
| `currency_symbol` | ≤ 4 characters |
| `random_seed` | ±(2^53−1) |
| Bot θ, α, β / `target_stock_multiplier` | 0..1 / 0..10 |
| Rooms per batch create | 2..10 |
| Display name | ≤ 24 characters after sanitising (§4.2) |

**How untrusted input is read.** A numeric string counts as a number (`"40"` → 40; `CUSTOM` entries pasted from a spreadsheet arrive as strings, and 4.7 truncates to 4, but a negative entry such as −0.5 is refused before truncation). A value that is not a number at all, an unknown `role_assignment_mode` or `distribution`, and a `stage_count` other than 4 fall back to the default rather than erroring. A missing key takes its default, so a demand-kind change may send `{kind}` alone. NaN/inf, a missing role, an unknown demand kind or a non-mapping payload are refused. Every refusal names one dotted field (`roles.RETAILER.holding_cost_per_unit_week`; `demand.values`, unindexed, for any `CUSTOM` entry) and a message naming the range ("duration_weeks must be between 8 and 104, not 500."), checked in the order `duration_weeks` → `currency_symbol` → roles → demand.

**Changing the config.** A change is a partial patch merged by one server function (`merge_config_patch`) for both `PUT /rooms/{code}/config` and the `config_update` socket event: deep for roles, visibility and bot; a patch that changes `demand.kind` replaces the whole demand block and the server fills that kind's defaults. Any state other than `LOBBY`/`CONFIGURING`/`READY` refuses the change (400, or `join_error` "Cannot change configuration after the game has started."). The first accepted change moves `LOBBY` to `CONFIGURING`. The UI renders from the stored config the server returns, never from what it sent.

Config is immutable once `RUNNING`. To rerun a setup, create a new room.

---

## 7. The week: authoritative sequence

A week has three phases. **The server is authoritative.** The client never computes state; it renders what the server sends.

### Phase A — Settlement (server, automatic)

Executed for all four roles, inside the room's lock:

1. **Receive.** Pop the oldest slot of the incoming-shipment pipeline. `inventory += arriving`.
   *Factory:* pop the production pipeline instead.
2. **Read demand.** Pop the oldest slot of the incoming-order pipeline → `incoming_order`.
   *Retailer:* `incoming_order` = the demand series value for this week.
3. **Compute obligation.** `obligation = incoming_order + backlog_carried_in`.
4. **Ship.** `shipped = min(inventory, obligation)`; `inventory -= shipped`; `backlog = obligation - shipped`.
5. **Deliver.** Push `shipped` into the downstream neighbour's shipment pipeline.
   *Retailer:* units leave the system to the customer.
6. **Charge.** Holding and backlog: `holding_cost × inventory + backlog_cost × backlog`, on the closing values. Accumulate. The order cost — `fixed_order_cost` (for an order above 0) + `unit_purchase_cost × order` — is charged when the week **closes** (Phase C, D10), not here. The stored record's `total_week_cost` is the sum of both; **no screen shows a single "week cost"**: players see "Holding & backlog" and "Order cost" separately, the latter as "not yet charged" while the week is open.

The engine runs these steps in **three passes** over the four roles (D9):

- **Pass 1:** every role advances both pipelines (steps 1–2), and the Retailer's incoming order is replaced by `demand_series[week-1]`.
- **Pass 2:** every role settles and pushes its shipment downstream (steps 3–6).
- **Pass 3:** `supply_line_after` and `orders_in_flight_after` are sampled for the week record.

Separate passes make the result independent of role order by construction. A single pass happens to give the same numbers with today's unbounded `Pipeline`, but would silently become order-dependent if `push()` ever changed. Pass 3 is the one that matters: sampling inside settlement gives the Retailer a week-1 Classic supply line of 4 in forward order and 8 in reverse, and 8 is correct. So at decision time every role sees a supply line of 8 except the Factory, which sees 4 because its production line refills only in Phase C. Tests run the passes in reversed role order (`GameEngine.start(role_order=...)`) and assert identical results.

Phase A produces the **settlement recap** (§9.3) and opens the decision window.

### Phase B — Decision (players)

- Every player sees their post-settlement state and submits **one integer: the order quantity**.
- Decisions are **simultaneous and hidden**. No player ever sees another player's order — not during the week and not after it closes; they see only who has decided. (The host sees every order once the week closes.)
- An order is a whole number from 0 to the game's ceiling (`max_order_quantity`, or 9 999). One outside that is **refused** with `INVALID_ORDER` and a message naming the bounds — never clamped — and the order form checks the same two numbers, which it reads from `your_state` (`min_order_quantity`, `max_order_quantity`). There are no negative orders.
- v1 is untimed (D6). A player may resubmit until the week closes: the new order replaces the old one (idempotent by role; nothing is logged), up to 20 submissions per role per week (§12.1).
- The week closes when all four orders are in, or when the host force-closes it. A force-close records 0 for each missing role and sets `was_forced` on that role's week record only. `was_forced` is stored on the record, not only on the live event, because `weeks.was_forced` is NOT NULL and the engine is reloaded from the room document on every event.

### Phase C — Propagation and close (server, automatic)

7. Push each order into the upstream neighbour's **order pipeline**, and charge its order cost (D10).
   *Factory:* push into the **production pipeline**: any queue carried in is added to this week's request, `production_capacity_per_week` is applied, and the excess is queued, never lost; the queue is visible to the Factory player.
8. Append one week record per role to the engine's history in the live room document. PostgreSQL is written only when the game finishes (D4, §10).
9. If the closed week was `duration_weeks`, the game becomes `FINISHED` and the week counter is **not** incremented, so a finished game reports `week == duration_weeks` and never "Week 37 of 36". Otherwise the counter becomes `week + 1` and Phase A runs.

**Ending early.** `end_early()` abandons the open week: it writes no week record, and that week's Phase A holding and backlog cost is rolled back out of `accumulated_cost`, so the console and the results agree. `weeks_played` is always `len(history) // 4`. It differs from `week` while a week is open and after an early end, and every count of weeks played (stats, persistence, host console) uses `weeks_played`, never `week`.

### 7.1 Worked example (defaults, Retailer, week 6 of a STEP game)

```
Carried in:  inventory 12, backlog 0, in-transit [4, 4], orders-in [4, 4]
A1 Receive   arriving 4                → inventory 16
A2 Demand    customer demand week 6 = 8  (the step)
A3 Obligation 8 + 0 = 8
A4 Ship      min(16, 8) = 8            → inventory 8, backlog 0
A5 Deliver   8 units to customer
A6 Charge    0.50 × 8 + 1.00 × 0 = $4.00
B  Decide    player orders 10
C  Propagate 10 enters Wholesaler's order pipeline, arrives in 2 weeks
```

### 7.2 Invariants (assert these in tests)

- `inventory ≥ 0` and `backlog ≥ 0` at all times.
- `inventory × backlog == 0` — you cannot simultaneously hold stock and owe units.
- Units are conserved: nothing is created except by the Factory's production, nothing is destroyed except by customer consumption.
- No order ever skips a pipeline slot; no shipment ever arrives early.
- The Factory's production queue is never negative, and every pipeline is back at its configured length between weeks.
- Accumulated cost never decreases, except that ending early rolls the abandoned week's holding and backlog cost back out.
- Replaying the order history against the config and seed reproduces the game exactly.

---

## 8. Domain objects and responsibilities

Each object below is a first-class, independently testable unit in `app/core/`, which does no I/O.

### 8.1 `GameConfig`
Immutable value object holding every parameter from §6. Responsibilities: validate untrusted host input (`from_host_input`, §6.6); serialise to and from the room document; expose typed accessors per role, including `order_arrival_lead_weeks`. Knows nothing about players or state.

### 8.2 `DemandGenerator`
Given a `GameConfig`, produces the full `list[int]` of weekly customer demand at game start. One subclass per generator type (§6.4). Deterministic given a seed. Never called again during play; the host form's preview calls the same function (§9.10).

### 8.3 `Pipeline`
A fixed-length FIFO of integers representing goods in transit or orders in flight.
Responsibilities: `advance()` (pop the front, return it), `push(qty)` (add at the back), `total()` (sum of contents — this is the *supply line*), `weeks_until_out` (each slot's "arrives in N weeks", sent by the server so no screen derives it). Length = the configured delay. Pre-loaded at initialisation.

Each week does one advance then one push per pipeline, so a quantity pushed in week *w* comes out in week *w* + length. That is the only timing rule in the game; every delay reduces to it. The supply line a deciding player sees is the total after this week's arrival and before their order is pushed. A pipeline never holds a negative slot.

### 8.4 `RoleAgent` and its four subclasses

An agent holds `inventory`, `backlog`, `shipments` (for the Factory, its production line, of length `production_delay_weeks`), `orders` (None for the Retailer: customer demand arrives with no pipeline), `accumulated_cost`, `last_order`, `is_bot` and, for the Factory, `production_queue`.

It never references a neighbour; the `GameEngine` routes every shipment and order. Phase A is `advance()` (pop both pipelines) then `settle()`. Phase C is `record_order()` (which charges the order cost) with the engine pushing the order upstream, or, for the Factory, `start_production()`. There is no per-agent visible state: the redacted view is `GameEngine.player_view()`, because it needs the neighbours' state and the demand series.

| Subclass | What is specific to it |
|---|---|
| `RetailerAgent` | Its demand source is the demand series, not an order pipeline. Its shipments leave the system. |
| `WholesalerAgent` | Pure intermediary. No special behaviour beyond the base. |
| `DistributorAgent` | Pure intermediary. No special behaviour beyond the base. |
| `FactoryAgent` | No upstream supplier. Owns the production pipeline, the optional capacity constraint and the production queue. Its "order" is a production order. |

Intermediaries are behaviourally identical; they differ only in position, neighbours and cost parameters.

### 8.5 `BotAgent`
Fills an empty role or a seat the host swapped. Implements Sterman's anchor-and-adjust rule:

```
expected_demand_t = θ · observed_demand_(t-1) + (1 − θ) · expected_demand_(t-1)
order_t = max(0, expected_demand_t + α · (S* − inventory_t + backlog_t − β · supply_line_t))
```

Defaults: `θ = 0.25`, `α = 0.30`, `β = 0.25`, `S* = initial_inventory × target_stock_multiplier` (default 3.0), per role. θ, α, β and the multiplier are host-configurable in the `bot` config block (θ/α/β 0..1, multiplier 0..10, refused outside).

The bot is deliberately a plausible human, not an optimal one: an optimal bot would flatten the bullwhip the game teaches. It is a decision rule, not a `RoleAgent`: the engine still owns the bot seat's agent, the play loop asks the bot for a number, and the bot's memory (`expected_demand`, `last_observed_demand`) is serialised in the room document. The opening anchor is that role's `initial_order_in_pipeline`, the Retailer's included. Each week the play loop calls `observe(incoming_order)` then `decide(inventory, backlog, supply_line)`. The anchor is smoothed against the previous week's observation, so week 1 orders from the initial anchor alone. The order is half-up rounded and floored at 0; the play loop caps it at the game's order ceiling before submitting, and `decide()` itself never caps.

`β` is the supply-line weighting. **β = 1 is milder, not steady:** `supply_line` is shipments in transit only and there is no desired-supply-line term, so on flat demand of 4 bots still order 9–14 at first and later dip below demand. Bots are labelled in the UI.

### 8.6 `GameEngine`
The orchestrator, and the only object that mutates game state. It owns the four agents, the demand series, the week counter and the phase.

The engine is **pure**: no I/O, no Redis or DB handle, no clock, no global RNG. It is built from a config plus a state payload and driven by method calls — `start`, `submit_order`, `close_week(force)`, `end_early`, `set_bot`, `player_view`, `host_view`, `to_payload` / `from_payload`. It returns week records that the socket layer turns into events and the end-of-game persistence turns into rows; it emits no events and persists nothing. Bots, seating, pause/resume and export formatting live outside it.

**Week record.** One record per role per closed week: `openings`, `arrived`, `incoming_order`, `obligation`, `shipped`, `unfulfilled`, `closings`, `supply_line_after`, `orders_in_flight_after`, `order`, `was_bot`, `was_forced`, the four cost components, `total_week_cost`, `cumulative_cost`, and the Factory's `production_started` / `production_queued`. `was_bot` means whoever placed the order that stood at the close (bot or human): swapping a seat mid-week does not reattribute an order already placed, and a forced week goes to the seat holder at the close. This record is the unit the results, the export and the `weeks` rows are built from.

**Player view (redaction).** `player_view` is built server-side and is the only state a player receives.
- Its `orders_in_flight` and `orders_in_flight_slots` are the supplier's order pipeline: this role's own orders that the supplier has not yet received. For the Factory they are 0 and `[]`. They are never the role's own incoming-order pipeline, because that would show next week's demand and destroy the information delay.
- `production_queue` is the Factory's unstarted production, and null for the other three.
- With `show_leaderboard_during_game` on, the leaderboard is sorted ascending by `accumulated_cost`, ties broken by chain position.
- `customer_demand_series` is truncated to the current week.
- `balance = starting_capital − accumulated_cost`, sent only when `starting_capital > 0`.
- The view carries the role's own holding and backlog rates, so the recap can print "N units × rate" without the client multiplying.
- No other role's order quantity appears under any combination of visibility flags.

### 8.7 `RoomService`
Room lifecycle, invite codes, join/leave, seat claiming, role assignment modes, reconnection and the start rule (`can_start`, §4.3). The host's powers during play are pause, resume, force-close the week, swap in a bot, and end early (§9.6).

### 8.8 Redaction in the socket layer
Per-recipient redaction happens **server-side** before send; redaction in the client is not acceptable. `player_view(role)` applies the visibility rules and goes only to that player's socket; `host_view` (including `order_history`) goes only to the host's socket. No room broadcast may contain `order`, `inventory`, `backlog`, `accumulated_cost`, `week_cost`, `week_holding_backlog_cost`, `week_order_cost`, `total_week_cost`, `record`, `order_history`, `identity`, `session_token` or `host_secret`. `game_finished`'s `orders_by_role` is the one deliberate reveal, and it still carries no identity or secret.

### 8.9 `StatsService`
Post-game computation (D12), from week records only, never from live agent state:

- **Demand variance** is the population variance (ddof 0) of `demand_series[:weeks_played]`.
- **Bullwhip ratio** = `Var(orders) / Var(demand)`, or null when `Var(demand)` is 0 (`CONSTANT` demand) — never inf or 0.
- **Shipped vs waiting** = Σ`shipped` / Σ`obligation` (each week's backlog counted again), or null when Σ`obligation` is 0. Its wire name is `fill_rate`; no screen calls it that.
- **Total cost** is the last record's `cumulative_cost`, not a re-sum.
- **Peak inventory / peak backlog** are the maximum closing values; **weeks in backlog** counts closing backlog > 0; also order variance and average order. The **chain total** is the sum of the four roles' costs.
- An early-ended game divides by `weeks_played` and excludes the abandoned week.

Results are written to user stats for registered players — including a player whose seat the host swapped to a bot mid-game: the game still counts for them, bot weeks included (§10).

---

## 9. Player experience per round

This is a hard requirement, not polish. The teaching value collapses if players are confused about mechanics rather than about demand.

### 9.1 Decision panel — "what you have"

The screen is the role banner on top, the recap and the decision panel side by side (stacked on a phone, recap first), and the history chart below. Always visible, always in the same place:

- **Role banner**: role name, position in the chain (a small chain diagram with the player's position highlighted), who you buy from, who you sell to.
- **Week X of Y**.
- **On hand** — current inventory.
- **Backlog** — units you owe, if any, in an alarming colour with an icon.
- **Incoming shipments** — the supply line, shown **slot by slot** ("4 units arriving next week, 6 the week after"), with the total. This must be prominent; underweighting it is the single most common losing mistake. With `show_supply_line_prominently` off the supply line collapses to its bare total; the per-week breakdown is absent, not hidden.
- **Orders you've placed** that haven't reached your supplier yet. Not shown to the Factory.
- **Waiting to be produced** — the Factory only, when its capacity queue is above 0.
- **This week's incoming order** — the quantity demanded of you.
- **Your costs**: this week's holding & backlog, this week's order cost ("not yet charged" until the week closes), and accumulated. Never a single "week cost".

Neighbour inventories, the whole chain, the leaderboard and the true customer demand series each appear only when their visibility flag is on (§6.5).

### 9.2 The decision itself — "what you can do"

- A single numeric input: **how many units to order from your supplier**. For the Factory it reads "How many units to start producing".
- Live preview: "Ordering N units", with the server's `order_arrival_lead_weeks` and `order_arrival_week` (= week + lead) as sent; the client adds nothing. For the Factory the preview says when production will finish.
- Quick-fill buttons: *match incoming order*, *repeat last order*, *order zero*.
- Explicit statement of the only constraints that apply: minimum 0, maximum the game's ceiling (`max_order_quantity`, or 9 999), both read from `your_state`. A number outside them is refused, with the server's own message.
- A confirm action, then a submitted state showing *"Order submitted — waiting for the other players"* with a live tick-list of who has and hasn't submitted (names only, never quantities).
- **Change my order** reopens the form pre-filled until the week closes. The server accepts at most 20 submissions per role per week; the 21st gets "You've changed this order too many times. Your last order stands."
- A numeric input blurs on the mouse wheel, so scrolling the page never changes an order.

### 9.3 Settlement recap — "what just happened"

Shown immediately after Phase A, as a step-by-step ledger, not a single number:

```
Week 6 settlement
  Received from Wholesaler          +4     inventory 12 → 16
  Customer ordered                   8
  You shipped                        8     inventory 16 → 8
  Unfulfilled                        0     backlog stays 0
  Holding cost   8 units × $0.50    $4.00
  Backlog cost   0 units × $1.00    $0.00
  ────────────────────────────────────────
  Holding & backlog                 $4.00
  Order cost   charged when the week closes   Not yet charged
  Total so far                     $21.50
```

Every line is a server field; the client does no arithmetic. The first line names the real upstream neighbour ("Finished production" for the Factory); the demand line reads "Customer ordered" for the Retailer and "*Downstream role* ordered" otherwise; "backlog stays N" appears only when the closing backlog equals the opening backlog. With `show_running_cost_to_players` off the last line (Total so far / Balance) is omitted but the week's own cost lines still show; with `starting_capital > 0` the last line is Balance. When a week closes the recap swaps and is highlighted for 400 ms so the change is noticed.

Plus a running chart of the player's own history across weeks so far, in two panels:

- **Stock:** on hand above zero, with what is on the way stacked on top of it, and backlog (owed) drawn below zero.
- **Orders:** the orders the player received against the orders they placed, on one axis.

Every plotted figure is one of the player's own week records; nothing is summed or derived.

### 9.4 Waiting states
Every wait says what is being waited for and who is holding it up: *"Waiting for the Distributor to submit"*, *"Host has paused the game"*.

### 9.5 End of game
- Final cost per role and chain total.
- The big reveal: **true customer demand plotted against all four order streams** on one chart. This is the moment the lesson lands.
- Bullwhip ratio per role: `Var(orders) / Var(customer demand)`.
- Peak inventory, peak backlog, weeks in backlog, shipped vs waiting.
- A player's game screen stays up when the room finishes: the decision form is replaced by a short "the game is over" panel (no figures beyond the player's own history) on both the 2D and the 3D board. It links to the results page, `/results/:publicId`, once `game_persisted` has delivered the `public_id`; until then it says the results are being saved and offers no link (never one by room code).
- CSV/JSON export of the full week-by-week record, for anyone who can see the results, by the game's `public_id` only (`GET /games/id/{public_id}/export`, D22): once per format per browser session, and the server limits each address to 100 exports an hour. The file names each player by seat only (`P1` Retailer … `P4` Factory), never by the name they chose. Two of its columns are easy to misread, so they say what they hold: `incoming_orders_in_flight_after` is the orders travelling **to** the role (its customer's orders not yet arrived) — not the player's on-screen "orders in flight", which are the player's **own** orders going upstream — and `total_week_cost` is holding + backlog + fixed order + purchase cost for the week.

**The export file.** CSV has one row per (week, role), ordered by week then chain order, so two exports of one game are byte-identical. Its columns, in order: `room_code`, `week`, `role`, `display_name`, `is_bot`, `was_bot`, `was_forced`, `customer_demand`, the week's quantities, `order_qty`, the four cost parts, `total_week_cost`, `cumulative_cost`, `production_started`, `production_queued`. `customer_demand` is repeated on all four rows of a week; money has 2 decimals; the Factory-only columns are blank for other roles; `is_bot` is the seat at the end and `was_bot` who placed that week's order. A cell starting with `=`, `+`, `-` or `@` gets a leading `'`. The file is named `beery-{room_code}-{YYYYMMDD}.csv`. JSON is the results payload plus the same rows as a `weeks` array.

**There is no export by room code** (D22): a room code is six characters and reissued, so it names no particular game. No secret, account or bearer token opens one, the recorded host's included (D23).

### 9.6 Host console

- **All four roles side by side, live.** Each role card shows on hand, backlog, supply line, orders on the way to them, last order, incoming order, accumulated cost and a submitted tick, plus, for the Factory, *in production* (its supply line) and *queued* (`production_queue`). Every number comes from `host_state`; the seat's display name, Bot badge and connection dot with its label come from the lobby participants matched by role. A seat with no participant shows the role label and no connection dot. The host's "orders on the way to them" is the role's own incoming-order pipeline, not the player's figure of a similar name.
- **The host's state.** `host_state` is the unredacted engine view: the full `demand_series` including future weeks, every role's live figures and `order_history` (each closed week's orders). That is why it is only ever sent to the host's socket and never broadcast. Per role, `orders_in_flight` there is that role's own incoming-order pipeline (the export's `incoming_orders_in_flight_after`). `production_queue` is 0 rather than null for non-Factory roles, so the four cards share one shape. `has_submitted` shows whether a role has ordered; the host sees the quantity only after the week closes.
- **The demand curve.** On the console it plots the whole demand series (the host alone may see future demand): played weeks solid, future weeks faded and dashed, the current week marked and shaded. It overlays each role's orders for closed weeks from `order_history`, in that role's colour and dash, with demand drawn on top, and its table gains a column per role. The chain diagram's lanes carry two count chips each — beer on the way (the downstream role's `supply_line`) and orders in flight (the upstream role's `orders_in_flight`) — on the console only.
- **Controls**, and when each is enabled: **Pause** (running), **Resume** (paused), **Close this week now** (running, and someone still has to decide), **Swap in a bot** per role (running or paused, not already a bot), **End the game now** (running or paused), **Present** (always). The three destructive ones open an in-page confirmation dialog stating the consequence and emit nothing until confirmed: force-close names the roles that will be recorded as ordering 0; swap names the player and says it can't be undone and that they keep their seat in the results; end-early says "Week N is still open: ending now drops it, cost and all, and the game finishes with M weeks played", using `host_state.week` and `host_state.weeks_played` as sent. Every control carries the stored `host_secret`.
  - Force-close records the missing orders as 0 (`was_forced` on the record), sends no `order_submitted` for them, and is refused while paused.
  - A bot swapped in while the game is paused plays the moment the host resumes; the displaced player keeps the game in their history and statistics. The swapped player can take their own seat back ("Take back my role", `reclaim_seat`) while the game is running or paused; until then their submit is refused with "A bot is playing your role. Take it back to order again." The host has no "give it back" control.
  - Ending early drops the open week: its holding and backlog cost is rolled back out of every live total, so the console and the results agree.
- **Disconnections (D7).** A seated human dropping from a running game pauses it (when `pause_on_disconnect`) with the reason "*name* (*ROLE*) disconnected". There is never an automatic bot swap or automatic resume, and a reconnect does not resume. The host leaving never pauses or changes state: players get a dismissible alert (`host_disconnected`), then `host_reconnected` when the host reclaims.
- **Pause banner.** When paused the console shows a prominent banner with the server's `paused_reason` verbatim and a Resume button. The game never resumes by itself, so this banner is the only way out of a pause.
- **Presentation mode**, for a classroom screen. It shows the chain diagram (backlog marked by an icon as well as colour), Week X of Y, the demand curve up to the current week only, and a submission tracker with names and ticks only — never a cost, an order quantity, a lane chip or future demand. It is a client-side mode over the same store (no second socket or polling): entering sets the mode and then requests full screen only if the browser offers it; Escape exits whether or not full screen happened; the console stays mounted underneath, so exit is instant. Large type (≥ 32 px body) and high contrast for a projector.
- **The finished console.** After the game ends the console keeps the final chain state, headed "Finished — N weeks played" (`host_state.weeks_played` until `game_finished` arrives), with a prominent "See the results" link to `/results/:publicId` once `game_persisted` has arrived ("Saving the results…" until then). Every control, Present included, is removed rather than disabled.

### 9.7 3D board view

A player may swap the 2D board for an optional first-person **3D warehouse** that renders exactly the same `PlayerView`: stock is crates on the floor, backlog is crates in a fenced pen, the supply line is crates on numbered lanes between the player and the door, and the order is placed at a desk. Its purpose is pedagogical: it makes the supply line, the most-ignored figure (§9.1), physically present.

**Scope.** The player board only, including after the game finishes. The host console, presentation mode and results stay 2D. No other players' warehouses or avatars. No backend change: no config field, endpoint or socket event. Drag-look only (no pointer lock), no pinch-zoom, gyroscope or joystick. The 2D board remains the default, the fallback and the accessible board.

**Choosing the board (D20).** The resolution order is `localStorage['board_view']` → `VITE_BOARD_VIEW` (the build default) → `'2D'`; any value other than `'2D'`/`'3D'` is treated as unset and falls through. A fixed bottom-right button on both boards ("Switch to the 3D warehouse" / "Switch to the 2D board"; not `aria-pressed`; at least 44 px; clear of the safe-area inset; above the pause overlay) flips it and writes `localStorage`. It is enabled on every pointer type, and under `prefers-reduced-motion` the offer of 3D carries a warning line. Switching remounts the board, so an unconfirmed half-typed order is lost, the same as a refresh.

**The hall.** One shell for all four roles, laid along one axis: upstream (receiving bay, inbound road, orders going out) to the north, downstream (dispatch, demand) to the south, and the order desk between the spawn point and everything upstream. Walls with an open sky, no ceiling, one uniform light. There are three stations: the **order desk**, the **ledger wall** and the **team board**. Role identity comes only from an accent colour, a role sign over the desk, the north fixture and the south fixture:

| Role | Dressing |
|---|---|
| Retailer | A shop: glass front, two customer figures, one-tier shelving |
| Wholesaler | A loading dock: three roller doors, a truck backed in tail-first, two-tier racking |
| Distributor | An open cross-dock: through-aisle, three-tier racking |
| Factory | A brewery: four brewing tanks; no inbound road, courier or gate, replaced by a blank wall signed "YOU BREW YOUR OWN SUPPLY"; the desk verb is "start producing" |

Colour is never the only signal: the backlog pen also has a fence, the warning glyph and the word OWED.

**Figures.** A quantity only decides how many crates are drawn (`crateCount = clamp(floor(q / 2), 0, cap)`; caps 40 for stock and backlog, 12 per supply lane, 10 per order slot, 20 for the production queue, and one bill per 10 currency units capped at 20), and every pile carries a sign with the server's true, uncapped figure. The supply-line total is the server's `supply_line`, never a sum of lanes; at most four lanes are drawn, and extras fold into a "+N more" placard. Each visibility block (the supply-line lanes, neighbours, chain, leaderboard, customer demand series, running cost, production queue) is **omitted** from the scene when off, not hidden. The production-queue bay exists only for the Factory and only when the queue is above 0. The cost corner exists only when a running-cost field is sent, while the ledger wall's per-week settlement money lines always render, exactly as the 2D recap does.

**Interaction.** WASD or the arrow keys walk, drag looks (pitch clamped); on a touch screen a move pad walks, strafes and turns. There are no clickable meshes: standing within 3.6 m of a station shows a prompt, and E (or the Open button) opens a DOM panel holding the existing 2D components — order desk: the decision form, the waiting list or the game-over panel; ledger wall: the settlement recap and the "what you have" panel; team board: who has submitted (names only) and the player's own history chart. Escape closes the most recent panel. The desk prompt's precedence is paused ("Paused. *reason*"; E inert, walking frozen, looking allowed) > game over > changing order > submitted (can or cannot change) > the default "order from *upstream*", or "start producing" for the Factory. A week change gives a ≤ 400 ms signal (the ledger frame flashes, the front lane lifts, and a `role=status` announcement is made). A server refusal is a DOM strip at the top centre, never in the scene, so it cannot be missed by facing the wrong way.

**Accessibility and fallbacks.** The canvas is `aria-hidden` and its wrapper is `role=img`, labelled by a generated scene description. The recap, the "what you have" panel and the history table are mounted exactly once, `sr-only` while their panel is closed, so a screen reader always reaches every figure. Under reduced motion the lane lift is dropped (colour flash only) and there is never head-bob. If WebGL is missing, or its context is lost mid-game, the board falls back to 2D and stores `'2D'` so the next load does not retry; the player loses nothing because the server holds all state.

The 3D models are CC-BY-4.0 and credited in the app ("3D model credits") and in `Beery_Frontend/README.md`.

### 9.8 Results page and charts

**The payload.** The results are read from PostgreSQL, so they outlive the room. They need no authentication (a results URL is shareable) and carry display names and outcomes only: no identity, guest id, user id, token or secret, and no configuration beyond `currency_symbol`, `duration_weeks` and `preset_name` (costs and delays are the host's to reveal in the debrief). They are addressed only by the game's `public_id` (D22): `GET /games/id/{public_id}/results`, 404 for an unknown id, no time limit. There is no route by room code. `per_role` is always in chain order; `display_name`/`is_bot` describe who held the seat at the end; the per-week arrays (orders, closing inventory, closing backlog, cumulative cost) and `demand_series` are index-aligned (index 0 = week 1, length `weeks_played`); every statistic, `chain_total_cost` included, comes from `compute_stats` over the stored weeks.

**Reaching it.** One URL, `/results/:publicId`, public and permanent (D22). The live end-of-game screens link to it once `game_persisted` has delivered the `public_id`; the profile's "Games you hosted" links to it too. The page always fetches `GET /games/id/{public_id}/results`, retrying a 404 twice before "Results aren't available yet."; it never renders from the live store, a room code or anything in browser storage, so the same link shows the same game to anyone. (Browser storage still decides one presentation detail: costs start hidden in the tab that hosted the room.)

**Order, top to bottom** (the debrief's order): cost per role and the chain bar; the bullwhip chart with its ratio bars; the cumulative-cost race; the ratio/per-role table; the net inventory panels; the week-by-week tables; then debrief notes, export, the claim prompt and Play again. The profile's match detail uses the same order and components.

- **Costs.** Four cost cards (display name, Bot badge, total cost) plus the chain total, behind a **Reveal** control so the host can ask the room to guess first. Costs start hidden exactly in the tab holding that room's host secret (the one projecting) and shown everywhere else. The cumulative-cost chart shares the same revealed state, because it would give the ranking away.
- **Bullwhip chart.** True customer demand (thick, solid, drawn on top) against the four roles' orders on **one** y-axis starting at 0 — a second axis would flatten the contrast that is the lesson. Each role has a distinct colour and dash, so it survives projectors, photocopies and colour-blindness. A DOM legend gives one switch per series plus a "Show all" / "Clear selection" toggle. The debrief's "Retailer first, then upstream" is Clear selection, then switching roles on one at a time; the role switched on last is drawn at full strength while the others fade (no emphasis with one role, or all via Show all).
- **Ratio bars.** Below the bullwhip chart, one bullwhip-ratio bar per shown role on a log axis with a 1× rule. A null ratio gets the dash and its explanation; a ratio of 0 gets no bar (it cannot sit on a log axis) and a caption saying so.
- **Role table.** One row per role, Retailer to Factory: bullwhip ratio (the most prominent column, read aloud), order variance, peak inventory, peak backlog, weeks in backlog (integers), shipped vs waiting and average order. `fill_rate` is headed "Shipped vs waiting" with the printed definition "Units shipped ÷ units owed, counting each week's backlog again…"; the words "fill rate" never appear on screen. A null ratio shows "—" with "Customer demand never varied, so there's nothing to amplify." (never 0, ∞ or NaN); a null shipped-vs-waiting shows "—" with "Nothing was ever demanded of this role." Each positive ratio has a decorative, `aria-hidden` inline bar on a fixed 0.1×–1000× log scale (clamped) with a 1× tick.
- **Net inventory.** Four small panels, Retailer → Factory, on one shared y-range (top = the largest `peak_inventory`, bottom = minus the largest `peak_backlog`, both server fields). Stock is an area above zero and backlog an area below zero; the sign flip is geometry only, and tooltips and tables print backlog as positive. No inventory-minus-backlog series exists. The panels share a crosshair.
- **Cumulative-cost race.** One line per role from `cumulative_cost`, the y-axis titled with the currency symbol, hidden until Reveal.
- **Claim prompt.** Offered only to a guest (guest mode with a stored guest id) whose browser played a seat in this room (holds its `session_token`): "Sign in to keep this result in your profile." A guest who only hosted is not offered one: a claim moves only played seats and a guest host is never recorded (D23). Signing in with Google then posts `POST /games/claim` with the guest id in the body only, and shows the count and a link to `/profile`. It is offered after the game, never as a gate, and never sells an account as the way to export.
- **Debrief notes.** The host's tab shows a collapsed panel with the manual's Step 7 talking points, ending with "no one was incompetent… The structure produced the outcome."
- **Play again** returns to `/home` and says the game must be set up again, because nothing carries over.
- **Print handout.** Printing gives a one-page handout of the bullwhip chart and the ratio table. Every region carries `data-print="keep"` or `"omit"`, and the print rules key off that attribute only. Reveal, the legend and switches, ratio bars, cost race, net inventory, week-by-week tables, export, claim, debrief notes and Play again are omitted.

**Chart kit.** Every chart sits in a box with an HTML title, the canvas in a `role="img"` wrapper inside an error boundary (whose fallback says the same figures are in the table), and a "Show table" toggle that unhides the same screen-reader table. Legends are DOM switches. Charts that share a week axis share a crosshair; inside such a group the canvas wrapper is focusable and ArrowLeft/ArrowRight step the shared crosshair. A chart plots server fields only: a combination of two values is shown with geometry (stacking, a sign flip below the axis), never as a computed series.

### 9.9 Profile and game history

- **`/profile`** (signed in) shows five figures from `GET /users/me/stats`, each with a one-line explanation: games played; weeks played; average cost per week (total cost ÷ weeks; lower is better); average bullwhip ratio (the mean of each game's non-null ratio; closer to 1 is better); best game (lowest cost per week, linking to `/profile/games/{best_game_public_id}`). Above them, whenever at least one game is finished, a note says that games of every length and setting are pooled. Below them, games played per role. A null average ratio shows "—" with "None of your games had customer demand that varied…". A user with no games sees "You haven't finished a game yet." and a link to `/home`, not an error.
- **Stats with no history.** A new account's stats are zeros, with `bullwhip_avg` and `best_game_public_id` null (a ratio of 0 would be a claim), never a 404.
- **Match history** (`GET /users/me/games`) lists only games the caller played a role in, newest first, 20 per page (`page_size` clamped 1–100 on the server), from one query. Games they only hosted appear in neither the history nor the stats (they have their own list, below). Columns: date, room, role, weeks, your cost, bullwhip (null = "—"), chain total, preset. The page number lives in the URL (`?page=N`) and a page replaces the table. Each row opens `/profile/games/:publicId` by the game's `public_id`, never by room code (recycled) or an internal id. The listing shows the stored `games.chain_total_cost`, which can differ from the recomputed figure on the full results by under a cent. On mount the profile makes exactly three `/users/me/*` requests (stats, page 1 of the history and page 1 of the hosted games), never one per row.
- **Bullwhip trend.** Directly above the history table, one dot per game on the current history page (no extra request), oldest first by `finished_at` whatever order the list came in, in the role's colour and point style, on a log axis with a 1× rule. Games with a null ratio or a ratio of 0 are left out and counted in the caption; with fewer than two plottable games it shows "Play at least two games with a bullwhip ratio to see a trend."
- **Match detail** (`/profile/games/:publicId`) fetches `GET /users/me/games/{public_id}` (the same payload as the public results) and renders it with the results page's own components in §9.8's order, including the cost race and net inventory. A game the caller did not play a seat in (one they only hosted included) is a 404, shown as "That game isn't in your history." — never a permission message that would confirm it exists.
- **Games you hosted** (`GET /users/me/hosted-games`, D23). A separate section below the history: the games the caller hosted while signed in, newest first, paged like the history (`?hosted_page=N` in the URL). Each entry shows the date, the room code, the seats and whether it ended early, and links to the open results page `/results/:publicId`. Empty: "You haven't hosted a game while signed in yet." It is a list only; the history and the stats stay played-only.
- **A guest on `/profile`** sees "Sign in to keep your results." with Google sign-in and, when a guest id exists, a claim offer covering every game this browser played (no room or session token needed, unlike the results-page prompt); the same `POST /games/claim` flow.
- **Sign out** clears the Firebase session and the guest id and reconnects the socket, but keeps every per-room `session_token`, so a player signed out mid-game keeps their seat.

### 9.10 Lobby, seating and host configuration screens

- **Welcome (`/`).** Exactly two identity choices, Sign in with Google or Continue as a guest, plus links to both manuals. It asks for no name (§4.2). An invite link opened before choosing an identity is remembered, and the visitor lands back on it afterwards; otherwise on `/home`.
- **Home (`/home`).** *Host a game*: "Name to host as" (prefilled from the account name, else the last name this browser used; stored on create), optional preset, Create; the one-time host secret is stored before navigating to the host lobby. *Join a game*: the room code only; the player names themselves on the next screen. The code field uppercases and drops any character outside the room-code alphabet, and `GET /rooms/{code}/status` is checked first: an unknown room is an inline error, a full room an inline error naming the host, and an already-started game an error plus "If you were already playing, open your original link — you can rejoin." `/join/:code` forwards to `/game/:code`, so either link form works.
- **Name form (`/game/:code`, before the first `join`).** The room code and one "Your name" field (prefilled from the last name this browser used, max 24, "leave it empty to be called by your seat number") with **Join the room**. Shown only when the browser holds no `session_token` for the room; after the submit the lobby shows while the server answers, and a refused `join` (full room, game already started) brings the form back with the server's reason under the field (§4.2).
- **Player lobby.** Only the room code and host name, the participant list (name, role when seated, Bot badge, a connection dot with a text label), the player's own seat status, "*host* is setting up the game.", and, in `PLAYER_CHOOSES`, the four claimable role cards. It never renders a config value, even if one reached the client. A role card click emits `claim_role` and changes nothing locally; a taken card is disabled and names its holder; a refusal shows against the card until the next lobby update settles it (no optimistic claim). A player without a seat in `HOST_ASSIGNS` or `PLAYER_CHOOSES` is told the game cannot start while they have no seat.
- **Host lobby.** The large room code with Copy invite link (confirms "Copied") and a full-screen join QR (the player link only, never a secret); the participant list; the role-assignment mode selector; a per-participant seat control in both `HOST_ASSIGNS` and `PLAYER_CHOOSES` (the host can seat anyone who has not picked); the configuration panel; and Start, enabled only when the server's `can_start` is true and otherwise showing the server's `start_blocked_reason` verbatim. A host tab that lost its secret shows "Reconnecting as host…" while the claim is in flight and the recovery screen ("This tab isn't the host of that room." and a link home) only after the server refuses; it never falls through to joining as a player, which would take a seat.
- **Configuration panel.** Six collapsible sections in the manual's order — Presets; Length and pacing; Starting conditions; Costs (with `currency_symbol` at its top); Customer demand; Visibility (with `max_order_quantity` at its foot) — plus **Bot difficulty** (β, θ, α, target-stock multiplier), shown only when bot fill is on or a bot is seated. The role-assignment mode is set in the lobby, never in this panel (two controls writing one value would race). Selecting a preset replaces the whole config and sets `preset_name`; editing any field afterwards clears it and the cards show Custom. Preset cards print the server's label and description verbatim.
- **Per-role settings** are a four-column grid (Retailer..Factory). The Factory shows production delay and capacity instead of shipping delay; the Retailer's unused information delay is not rendered at all; Apply to all copies only the rows the Retailer column displays. The grid shows each role's lead time from the server.
- **Saving.** Inputs render from the stored config; a numeric blur and any switch toggle save at once, otherwise saves are debounced. Every patch is leaf-level. A value outside its range is not sent, and the server's or the form's message shows beside the field.
- **Customer demand.** Picking a generator sends only the new kind, and the server fills that kind's defaults. `CUSTOM` accepts a pasted comma/semicolon/whitespace/newline list or a dropped CSV, shows the parsed count against `duration_weeks`, and blocks saving while it is short. The demand chart and the lead times come from `POST /rooms/preview`, which runs the engine's own generator — with the host's `random_seed` when set (so the preview is exactly the game), else with example seed 0 — and the chart is labelled an example only when the kind reads the seed (`STOCHASTIC`).
- **Locked after start.** Once the room is `RUNNING`, `PAUSED` or `FINISHED` the panel becomes a read-only summary of the same six sections under the banner "Settings are locked while the game is running. To change them, end the game and create a new room." rather than disabled inputs.
- **Multi-game hosting.** `/multihost/new` takes a count (the server's 2..10, refused never clamped), a host name and a full base config edited with the lobby's own form over a server-validated draft, and creates every room at once. `/multihost` shows one card per game (status, inline join QR, Open host screen), polled every 5 s. "Start all ready games" starts each game whose summary says it can start, shows any refusal on that game's card, and reports one line, "Started X of Y games.". Each game's own host lobby still allows config edits until it starts. The implementation rules are in `Beery_Frontend/CLAUDE.md` ("Multi-game hosting").

---

## 10. Persistence model

All tables are managed by SQLAlchemy models (`app/models/`) with Alembic revisions on one linear chain from `0001_postgres_baseline`. The DDL of head is committed as `db/schema.postgres.sql`.

### 10.1 Tables

| Table | Purpose | Key fields |
|---|---|---|
| `users` | Registered accounts | `firebase_uid` (unique), `display_name`, `email`, `photo_url`. Guests are never stored |
| `games` | One finished game | `public_id` (uuid4 hex, unique), `room_code` (indexed, **not** unique: codes are recycled), `host_user_id` (nullable FK to `users`, ON DELETE SET NULL, index `ix_games_host_user_id`; set only for a signed-in host, D23), `rng_seed`, `duration_weeks`, `weeks_played`, `ended_early`, `started_at`, `finished_at`, `chain_total_cost`; UNIQUE(`room_code`, `started_at`). No host name |
| `game_configs` | Game-level config, 1 per game | Every game-level, visibility and bot field as its own column |
| `role_configs` | Per-role config, 4 per game | Every role field; `production_*` NULL except for the `FACTORY` row |
| `demand_configs` | The demand generator, 1 per game | `kind` plus the nullable union of every generator's parameters; `CUSTOM` keeps its values only in `demand_series` |
| `participants` | The game's seats (never the host) | `alias`, `role`, `display_name`, `participant_type` (always `PLAYER`; a string column for §16's spectators), `is_bot`, `user_id`, `guest_identity`, `bullwhip_ratio` |
| `demand_series` | Realised customer demand | `game_id`, `week`, `quantity` |
| `weeks` | One per role per week; the source of truth for results | Every week-record field (§8.6), the decision as `order_qty` |
| `user_stats` | Aggregated results, 1 per user | See §10.5 |

**Conventions.** Config is fully normalised, never a JSON blob (D5). Money is `NUMERIC(12,2)`; ratios `NUMERIC(10,4)`; bot weights `NUMERIC(6,4)`; non-integer demand parameters `NUMERIC(10,4)` (a float would corrupt 0.3); quantities are integers; timestamps are `timestamptz` in UTC. Reserved words are renamed (`order` → `order_qty`, `min`/`max` → `min_value`/`max_value`). Every child table cascades on delete from `games`; `participants.user_id` and `games.host_user_id` are `ON DELETE SET NULL`, so deleting an account keeps everyone's game records. `demand_series` and `weeks` carry no timestamps (bulk data).

**Tables that do not exist.** `sessions` (Firebase owns sessions; the per-room `session_token` is a reconnect credential in the live room state), `events` (there is no event replay; a reconnect resyncs from the live room state), `orders` (one order per game/week/role is `weeks.order_qty`) and `pipeline_slots` (mid-game pipelines are live state; `weeks.supply_line_after` is the only figure the results need).

### 10.2 When a game is written

PostgreSQL is written once, when the game finishes, never during play (D4). `finish_game` emits `game_finished` (the debrief) first, then persists outside the room lock: one transaction (`games`, the configs, then batched `role_configs`, `participants`, `demand_series` and `weeks`), so a failure leaves no half-written game. Then `user_stats` are recomputed for every registered participant; a stats failure does not undo the committed game.

Persistence is idempotent on (`room_code`, `started_at`): a lookup, plus the UNIQUE constraint as a backstop whose `IntegrityError` is rolled back and the winner's id returned. `started_at` is truncated to whole seconds, because `timestamptz` keeps microseconds and the key must be stable.

A failure is logged at ERROR naming the room code (never swallowed) and the room records `persisted: false`; clients already hold the `game_finished` debrief, but there is no results URL, so the end-of-game screens keep saying the results are being saved. On success the room broadcasts `game_persisted` with the `public_id`, the game's one results URL (D22). Money is rounded half-up to cents only at this insert, so the sum of a role's `total_week_cost` may differ from its final `cumulative_cost` by under a cent; that is expected.

### 10.3 Stored versus derived

Per-role statistics (total cost, peaks, weeks in backlog, order variance, shipped vs waiting, average order) are never stored. Every reader rebuilds them by loading the `weeks` rows back into week records and calling the same `compute_stats` the live game used, so a results screen cannot disagree with the debrief. Some derived values are stored on purpose (D5): `participants.bullwhip_ratio` (so `user_stats.bullwhip_avg` is one grouped query instead of a second, SQL implementation of the variance), `games.chain_total_cost` (cheap match-history listing), and the engine's own `weeks.total_week_cost` and `cumulative_cost`. `games.ended_early` is `weeks_played < duration_weeks` (a force-closed week is not early); `duration_weeks` is the configured length and `weeks_played` what was played.

### 10.4 Who a participant row belongs to

Attribution follows identity, not `is_bot`. A registered player → `user_id`; a guest player → `guest_identity` (server-only, never returned or logged). A seat the host swapped to a bot keeps the displaced player's identity (`is_bot` true, `weeks.was_bot` marks the bot's weeks), so the game still counts for them; only a seat that was a bot from the start has neither. A player's Firebase uid with no `users` row gets a bare one in the same transaction. The host has no participant row: who hosted is `games.host_user_id`, taken from `room["host_uid"]` (the verified uid of the connection whose `start_game` started the game) by lookup only — no `users` row means NULL, and none is created — and NULL for every guest host (D23). A claim never changes it.

### 10.5 `user_stats`

Rebuilt from scratch after every finished game the user played (never incremented), over participant rows with a role (hosted games are excluded):

- `games_played`; `weeks_played` (sum); `total_cost` (sum of each game's final `cumulative_cost`);
- `avg_cost_per_week` = `total_cost / weeks_played` (0 when none);
- `best_game_id` = the game with the lowest cost per week (sent to the profile as its `public_id`, `best_game_public_id`);
- `bullwhip_avg` = the mean of non-NULL `participants.bullwhip_ratio` (NULL when none, e.g. only `CONSTANT`-demand games);
- `games_as_<role>` counts.

A swapped-out player's games count, bot weeks included. Games of every length and setting are pooled: the best game is the lowest cost per week across all of them, and the averages mix them all. The profile says so beside the figures.

---

## 11. API surface

### 11.1 REST endpoints

All REST lives under `/api/v1`. `Beery_Backend/README.md` ("The HTTP surface") is the complete route table; the rules are:

- **Rooms.** Rooms are created with no auth (`POST /rooms/create`, and `POST /rooms/batch-create` for 2–10 rooms); authority is the `host_secret` returned exactly once (D3). `GET /rooms/{code}/status` is public, always HTTP 200, and never returns config, names or secrets. `GET|PUT /rooms/{code}/config` need `X-Host-Secret`. `/rooms/presets`, `/rooms/limits` and `POST /rooms/preview` are unauthenticated pure lookups. `POST /rooms/summary` takes per-room secrets in the body and answers a missing room and a wrong secret identically. Joining, seating, starting and play are socket events (§11.2), not REST.
- **Games.** `GET /games/id/{public_id}/results` and `GET /games/id/{public_id}/export?format=csv|json` are open, with no time limit, 404 for an unknown id (D22; exports 100 an hour per address). There is no results or export route by room code. `POST /games/claim` attributes a guest's played seats (§3.1).
- **Users.** `POST /users/upsert`, `GET /users/me`, `/users/me/stats`, `/users/me/games`, `/users/me/games/{public_id}`, `/users/me/hosted-games` (§9.9, D23). No route takes or returns an internal game id.

**Auth on Firebase routes.** A missing, non-Bearer or empty `Bearer ` header is always 401; only a presented token can produce 503 (Firebase unconfigured), so a caller without a token cannot learn the server's config. A token that fails, or verifies without a non-empty string uid, is 401. `POST /users/upsert` takes `firebase_uid` only from the verified token (never the body) and answers 200 on both create and refresh; each of `display_name`/`email`/`photo_url` falls back to the token's claim (`name`/`email`/`picture`, strings only) only when absent or null, never when `''` (an emptied name stays `''`). The service strips control characters and truncates to 24/200/500 for every caller, and the insert is race-safe. `GET /users/me` is 404 until the first upsert.

### 11.2 Socket events

Socket.IO at `/socket.io`. Identity is fixed at connect and never read from a payload.

**Client → server**, and the authority each needs:

- `host_secret`: `join_waiting` (or the D18 identity), `config_update`, `set_role_mode`, `assign_role`, `start_game`, `pause_game`, `resume_game`, `force_close_week`, `substitute_bot`, `end_game_early`.
- The server's socket map (who this connection is): `join`, `leave`, `claim_role`, `release_role`, `submit_order`, `reclaim_seat`, `request_state`.
- `submit_order`'s `week` is a guard: a mismatch is `STALE_WEEK`, answered with a fresh state.

**Server → client**, with recipients:

- To one socket: `joined` (the only event carrying a `session_token`), `host_claimed` (the only event carrying a `host_secret`; `/rooms/create` returns the first one), `leave_ack`.
- To the host's socket only: `config_updated`, `host_state`.
- To each player's socket: `your_state`, `your_week_closed`.
- Room broadcasts: `lobby_update` (`seq`, `state`, participants without identity, `role_to_alias`, `role_assignment_mode`, `seats_total` 4, `config_locked`, `can_start`, `start_blocked_reason`), `roles_assigned`, `game_started` (with `config_public`: duration, stage count, currency and visibility flags only — no costs, delays or demand), `order_submitted` (role, name, `is_bot`; never the quantity), `week_closed`, `game_paused`, `game_resumed`, `participant_disconnected`, `participant_reconnected`, `host_disconnected`, `host_reconnected`, `bot_substituted`, `seat_reclaimed`, `game_finished` and `game_persisted`.
- **End of game.** `game_finished` (`seq`, `weeks_played`, `stats`, the full `demand_series`, `orders_by_role` — the reveal) is sent before anything touches the database. `game_persisted` (`seq`, `game_id` = the `public_id`) follows only after a successful write and gives clients the permanent results URL. No `game_persisted` means the record was not saved; the debrief still stands.

Every game event carries a per-room increasing `seq`; clients drop any event whose `seq` is not above the last they applied. Play errors are `error {message, code}` with `code` in `GAME_PAUSED`, `GAME_FINISHED`, `GAME_NOT_RUNNING`, `NOT_IN_ROOM`, `NO_ROLE`, `STALE_WEEK`, `INVALID_ORDER`, `TOO_MANY_SUBMISSIONS`, `INVALID_HOST_SECRET`, `SERVER_ERROR`, `RATE_LIMITED`. Lobby refusals are `join_error {message}`; `start_game`'s also carry `room_code`, so a multi-game dashboard can put each refusal on its game's card.

### 11.3 Live room state

Each live room is one JSON document at `room:{CODE}` in the state store (in-process by default, Redis with `REDIS_ENABLED=true`; D4).

- **Keys.** Fixed by `schema_version` 2: `room_code`, `state`, `created_at`/`started_at`/`finished_at`, `host_secret`, `host_sid`, `host_identity`, `host_uid`, `host_display_name`, `participants` (per alias: `alias`, `identity`, `session_token`, `display_name`, `role`, `is_bot`, `connected`), `sid_to_alias`, `role_to_alias`, `seed`, `config`, `engine`, `bots`, `seq`, `paused_reason` and `persisted`. Adding a top-level key requires bumping `SCHEMA_VERSION`; a document with another version is deleted and reported as absent.
- **Secrets.** `host_secret`, `host_identity`, `host_uid`, `identity` and `session_token` never leave the server, except a token to its owner and a secret to its host. `host_identity` is written once, on the first secret-authorised claim (D18), and has no setter. `host_uid` is written by the `start_game` that starts the game, from the connection's verified uid only (D23).
- **Codes.** 6 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, minted with up to 10 collision retries, stored uppercase and looked up case-insensitively on every path. A malformed code is refused before any lock or read.
- **Lifetime and lock.** Every save refreshes a 24 h TTL, which is the only cleanup. The per-room lock is `lock:room:{CODE}` with a 10 s deadlock timeout. `seq` is a per-room counter, incremented for every emitted game event and saved under the same lock.
- **Engine payload.** `engine` holds the seed, `demand_series`, `week`, `phase`, `pending_orders`, `pending_by_bot`, `settlements`, `history` and each agent's state; bot flags live on the agents. The config is stored once, at `config`, not in the engine payload. `weeks_played` and the pass-3 pipeline samples are derived and re-derived exactly on load. `from_payload(to_payload())` is lossless at every phase. A payload saved under older field names (`week_cost`, no `pending_by_bot`, no `inventory_after_arrival`) still loads.
- **Size.** `history` is the only unbounded field: a 104-week game is about 224 KB against a tested 512 KB ceiling, so per-week view snapshots are never stored.

---

## 12. Non-functional requirements

- **Live state.** Live game state is authoritative in the state store (§11.3). The engine is rehydrated from the room document on every operation. PostgreSQL is written only once, when the game finishes (D4); there is no write-through.
- **Determinism.** Same config + same seed + same orders = same game, and a replay test enforces it. The only randomness is seeded, string-derived RNGs: demand uses `random.Random(f"{seed}:demand")` and the `RANDOM` role deal `random.Random(f"{seed}:roles")`, so demand and role dealing don't share a stream (D11). The engine is a pure function of (config, seed, orders), and replay reproduces the history field for field.
- **Concurrency.** Every read-modify-write of a room runs inside its per-room lock, which is never held across a database write; emits happen after the lock is released. Two players submitting at the same instant cannot corrupt the week.
- **Resilience.** A client that refreshes or reconnects re-emits `join` (or `join_waiting` for the host) and receives `game_started` plus a full `your_state` (or `host_state`). A client that suspects a dropped event emits `request_state`, whose reply carries a fresh `seq` above every one already sent. No game state lives in client memory alone.
- **Server authority.** The client renders; it never computes inventory, cost, eligibility, or any other figure a rule defines (§15, "The server owns every figure").
- **Accessibility.** Keyboard-operable decision input, colour choices that survive colour-blindness (colour is never the only signal), readable at projector distance.
- **Responsive.** Playable on a laptop and a phone; the host console targets a large screen.

### 12.1 Abuse limits and ceilings

- An order must be an integer (or an exactly integral float) within 0..the game's `max_order_quantity`; anything else is refused, never clamped or coerced ("Order must be a whole number from 0 to *ceiling*.").
- A role may submit at most 20 times per week (`MAX_RESUBMISSIONS_PER_ROLE_PER_WEEK`); over the cap the reply is `error {code: TOO_MANY_SUBMISSIONS}` and the last accepted value stands. The counter is process-local, keyed by (room code, week, role) and pruned at the week's close, and deliberately not in the room document: a socket is pinned to one worker, and a document field would add a store write per increment.
- A bot's own figure is the one place an order is capped to the ceiling (§8.5).
- The REST and socket rate limits (30 rooms per address per hour shared by `/create` and `/batch-create`, 100 exports per address per hour, the socket caps and the live-room ceiling) are in `Beery_Backend/README.md`, "Abuse limits" (D21).

---

## 13. Out of scope for v1

Chains other than four stages are not built (§16). Out of scope entirely: multi-product chains; branching networks; player-to-player side deals or contracts; in-game chat in any form; Server-Sent Events (D1); real-money anything; native mobile apps; AI-generated coaching commentary.

---

## 14. Vocabulary

Use these words in code, payloads, tests and UI copy, with no synonyms:

| Word | Meaning |
|---|---|
| room | The container, identified by `room_code` |
| game | The simulation; one per room |
| week | One turn, 1-indexed (there is no week 0). "Round" is not a synonym |
| role | `RETAILER`, `WHOLESALER`, `DISTRIBUTOR` or `FACTORY` |
| participant | The host, a player or a bot |
| player | A participant holding a role |
| alias | `P1`..`P4`, the public id in every broadcast |
| identity | The verified Firebase uid or the guest id; server-only |
| `session_token` | A player's per-room reconnect credential |
| `host_secret` | The host's authority over one room |
| order | A role's decision for the week |
| incoming order | What the downstream customer ordered |
| supply line | The sum of in-transit shipments |
| obligation | `incoming_order` + backlog carried in |
| settlement | Phase A |
| decision window | Phase B |

Never use a bare "token" as an identifier.

---

## 15. Decisions

Where this spec deliberately departs from `game_stack.md` or the Tequila Game, and why. The numbers are stable: code comments cite them (`D7`).

- **D1 — Socket.IO, not Server-Sent Events.** The hardened identity, host-authority and reconnect layer of `game_stack.md` exists on Socket.IO (`python-socketio` + `socket.io-client`). Reconnection is `join` with a `session_token`, answered by a full state resync; every broadcast carries a per-room `seq` so a client drops events it already applied.
- **D2 — Identity is Firebase Google sign-in or a client-minted `guest_<uuid4>`.** A socket handshake presenting anything else is rejected. There is no email/password path.
- **D3 — Hosting is a capability, not an account.** Creating a room needs no sign-in; `POST /rooms/create` returns a one-time `host_secret` (kept per room in `sessionStorage`, compared with `hmac.compare_digest`), and a guest hosts exactly as a signed-in user does. A client-side "I am the host" flag is a UI hint the server never trusts.
- **D4 — Live state in the state store; PostgreSQL at game end.** Live room state is one JSON document per room (`room:{code}`, 24 h TTL), changed only inside the per-room lock; PostgreSQL is written once, when the game finishes or is ended early. The store is in-process by default (single instance only; a restart loses live games) or Redis with `REDIS_ENABLED=true` (required before running more than one instance). Accepted risk: losing the store loses games in progress (write-through per week is in §16).
- **D5 — Normalised config, Beery's own numeric types, some derived values stored.** Config is stored in `game_configs`, `role_configs` and `demand_configs`, one column per parameter, never a JSON blob; every new knob ships an Alembic revision. While a game is live the room document carries the serialised `GameConfig`, and the end-of-game write stores the same values. Unlike `game_stack.md`'s "store facts, derive the rest" and `NUMERIC(20,2)`, Beery stores money as `NUMERIC(12,2)` (read back as `Decimal`, sent as a JSON number), ratios as `NUMERIC(10,4)`, bot weights as `NUMERIC(6,4)` and demand scalars as `NUMERIC(10,4)`, and it stores some derived values on purpose: `weeks.total_week_cost` and `cumulative_cost` (the engine's own record), `games.chain_total_cost` (listing) and `participants.bullwhip_ratio` (one grouped query for `bullwhip_avg`). Per-role statistics are still derived on read (§10.3).
- **D6 — v1 is untimed.** No `round_timer_seconds`, `timeout_policy`, countdown or auto-submit. A week closes when every role has ordered, or when the host force-closes it.
- **D7 — A disconnection pauses; the host decides.** With `pause_on_disconnect` (default true) a player dropping pauses the room and the host is told who; the host waits, resumes, or swaps in a bot — never automatically. The host's own disconnect never pauses (players get `host_disconnected`/`host_reconnected`). Resuming plays every bot seat that still owes the open week's order. A swapped seat keeps its player: the finished game counts in their history and stats; only bot-fill seats are anonymous, and per-week `was_bot` records the weeks a bot played.
- **D8 — `starting_capital` is a display transform.** When > 0, clients also get `balance = starting_capital − accumulated_cost`. Scoring, ranking and statistics are unchanged, and there is no bankruptcy.
- **D9 — Settlement runs in passes, so role order cannot change the result** (§7, Phase A). Tested by running the roles in reverse order.
- **D10 — Order cost is charged in the week the order is placed, when it closes.** `fixed_order_cost` (if the order is above 0) plus `unit_purchase_cost × order`. No screen shows a single "week cost": players see "Holding & backlog" and "Order cost" ("not yet charged" while open); the stored and exported sum is `total_week_cost`. Ending early rolls the abandoned week's cost out of every live total, so live figures equal results.
- **D11 — Determinism uses derived, named random streams.** `random_seed` is an integer, server-generated and persisted when the host leaves it empty, refused outside ±(2^53 − 1). `Random(f"{seed}:demand")` and `Random(f"{seed}:roles")` are separate streams, so changing one part of the game never shifts the other. Same config + seed + order history = an identical game (replay test).
- **D12 — Statistics definitions.** The bullwhip ratio uses the population variance and is null (not infinite) for constant demand; fill rate keeps the wire name `fill_rate` but every screen calls it "Shipped vs waiting", because the obligation counts each week's backlog again. Definitions in §8.9.
- **D13 — English only, no i18n layer.** Server messages are English inline; Selly's Spanish strings are not ported.
- **D14 — Scope boundary.** Everything in §1–§12 is v1. Spectators and late join, decision timers, `clone_room`, per-week write-through and chains other than four stages are §16. Chat and everything in §13 are out entirely.
- **D15 — The board is behind a view seam.** The game room reads from the store and renders a board component chosen through one seam (`BoardViewProps`), so a renderer can be added without reworking anything below the view layer. `Board2D` and `Board3D` (D20) are the two registered boards and show the same numbers.
- **D16 — Toolchain pinned to the combination `game_stack.md` verifies.** React `~19.2.0` (tilde, because `@react-three/fiber` pins React narrowly), Vite 7, TypeScript 5.9, Tailwind 4, Vitest 4; Python 3.11 with `game_stack.md`'s exact backend pins.
- **D17 — Deployment mirrors the Tequila Game.** Backend: a Docker container on Render (plain uvicorn, `--http h11 --proxy-headers`). Frontend: Firebase Hosting. Database: the shared Aiven PostgreSQL 17 service; Redis optional (D4). Firebase Hosting does not proxy WebSocket upgrades, so `VITE_SOCKET_URL` points straight at the backend. Details in both `DEPLOY.md` files.
- **D18 — A host may re-claim their room by verified identity.** `join_waiting` accepts a matching `host_secret`, or a connection whose handshake identity equals the room's `host_identity` (recorded on the first secret claim). Needed because the secret dies with the tab and a paused game (D7) can only be resumed by the host. For a guest the identity is as strong as a bearer token in `localStorage`; it is never broadcast.
- **D19 — Assembly is by auto-discovery.** Routers (`app/api/v1/`), socket handlers (`app/sockets/handlers/`), startup checks (`app/core/checks/`), models and frontend pages (`src/pages/`) register themselves by being dropped in; `app/main.py` and `App.tsx` name no individual router, handler or page. This departs from `game_stack.md` §2's single `sockets/handlers.py`, which for Beery would be one very large file.
- **D20 — The 2D/3D board is a per-browser preference, not room config.** `localStorage['board_view']` → `VITE_BOARD_VIEW` → `'2D'`, written by the in-game toggle. A renderer is not a game rule, a `GameConfig` field would be a coordinated wire change, and only the player knows whether their machine can draw 3D. The toggle is a sibling of the board, and both boards take the same props. Cost accepted: a host cannot standardise or see a player's view.
- **D21 — Abuse limits are in-process constants**, with no new dependency or setting: a fixed-window rate limiter keyed by client IP (`CF-Connecting-IP`, else the rightmost `X-Forwarded-For`) on REST, socket connect and every guarded event; at most 500 live rooms (503 past it), expired rooms swept from the write path; room codes validated before any lock; Firebase verification off the event loop, tokens over 4096 characters refused; 64 KB socket messages; room creation 30 per address per hour (shared with batch create); exports 100 per address per hour. The numbers are in §12.1 and `Beery_Backend/README.md`, "Abuse limits".
- **D22 — Results and export are by `public_id` only, open, and never expire.** A finished game is addressed by its `public_id` (a uuid4 hex) and by nothing else, the same way in every Novus game: the results page is `/results/:publicId`, served by `GET /games/id/{public_id}/results`, and anyone who can open it may download its CSV/JSON through `GET /games/id/{public_id}/export` (no credential; the uuid4 is the capability). There is no results or export route by room code: a 6-character code is enumerable and reissued, so it names no particular game. Nothing about showing a finished game depends on the room code, the live room or browser storage; the live screens link to it once `game_persisted` delivers the id, and the profile names games by `public_id` too (never an internal id). The export carries only what the results screen shows — players are `P<N>` by seat, never a uid, email, guest id, token, secret or chosen name. Guards: the hourly per-address budget (real), once per game and format per browser session (UX), and an in-process cache of finished exports.
- **D23 — A finished game records its host only if the host was signed in, and only to list it.** `start_game`, after the secret check and `can_start`, stores the starting connection's verified Firebase uid as the room's server-only `host_uid` (taken from the handshake's token verification, never inferred from an identity's shape; the dashboard's "Start all" is covered, a guest host never is). Persistence resolves it to `games.host_user_id` by lookup only (no `users` row → NULL, none created); the host has no `participants` row. The record's one use is the signed-in user's "Games you hosted" list (`GET /users/me/hosted-games`). It grants no export, claim, results access or authority, and the match history, statistics and `/users/me/games/{public_id}` stay played-only. D18's live recovery by `host_identity` is unchanged and never reads it.

**The server owns every figure.** Ranges (`/rooms/limits`), the demand preview and lead times (`POST /rooms/preview`), preset descriptions, a demand kind's defaults, `order_arrival_week`, `inventory_after_arrival`, slot week offsets and `weeks_played` all come from the server. The client formats, lays out, sorts and filters, and repeats only the form checks it builds from `/rooms/limits`.

---

## 16. Not built yet

- **Decision timers and timeout policies** (`round_timer_seconds`, `timeout_policy`, a server-held deadline, host "extend timer"). The seam: `close_week(force=True)` and `WeekRecord.was_forced` already model a forced close (D6).
- **Spectators and late join** (`allow_late_join_as_spectator`, a `SPECTATOR` participant type and its redaction branch). The seam: `participants.participant_type` is a string column.
- **`clone_room`** ("run this again"): `POST /rooms/{code}/clone` copying the stored config into a fresh room, plus a results-screen control. Today Play again says to create a new room.
- **Write-through-per-week persistence**: upsert on (game, week, role) at each close, so a game survives a store loss mid-game and the host can export live. The seam: `weeks` has the unique constraint and `persist_game` is idempotent (D4).
- **Supply chains other than four stages** (a positional chain model instead of the `Role` enum). The seam: `stage_count` exists in `GameConfig` and `game_configs`.
- **Global leaderboards and cohort analytics across users.** Needs an opt-in product decision first; today the only leaderboard is the in-game per-room view.
- **A floating manual link on every in-game screen** (player game screen and host console). Today the manual links exist only on the welcome and home pages and in the two lobbies.
- **Preloading the 3D board from the lobby** (the 3D chunk and the four models), so a player switching to 3D mid-game does not wait on classroom wi-fi. Low priority; today the models preload only once the lazy 3D chunk loads.
- **One chart registration with global defaults.** `game_stack.md`'s Charts standard has one `registerCharts()` setting the defaults once, including animation off under `prefers-reduced-motion`. Beery registers per chart module, sets options per chart, and animates without checking reduced motion.
- **Chart hit areas of at least 24 px** (point `hitRadius` ≥ 12), as `game_stack.md`'s Charts standard asks. Beery's charts use Chart.js's default hit radius.
