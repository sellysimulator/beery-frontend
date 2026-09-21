# The Beer Game — Multiplayer Web Application
## Functional & Domain Specification (Document 1 of 2)

**Status:** Draft for implementation
**Audience:** The implementing agent / engineering team
**Companion document:** `beer-game-engineering.md` (Document 2) — deeper software architecture, module layout, testing strategy.
**Architectural precedent:** the **Tequila Game** (see §1.3).

---

## 0. Purpose of this document

This document defines **what the game is, what its rules are, what every parameter does, what every role is responsible for, and what a player sees at every moment**. It is deliberately exhaustive about game semantics and deliberately open about implementation detail, which belongs in Document 2.

Where this document says **MUST**, the behaviour is a hard requirement. **SHOULD** is a strong default that may be revisited. **MAY** is optional scope.

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

### 1.3 Relationship to the Tequila Game

The **Tequila Game** is an existing multiplayer game in this codebase/organisation. It is cited here **as a software precedent only**. Its gameplay is *not* relevant and MUST NOT be copied.

What the implementing agent SHOULD take from it:

- Room/lobby lifecycle and invite-link mechanics.
- Session and participant modelling, reconnection handling.
- The real-time event/broadcast pattern.
- Round orchestration: how a turn is opened, collected, closed and persisted.
- Project layout, naming conventions, and error/response envelope conventions.

**Integration hook.** Wherever this document says *"follow the Tequila Game pattern"*, the implementing agent MUST read the Tequila Game source (and Document 2) and adopt its established pattern rather than inventing a new one. If a Tequila Game pattern conflicts with an explicit rule in this document, **this document wins on game semantics; the Tequila Game wins on plumbing.**

---

## 2. Technology stack (fixed)

| Layer | Technology | Notes |
|---|---|---|
| Backend framework | **Python + FastAPI** | Async endpoints |
| Real-time transport | **Server-Sent Events (SSE)** | One stream per room; no WebSockets |
| ORM | **SQLAlchemy** | Declarative models |
| Migrations | **Alembic** | Every schema change ships a migration |
| Database | **MySQL (cloud-hosted)** | Credentials from environment file only |
| Frontend | **React + Vite + TypeScript** | |
| Styling | **Tailwind CSS** | |

**Hard constraints:**

1. **The database is reachable only through the backend.** The frontend MUST NOT hold DB credentials or construct SQL. Every read and every mutation goes through a FastAPI endpoint.
2. **Every table the game uses MUST be fully manageable from the backend** — created, migrated, read, written and deleted via SQLAlchemy models and Alembic revisions. No manual, out-of-band DDL.
3. **Connection credentials live in a `.env` file** (host, port, database, user, password, pool settings), loaded via a settings object. No credential ever appears in source, in the client bundle, or in a log line.
4. SSE is the only push channel. Client actions travel over ordinary HTTP requests; state changes travel back over SSE.

---

## 3. Users and accounts

### 3.1 Account modes

Login is **optional**. Both modes MUST be supported end to end.

| Mode | How they identify | Stats tracked | Notes |
|---|---|---|---|
| **Registered user** | Email + password (or whatever auth the Tequila Game already uses — follow that pattern) | Yes, permanently | Can review past games |
| **Guest** | Display name only, backed by a session token | No permanent stats | Results exist for the duration of the game and its results screen |

A guest MAY be offered account creation at the end of a game, which claims that game's result into the new account. This is optional scope.

### 3.2 User types within a game

There are exactly two participant types.

#### HOST
- Creates the room and owns it.
- Configures every game parameter.
- Assigns or delegates roles.
- Starts, pauses, resumes, and ends the game.
- **Does not play.** The host holds no inventory, places no orders, and incurs no cost.
- Sees a **god view**: the full chain, every player's inventory, backlog, orders, costs, and the true demand curve — at all times, regardless of the visibility settings imposed on players.
- Is the only user with access to the room before the game starts and before players have joined.
- MUST be a registered user (a host account is needed to own the room and its history). Guests MAY host only if the deployment enables it — treat as a config flag, default off.

#### PLAYER
- Joins a room via the invite link.
- Occupies exactly one of the four chain roles.
- Makes one decision per week: the order quantity.
- Sees only what the host's visibility settings permit.
- MAY be a registered user or a guest.

**One role per player. One player per role.** A user cannot hold two roles in the same game, and a role cannot be shared.

---

## 4. Room lifecycle

```
CREATED ──► LOBBY ──► CONFIGURING ──► READY ──► RUNNING ──► FINISHED
                │                        │         │  ▲          │
                │                        │         ▼  │          ▼
                └──────── ABANDONED ◄────┴──────PAUSED       ARCHIVED
```

| State | Who is present | What happens |
|---|---|---|
| `CREATED` | Host only | Room record exists, invite code generated |
| `LOBBY` | Host + joining players | Players arrive, claim seats, set display names |
| `CONFIGURING` | Host + waiting players | Host sets parameters; players see a waiting screen with a live participant list |
| `READY` | All | Config locked, roles assigned, everyone confirmed |
| `RUNNING` | All | Weeks execute |
| `PAUSED` | All | Host-initiated; timers halt |
| `FINISHED` | All | Results screen, charts, exports |
| `ARCHIVED` | — | Retained for stats; no longer joinable |
| `ABANDONED` | — | Host left or room expired before start |

### 4.1 Creation and invitation

1. Host creates a room. Server generates:
   - a **room code** (6 characters, unambiguous alphabet — no `0/O`, `1/I/L`), and
   - an **invite URL** containing that code.
2. Host shares the link out of band.
3. Players open the link, enter a display name, and log in or continue as guest.
4. Players land in the lobby and **wait**. They MUST NOT see game parameters while the host is still configuring — only: room name, host name, participant list, their own seat/role status, and a clear "waiting for the host" state.

### 4.2 Joining rules

- Joining is permitted while the room is in `LOBBY` or `CONFIGURING`.
- Joining is closed once the game reaches `RUNNING`, unless the room was created with `allow_late_join_as_spectator = true`, in which case latecomers become **spectators** with host-level or restricted visibility (host chooses).
- The room holds at most 4 players plus the host plus N spectators.
- Reconnection is always permitted for a participant who already holds a seat, at any state, using their session token. Follow the Tequila Game reconnection pattern.

### 4.3 Filling empty seats

If fewer than four humans are present when the host starts, the host MUST choose one of:

- **Wait** — cannot start.
- **Fill with bots** — empty roles are played by the heuristic agent in §8.5. Bots are clearly labelled as such to all participants.

The game MUST NOT silently start with an empty link in the chain.

---

## 5. Role assignment

The host picks one of three modes at configuration time:

| Mode | Behaviour |
|---|---|
| `HOST_ASSIGNS` | Host drags/selects each player into a specific role. Cannot start until all four roles are filled (by a human or a bot). |
| `PLAYER_CHOOSES` | Players claim a free role from the lobby, first come first served. Claims are atomic — two players cannot take the same role. Host may override any claim before start. |
| `RANDOM` | Roles are shuffled and dealt at the moment the game starts. Players learn their role on the first game screen. Server MUST persist the RNG seed. |

The four roles are fixed in identity and order:

| Index | Role | Downstream neighbour | Upstream neighbour |
|---|---|---|---|
| 0 | **Retailer** | End customer (demand generator) | Wholesaler |
| 1 | **Wholesaler** | Retailer | Distributor |
| 2 | **Distributor** | Wholesaler | Factory |
| 3 | **Factory** | Distributor | Production line (no supplier) |

---

## 6. Game parameters

All parameters below are set by the host during `CONFIGURING`, validated server-side, and **frozen at start**. They are persisted as a single versioned configuration record attached to the game.

The UI SHOULD offer presets — **"Classic MIT"**, **"Fast Game"**, **"Chaos"** — which populate the whole form, plus a fully manual mode.

### 6.1 Game-level

| Parameter | Type | Default | Range | Meaning |
|---|---|---|---|---|
| `duration_weeks` | int | 36 | 8–104 | Number of weeks played |
| `stage_count` | int | 4 | 4 (fixed for v1) | Reserved for future 2–6 stage chains |
| `round_timer_seconds` | int \| null | 60 | 15–600, or null = untimed | Time allowed per decision |
| `timeout_policy` | enum | `REPEAT_LAST` | `REPEAT_LAST` \| `ORDER_ZERO` \| `MATCH_DEMAND` | Auto-submit when the timer expires |
| `pause_on_disconnect` | bool | true | — | Auto-pause if a player drops mid-week |
| `allow_chat` | bool | false | — | In-game chat; default off preserves the lesson |
| `bot_fill_empty_roles` | bool | false | — | See §8.5 |
| `random_seed` | int \| null | null | — | Set for reproducible demand and role dealing |

### 6.2 Per-role starting conditions

Configured **per role** (Retailer / Wholesaler / Distributor / Factory), with a "apply to all" convenience control.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `initial_inventory` | int | 12 | Units on hand at week 1 |
| `initial_backlog` | int | 0 | Unfulfilled units carried in |
| `shipping_delay_weeks` | int | 2 | Weeks a shipment spends in transit from the upstream neighbour |
| `information_delay_weeks` | int | 2 | Weeks an order takes to reach the upstream neighbour |
| `initial_pipeline_quantity` | int | 4 | Units pre-loaded into **each** in-transit slot |
| `initial_order_in_pipeline` | int | 4 | Order quantity pre-loaded into **each** information slot |

The Factory has no upstream supplier; its `shipping_delay_weeks` is replaced by:

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `production_delay_weeks` | int | 2 | Weeks between a production order and finished goods arriving |
| `production_capacity_per_week` | int \| null | null (unlimited) | Max units the factory can start per week |

### 6.3 Costs

Per role, overridable individually.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `holding_cost_per_unit_week` | decimal | 0.50 | Charged on end-of-week on-hand inventory |
| `backlog_cost_per_unit_week` | decimal | 1.00 | Charged on end-of-week backlog |
| `fixed_order_cost` | decimal | 0.00 | Charged once per non-zero order placed |
| `unit_purchase_cost` | decimal | 0.00 | Optional cost of goods; 0 keeps the classic scoring |
| `starting_capital` | decimal | 0.00 | Optional; when > 0 the UI shows a running balance rather than accumulated cost |

Currency symbol is a display setting (`currency_symbol`, default `$`).

### 6.4 Demand pattern (end-customer demand seen by the Retailer)

Host picks exactly one generator:

| Generator | Parameters | Description |
|---|---|---|
| `CONSTANT` | `value` (default 4) | Flat forever |
| `STEP` | `initial_value` (4), `step_week` (5), `step_value` (8) | The classic one-time jump |
| `RAMP` | `initial_value`, `slope_per_week`, `start_week`, `cap` | Gradual increase |
| `SEASONAL` | `base`, `amplitude`, `period_weeks`, `phase` | Sinusoidal, rounded to integers, floored at 0 |
| `STOCHASTIC` | `distribution` (`NORMAL` \| `POISSON` \| `UNIFORM`), `mean`, `stdev`/`min`/`max`, `seed` | Random draws |
| `CUSTOM` | `values: int[]` of length ≥ `duration_weeks` | Host-supplied sequence, paste or CSV upload |

The full demand series MUST be generated **at game start** and persisted, so the game is reproducible and the results screen can chart true demand against every player's orders.

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
| `max_order_quantity` | int \| null | null | Caps a single order |
| `allow_negative_orders` | bool | false | Returns/cancellations; keep false unless teaching that specifically |

### 6.6 Validation rules (server-side, before `READY`)

- All integers ≥ 0; costs ≥ 0.
- `duration_weeks` within range.
- `CUSTOM` demand array length ≥ `duration_weeks`.
- Delay weeks ≥ 1 (a zero delay collapses the pipeline and removes the phenomenon; if a host genuinely wants it, require an explicit confirmation).
- All four roles filled.
- `step_week` < `duration_weeks`.
- Config is immutable once `RUNNING`. Editing requires ending the game and creating a new room — or `clone_room`, which copies the config into a fresh room (SHOULD be offered; hosts run the same setup repeatedly with different cohorts).

---

## 7. The week: authoritative sequence

A week has three phases. **The server is authoritative.** The client never computes state; it renders what the server sends.

### Phase A — Settlement (server, automatic)

Executed for all four roles, in one atomic transaction:

1. **Receive.** Pop the oldest slot of the incoming-shipment pipeline. `inventory += arriving`.
   *Factory:* pop the production pipeline instead.
2. **Read demand.** Pop the oldest slot of the incoming-order pipeline → `incoming_order`.
   *Retailer:* `incoming_order` = the demand series value for this week.
3. **Compute obligation.** `obligation = incoming_order + backlog_carried_in`.
4. **Ship.** `shipped = min(inventory, obligation)`; `inventory -= shipped`; `backlog = obligation - shipped`.
5. **Deliver.** Push `shipped` into the downstream neighbour's shipment pipeline.
   *Retailer:* units leave the system to the customer.
6. **Charge.** `week_cost = holding_cost × inventory + backlog_cost × backlog` (+ `fixed_order_cost` and `unit_purchase_cost × order` from the previous week's decision, if configured). Accumulate.

Phase A produces the **settlement recap** (§9.3) and opens the decision window.

### Phase B — Decision (players)

- Every player sees their post-settlement state and submits **one integer: the order quantity**.
- Decisions are **simultaneous and hidden**. No player sees another's order before the week closes.
- Submissions are idempotent by `(game_id, week, role)`; a resubmission before the window closes replaces the previous value and is logged.
- A player MAY change their order until the window closes or they confirm-lock it.
- If the timer expires, the server applies `timeout_policy` and marks the decision as auto-submitted (visible in that player's history and to the host).
- The window closes when all four orders are in, or the timer expires — whichever is first.

### Phase C — Propagation and close (server, automatic)

7. Push each order into the upstream neighbour's **order pipeline**.
   *Factory:* push into the **production pipeline** (subject to `production_capacity_per_week`; excess is queued, not lost, and the queue is visible to the Factory player).
8. Persist the full week snapshot for every role.
9. Increment the week counter. If `week > duration_weeks` → `FINISHED`; else → Phase A.

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
- Replaying the persisted order history against the persisted config MUST reproduce the game exactly.

---

## 8. Domain objects and responsibilities

Each object below MUST be a first-class, independently testable unit. Naming follows the Tequila Game conventions where they exist.

### 8.1 `GameConfig`
Immutable value object holding every parameter from §6. Responsibilities: validate itself; serialise to/from the DB; expose typed accessors per role. Knows nothing about players or state.

### 8.2 `DemandGenerator`
Given a `GameConfig`, produces the full `list[int]` of weekly customer demand at game start. One subclass per generator type. Deterministic given a seed. Never called again during play.

### 8.3 `Pipeline`
A fixed-length FIFO of integers representing goods in transit or orders in flight.
Responsibilities: `advance()` (pop the front, return it), `push(qty)` (add at the back), `total()` (sum of contents — this is the *supply line*), `slots()` (for display). Length = the configured delay. Pre-loaded at initialisation.

### 8.4 `RoleAgent` (abstract) and its four subclasses

Common state: `inventory`, `backlog`, `incoming_shipments: Pipeline`, `incoming_orders: Pipeline`, `accumulated_cost`, `last_order`, `cost_params`.

Common responsibilities: `settle(week)` → executes Phase A steps 1–6 and returns a `WeekSettlement`; `apply_order(qty)` → Phase C step 7; `visible_state(visibility_config)` → the redacted view sent to that player.

| Subclass | What is specific to it |
|---|---|
| `RetailerAgent` | Its demand source is the `DemandGenerator`, not an order pipeline. Its shipments leave the system. |
| `WholesalerAgent` | Pure intermediary. No special behaviour beyond the base. |
| `DistributorAgent` | Pure intermediary. No special behaviour beyond the base. |
| `FactoryAgent` | No upstream supplier. Owns a `ProductionPipeline` and an optional capacity constraint and production backlog queue. Its "order" is a production order. |

Intermediaries are behaviourally identical; they differ only in position, neighbours and cost parameters. Do not duplicate logic — subclass for clarity and hold the difference in configuration.

### 8.5 `BotAgent`
Fills an empty role. Implements Sterman's anchor-and-adjust rule:

```
expected_demand_t = θ · observed_demand_(t-1) + (1 − θ) · expected_demand_(t-1)
order_t = max(0, expected_demand_t + α · (S* − inventory_t + backlog_t − β · supply_line_t))
```

Defaults: `θ = 0.25`, `α = 0.30`, `β = 0.25`, `S* = initial_inventory × 3`.
`β` SHOULD be exposed to the host as a difficulty knob — it is the supply-line weighting, and setting it to 1.0 visibly damps the oscillation. Bots MUST be labelled in the UI.

### 8.6 `GameEngine`
The orchestrator. Owns the four agents, the demand series, the week counter and the phase state machine. Responsibilities: run Phase A for all roles; open and close the decision window; run Phase C; emit events; persist snapshots; enforce the invariants in §7.2. **This is the only object permitted to mutate game state.**

### 8.7 `RoomService`
Room lifecycle, invite codes, join/leave, seat claiming, role assignment modes, reconnection, host powers (pause, resume, kick, extend timer, end early).

### 8.8 `EventBus` / `SSEBroadcaster`
Per-room fan-out of events to subscribed clients, with per-participant redaction applied **server-side** before send. A player's stream MUST NOT contain data that player is not entitled to see — redaction in the client is not acceptable.

### 8.9 `StatsService`
Post-game computation: total and per-role cost, bullwhip ratio, peak backlog, order variance, fill rate. Writes to user stats for registered players.

---

## 9. Player experience per round

This is a hard requirement, not polish. The teaching value collapses if players are confused about mechanics rather than about demand.

### 9.1 Decision panel — "what you have"

Always visible, always in the same place:

- **Role banner**: role name, position in the chain, who you buy from, who you sell to.
- **Week X of Y**, with the timer if enabled.
- **On hand** — current inventory.
- **Backlog** — units you owe, if any, in an alarming colour.
- **Incoming shipments** — the supply line, shown **slot by slot** ("4 units arriving next week, 6 the week after"), with the total. This must be prominent; underweighting it is the single most common losing mistake.
- **Orders you've placed** that haven't reached your supplier yet.
- **This week's incoming order** — the quantity demanded of you.
- **Your costs**: this week, and accumulated.

### 9.2 The decision itself — "what you can do"

- A single numeric input: **how many units to order from your supplier**.
- Live preview: "Ordering N units. It will reach you in `shipping_delay` weeks, around week X."
- Quick-fill buttons: *match incoming order*, *repeat last order*, *order zero*.
- Explicit statement of the only constraints that apply: minimum 0, maximum `max_order_quantity` if set.
- A confirm action, then a locked state showing *"Order submitted — waiting for the other players"* with a live tick-list of who has and hasn't submitted (names only, never quantities).

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
  Week cost                         $4.00
  Total so far                     $21.50
```

Plus a running chart of the player's own inventory, backlog and orders across weeks so far.

### 9.4 Waiting states
Every wait MUST say what is being waited for and who is holding it up: *"Waiting for the Distributor to submit"*, *"Host has paused the game"*.

### 9.5 End of game
- Final cost per role and chain total.
- The big reveal: **true customer demand plotted against all four order streams** on one chart. This is the moment the lesson lands.
- Bullwhip ratio per role: `Var(orders) / Var(customer demand)`.
- Peak inventory, peak backlog, weeks in backlog, fill rate.
- Host-only: CSV/JSON export of the full week-by-week record.

### 9.6 Host console
- All four roles side by side, live: inventory, backlog, last order, accumulated cost, submission status.
- The demand curve with the current week marked.
- Controls: pause, resume, extend the current timer, force-close the decision window, substitute a bot for a disconnected player, end the game early.
- A projector/presentation mode showing the live chain diagram, suitable for a classroom screen.

---

## 10. Persistence model (outline)

Field lists are indicative; Document 2 owns the final schema. All tables managed by SQLAlchemy models with Alembic revisions.

| Table | Purpose | Key fields |
|---|---|---|
| `users` | Registered accounts | id, email, password_hash, display_name, created_at |
| `sessions` | Guest and registered session tokens | id, user_id (nullable), token, expires_at |
| `games` | One room / one game | id, room_code, host_user_id, state, created_at, started_at, finished_at, rng_seed |
| `game_configs` | Frozen parameter set | id, game_id, JSON payload + typed columns for queried fields |
| `role_configs` | Per-role parameters | id, game_id, role, initial_inventory, delays, costs… |
| `participants` | Who is in the room | id, game_id, user_id (nullable), session_id, display_name, participant_type (HOST/PLAYER/SPECTATOR), role (nullable), is_bot, connection_state |
| `demand_series` | Generated customer demand | id, game_id, week, quantity |
| `weeks` | Per-week, per-role snapshot | id, game_id, week, role, opening_inventory, opening_backlog, arrived, incoming_order, shipped, closing_inventory, closing_backlog, week_cost, cumulative_cost |
| `orders` | Decisions | id, game_id, week, role, quantity, submitted_at, was_auto_submitted, submitted_by_participant_id |
| `pipeline_slots` | In-flight goods and orders | id, game_id, week, role, pipeline_type, slot_index, quantity |
| `events` | Append-only event log for SSE replay and audit | id, game_id, seq, type, payload, created_at |
| `user_stats` | Aggregated results | user_id, games_played, roles_played, avg_cost_per_week, best_game_id, bullwhip_avg |

`weeks` is the source of truth for the results screen. `events` enables SSE reconnection via `Last-Event-ID`.

---

## 11. API surface (outline)

Final shapes belong to Document 2; follow the Tequila Game's response envelope and error conventions.

**Auth**
- `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
- `POST /auth/guest` → issues a guest session

**Rooms**
- `POST /rooms` (host) → room + invite code
- `GET /rooms/{code}` → public lobby view
- `POST /rooms/{code}/join` → claim a seat
- `POST /rooms/{code}/leave`
- `PUT /rooms/{code}/config` (host) → set/update parameters while `CONFIGURING`
- `POST /rooms/{code}/roles` (host) → assignment mode and manual assignments
- `POST /rooms/{code}/claim-role` (player, `PLAYER_CHOOSES` mode)
- `POST /rooms/{code}/start` (host)
- `POST /rooms/{code}/pause` · `/resume` · `/end` (host)

**Play**
- `GET /games/{id}/state` → the caller's redacted view (used on load and reconnect)
- `POST /games/{id}/orders` → `{ week, quantity }`, idempotent
- `GET /games/{id}/stream` → **SSE**
- `GET /games/{id}/results` → final report
- `GET /games/{id}/export?format=csv|json` (host)

**SSE event types** (minimum set):
`participant_joined`, `participant_left`, `config_updated`, `roles_assigned`, `game_started`, `week_settled`, `decision_window_opened`, `order_submitted` (identity only, never quantity), `decision_window_closed`, `week_closed`, `game_paused`, `game_resumed`, `game_finished`, `error`.

Every event carries `game_id`, `seq`, `week`, and a server timestamp. Payloads are redacted per recipient.

---

## 12. Non-functional requirements

- **Optimisation.** A week must settle and broadcast in well under 200 ms. Game state for an active game SHOULD be held in memory by the `GameEngine` and written through to MySQL; do not recompute from the database on every request.
- **Determinism.** Same config + same seed + same orders = same game. A replay test MUST enforce this.
- **Concurrency.** Order submission and window closing must be race-free. Use a per-game lock or a serialised command queue; two players submitting at the same instant must not corrupt the week.
- **Resilience.** A player refreshing the page or losing connection rejoins with full state via `GET /games/{id}/state` + SSE `Last-Event-ID` replay. No game state lives in client memory alone.
- **Server authority.** The client renders; it never computes inventory, cost or eligibility.
- **Accessibility.** Keyboard-operable decision input, colour choices that survive colour-blindness, readable at projector distance.
- **Responsive.** Playable on a laptop and a phone; the host console targets a large screen.

---

## 13. Out of scope for v1

Chains other than four stages; multi-product chains; branching networks; player-to-player side deals or contracts; real-money anything; native mobile apps; AI-generated coaching commentary.

---

## 14. Open items for the implementing agent

Deliberately unresolved — resolve against the Tequila Game and Document 2:

1. **Auth mechanism.** Adopt whatever the Tequila Game uses (JWT, session cookie, etc.) rather than introducing a second scheme.
2. **Timer authority.** Server-held deadline with client-side countdown display is assumed; confirm against the existing pattern.
3. **Config storage shape.** JSON column vs fully normalised columns — Document 2 decides; querying needs and migration ergonomics govern.
4. **Bot substitution policy.** Whether a disconnected player is auto-replaced by a bot after N weeks, or the game simply pauses.
5. **Spectator visibility default.**
6. **Whether `starting_capital` mode changes scoring semantics** or is purely a display transform.
7. **Localisation.** English only for v1 unless the Tequila Game already has an i18n layer to reuse.
