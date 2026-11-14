/**
 * TypeScript mirrors of the Beery wire contract.
 *
 * Enums mirror `03-game-config.md §2`, config models the same chapter, the
 * engine views `07-game-engine.md §2/§3.8/§3.9`, socket payloads
 * `11-socket-lobby.md §2` and `12-socket-play.md §2`, and REST bodies
 * `10-rooms-rest-api.md §2`.
 *
 * Money and quantities are both `number`; quantities are integral. A field the
 * backend types as `X | None` is `X | null` here, never `undefined`, because it
 * arrives as JSON `null`. `?` marks a key that is conditionally *absent* from
 * the payload, which is a different thing.
 *
 * Nothing here ever carries `identity`. Only `JoinedPayload` carries a
 * `session_token` and only `HostClaimedPayload` a `host_secret`
 * (`00-conventions.md` section 2).
 */

/* ─── Enumerations (03 section 2, app/core/enums.py) ─── */

export type Role = 'RETAILER' | 'WHOLESALER' | 'DISTRIBUTOR' | 'FACTORY'

export const ROLE_ORDER: readonly Role[] = [
  'RETAILER',
  'WHOLESALER',
  'DISTRIBUTOR',
  'FACTORY',
] as const

export type RoleAssignmentMode = 'HOST_ASSIGNS' | 'PLAYER_CHOOSES' | 'RANDOM'

export type RoomState =
  | 'LOBBY'
  | 'CONFIGURING'
  | 'READY'
  | 'RUNNING'
  | 'PAUSED'
  | 'FINISHED'
  | 'ABANDONED'

export type DemandKind = 'CONSTANT' | 'STEP' | 'RAMP' | 'SEASONAL' | 'STOCHASTIC' | 'CUSTOM'

export type Distribution = 'NORMAL' | 'POISSON' | 'UNIFORM'

/** `GamePhase` in `app/core/game_engine.py`. */
export type GamePhase = 'AWAITING_START' | 'DECISION' | 'FINISHED'

/* ─── Configuration (03 section 2, app/core/config_models.py) ─── */

export interface RoleConfig {
  initial_inventory: number
  initial_backlog: number
  shipping_delay_weeks: number
  information_delay_weeks: number
  initial_pipeline_quantity: number
  initial_order_in_pipeline: number
  holding_cost_per_unit_week: number
  backlog_cost_per_unit_week: number
  fixed_order_cost: number
  unit_purchase_cost: number
  starting_capital: number
}

export interface FactoryConfig extends RoleConfig {
  production_delay_weeks: number
  production_capacity_per_week: number | null
}

/** Sterman anchor-and-adjust parameters. */
export interface BotConfig {
  theta: number
  alpha: number
  beta: number
  target_stock_multiplier: number
}

export interface VisibilityConfig {
  show_true_customer_demand_to_all: boolean
  show_neighbour_inventory: boolean
  show_all_inventories: boolean
  show_supply_line_prominently: boolean
  show_running_cost_to_players: boolean
  show_leaderboard_during_game: boolean
  /** `null` (or `0` as typed) means "no per-game cap"; the global ceiling still applies. */
  max_order_quantity: number | null
}

export interface ConstantDemand {
  kind: 'CONSTANT'
  value: number
}

export interface StepDemand {
  kind: 'STEP'
  initial_value: number
  step_week: number
  step_value: number
}

export interface RampDemand {
  kind: 'RAMP'
  initial_value: number
  slope_per_week: number
  start_week: number
  cap: number | null
}

export interface SeasonalDemand {
  kind: 'SEASONAL'
  base: number
  amplitude: number
  period_weeks: number
  phase: number
}

export interface StochasticDemand {
  kind: 'STOCHASTIC'
  distribution: Distribution
  mean: number
  stdev: number
  min: number
  max: number
}

export interface CustomDemand {
  kind: 'CUSTOM'
  values: number[]
}

/** Discriminated on `kind`. */
export type DemandConfig =
  | ConstantDemand
  | StepDemand
  | RampDemand
  | SeasonalDemand
  | StochasticDemand
  | CustomDemand

/** `FACTORY`'s entry is a `FactoryConfig`; the other three are plain. */
export interface GameConfigRoles {
  RETAILER: RoleConfig
  WHOLESALER: RoleConfig
  DISTRIBUTOR: RoleConfig
  FACTORY: FactoryConfig
}

export interface GameConfig {
  duration_weeks: number
  stage_count: 4
  pause_on_disconnect: boolean
  bot_fill_empty_roles: boolean
  random_seed: number | null
  currency_symbol: string
  role_assignment_mode: RoleAssignmentMode
  preset_name: string | null
  roles: GameConfigRoles
  demand: DemandConfig
  visibility: VisibilityConfig
  bot: BotConfig
}

/**
 * Every range the host form checks, as `GET /rooms/limits` serves it
 * (`app/core/limits.py`). The backend is the only copy: the form builds its
 * checks from this response and keeps no number of its own (2026-11-02).
 */
export interface Limits {
  /** Orders, demand quantities, and both optional caps (where 0 means "unlimited"). */
  max_order_quantity: number
  max_weeks: number
  min_weeks: number
  max_delay_weeks: number
  min_delay_weeks: number
  max_initial_quantity: number
  max_unit_value: number
  /** `random_seed` is held to plus or minus this: `Number.MAX_SAFE_INTEGER`. */
  max_random_seed: number
  /** `STEP` demand: the step may not fall in week 1; its upper bound is the game's length. */
  min_step_week: number
  min_period_weeks: number
  max_period_weeks: number
  /** `SEASONAL` phase, in radians, either way. */
  max_phase: number
  max_currency_symbol_length: number
  /** The bot's theta, alpha and beta lie in [0, max_bot_weight]. */
  max_bot_weight: number
  max_target_stock_multiplier: number
  /** How many rooms one `POST /rooms/batch-create` makes: its `count` lies in this range. */
  min_batch_rooms: number
  max_batch_rooms: number
}

/**
 * What a draft config will play, from `POST /rooms/preview` (`10 §3.5b`,
 * `app/core/preview.py`). The server runs the engine's own demand generator
 * and lead-time function on the draft; the host form keeps no copy of either
 * (2026-11-03).
 */
export interface ConfigPreview {
  /** Weeks 1..duration_weeks of customer demand, index 0 = week 1. */
  demand_series: number[]
  /** `STOCHASTIC` with no `random_seed` yet: an example draw, not the game. */
  demand_is_example: boolean
  /** Weeks from each role ordering to that order arriving. */
  lead_times: Record<Role, number>
  /**
   * The validated draft as a stored config holds it: the request's `patch`
   * merged in and every default filled (additive, 2026-11-14). Optional here
   * because only the multi-game setup form reads it.
   */
  config?: GameConfig
}

/* ─── Engine records (07 section 2) ─── */

/** One role's complete record for one week. */
export interface WeekRecord {
  role: Role
  week: number
  opening_inventory: number
  opening_backlog: number
  arrived: number
  incoming_order: number
  obligation: number
  shipped: number
  unfulfilled: number
  closing_inventory: number
  closing_backlog: number
  supply_line_after: number
  /**
   * This role's OWN incoming-order pipeline after the week: orders its
   * downstream customer placed that are still travelling to it. Not the
   * player's on-screen "orders in flight" (`PlayerView.orders_in_flight`),
   * which are their own orders going upstream. The export calls this column
   * `incoming_orders_in_flight_after`.
   */
  orders_in_flight_after: number
  order: number
  was_bot: boolean
  /** The host closed the week without this role's order (`07 §3.6`). */
  was_forced: boolean
  holding_cost: number
  backlog_cost: number
  fixed_order_cost: number
  purchase_cost: number
  /**
   * Holding + backlog + fixed order + purchase cost for the week. Never shown
   * as one "week cost": the screens show holding & backlog and the order cost
   * as two figures. Was `week_cost` until 2026-11-02.
   */
  total_week_cost: number
  cumulative_cost: number
  /** FACTORY only, else null. */
  production_started: number | null
  /** FACTORY only, else null. */
  production_queued: number | null
}

/**
 * Phase A's result for one role, as `player_view().settlement` carries it.
 * Mirrors `app/core/records.py` (`06-role-agents.md` section 2). Every field is
 * what a player is shown in the settlement recap.
 */
export interface WeekSettlement {
  role: Role
  week: number
  opening_inventory: number
  opening_backlog: number
  arrived: number
  /**
   * Stock after receiving and before shipping, read off the engine's own
   * settlement step (2026-11-03). The recap prints it; it never adds
   * `opening_inventory + arrived` itself.
   */
  inventory_after_arrival: number
  incoming_order: number
  /** `incoming_order + opening_backlog`. */
  obligation: number
  shipped: number
  /** `obligation - shipped`. */
  unfulfilled: number
  closing_inventory: number
  closing_backlog: number
  holding_cost: number
  backlog_cost: number
  /** `holding_cost + backlog_cost`. */
  carrying_cost: number
}

export interface RoleStats {
  role: Role
  total_cost: number
  peak_inventory: number
  peak_backlog: number
  weeks_in_backlog: number
  order_variance: number
  /** null when Var(demand) == 0 — exactly the CONSTANT generator. */
  bullwhip_ratio: number | null
  /** null when total obligation == 0. */
  fill_rate: number | null
  average_order: number
}

export interface GameStats {
  weeks_played: number
  demand_variance: number
  chain_total_cost: number
  per_role: Record<Role, RoleStats>
}

/* ─── Engine views (07 sections 3.8 and 3.9) ─── */

export interface NeighbourView {
  inventory: number
  backlog: number
}

export interface LeaderboardEntry {
  role: Role
  accumulated_cost: number
}

/**
 * `player_view(role)` — what a player of that role is entitled to see, and
 * nothing more. Redaction happens server-side, before the socket layer.
 *
 * The optional keys are the conditionally-included ones: each is present only
 * when its `VisibilityConfig` gate is on (and `balance` additionally only when
 * that role's `starting_capital > 0`).
 */
export interface PlayerView {
  role: Role
  week: number
  duration_weeks: number
  phase: GamePhase
  currency_symbol: string

  inventory: number
  backlog: number
  /** Front first: "4 arriving next week, 6 after". */
  supply_line: number
  supply_line_slots: number[]
  /**
   * Weeks until each slot of `supply_line_slots` arrives, aligned with it
   * (2026-11-03). The board labels a slot from this, never from its position.
   */
  supply_line_slot_weeks: number[]
  /**
   * What this role has ordered and its supplier has not yet received — the
   * SUPPLIER's order pipeline, never this role's own, which would show the
   * player next week's incoming demand (`07 §3.8`).
   */
  orders_in_flight: number
  /** The same pipeline as a list. `0` and `[]` for FACTORY, which has no supplier. */
  orders_in_flight_slots: number[]
  /** Weeks until each order of `orders_in_flight_slots` reaches the supplier. */
  orders_in_flight_slot_weeks: number[]
  incoming_order: number
  last_order: number | null
  settlement: WeekSettlement

  has_submitted: boolean
  /** Names only, never quantities. */
  awaiting_roles: Role[]
  own_history: WeekRecord[]

  /**
   * The bounds the server enforces on an order, both inclusive. The form
   * refuses outside them with the server's own message; the server refuses
   * too, and never clamps. The floor is always 0: there are no negative orders.
   */
  min_order_quantity: number
  max_order_quantity: number
  show_supply_line_prominently: boolean

  /** Weeks from placing an order now to that order arriving; the server computes it. */
  order_arrival_lead_weeks: number
  /** The week an order placed now arrives: `week + order_arrival_lead_weeks`, on the server. */
  order_arrival_week: number
  /** FACTORY only: units that exceeded capacity and are waiting for the line. */
  production_queue: number | null
  /** This role's own rates, for the recap's "8 units x $0.50" line. */
  holding_cost_per_unit_week: number
  backlog_cost_per_unit_week: number

  accumulated_cost?: number
  /**
   * Holding and backlog cost for the open week (once the game is over, for the
   * last closed week). Shown as "Holding & backlog", never as a "week cost".
   */
  week_holding_backlog_cost?: number
  /**
   * Fixed order cost + purchase cost for the same week. `null` while the week
   * is open: the order is charged only when the week closes ("not yet
   * charged").
   */
  week_order_cost?: number | null
  /** `starting_capital - accumulated_cost` (D8). */
  balance?: number
  /** Truncated to `week` entries — a player never sees future demand. */
  customer_demand_series?: number[]
  neighbours?: Partial<Record<Role, NeighbourView>>
  chain?: Record<Role, NeighbourView>
  leaderboard?: LeaderboardEntry[]
}

/** One role's entry in `host_view().roles`. */
export interface HostRoleView {
  inventory: number
  backlog: number
  /** For the FACTORY this is the production line — its inbound pipeline. */
  supply_line: number
  /**
   * The role's OWN incoming-order pipeline — orders travelling towards it, the
   * same figure as `WeekRecord.orders_in_flight_after`. The host view is
   * unredacted, so this is not the quantity `PlayerView` sends under the same
   * name (`07 §3.9`).
   */
  orders_in_flight: number
  last_order: number | null
  incoming_order: number
  accumulated_cost: number
  /** `0` away from the FACTORY, never null (`07 §3.9`). */
  production_queue: number
  /** Whether the role has submitted — never the quantity. */
  has_submitted: boolean
  is_bot: boolean
}

/**
 * `host_view()` — the god view, unredacted by design, delivered only with
 * `emit_to_sid` to the host's own socket.
 */
export interface HostView {
  week: number
  duration_weeks: number
  /**
   * Complete weeks so far: what the results will report, and what ending the
   * game now keeps, since the open week is dropped (`07 §3.5`). `week` is one
   * higher while a week is open. Added 2026-11-03.
   */
  weeks_played: number
  phase: GamePhase
  currency_symbol: string
  /**
   * The FULL series, including weeks not yet played. The one place the future
   * demand is ever sent, and why this view is never broadcast to a room.
   */
  demand_series: number[]
  /** Roles that have not submitted for the open week. */
  awaiting_roles: Role[]
  chain_total_cost: number
  /** One entry per role, in ROLE_ORDER. */
  roles: Record<Role, HostRoleView>
  /**
   * Each role's order for every closed week, in week order. Absent on an older
   * backend, so every reader treats it as optional.
   */
  order_history?: Record<Role, number[]>
}

/* ─── REST: rooms (10 section 2) ─── */

export interface RoomCreateRequest {
  host_display_name?: string
  preset?: string | null
}

export interface RoomCreateResponse {
  room_code: string
  /** Returned ONCE, to the creator only. Goes to `sessionStorage`. */
  host_secret: string
  state: RoomState
  config: GameConfig
}

export interface RoomStatusResponse {
  ok: boolean
  room_code: string | null
  reason: string | null
  state: RoomState | null
  host_display_name: string | null
  participant_count: number | null
  seats_taken: number | null
  seats_total: number | null
}

export interface ConfigUpdateRequest {
  /** Partial or whole; merged then validated server-side. */
  config: Partial<GameConfig>
}

export interface ConfigResponse {
  room_code: string
  state: RoomState
  config: GameConfig
}

export interface PresetSummary {
  name: string
  label: string
  description: string
  config: GameConfig
  /** The preset `/create` and `/batch-create` use when none is named (2026-11-14). */
  is_default?: boolean
}

export interface PresetListResponse {
  presets: PresetSummary[]
}

/* ─── REST: multi-game hosting (10 sections 3.5c, 3.5d) ─── */

/**
 * `POST /rooms/batch-create`. `preset` means what it means on `/create`;
 * `config` is a patch over it, validated as a config save is, once, before any
 * room exists. `count` lies in `Limits.min_batch_rooms..max_batch_rooms`.
 */
export interface RoomBatchCreateRequest {
  count: number
  preset?: string | null
  config?: Partial<GameConfig>
  host_display_name?: string
}

/** One `RoomCreateResponse` per room, each with its own one-time `host_secret`. */
export interface RoomBatchCreateResponse {
  rooms: RoomCreateResponse[]
}

/** A room this tab hosts, named with the secret that proves it. */
export interface HostedRoom {
  room_code: string
  host_secret: string
}

/** `POST /rooms/summary`: a POST so the secrets never reach a URL. */
export interface RoomSummaryRequest {
  rooms: HostedRoom[]
}

/**
 * One room on the multi-game dashboard. `exists: false`, with every other
 * field null, means the room is gone or the secret is wrong — the server does
 * not say which. `week` is the open week and is null before the game starts;
 * `finished` is true once the room is FINISHED or ABANDONED. `can_start` and
 * `start_blocked_reason` are the server's `RoomService.can_start`, the rule
 * `start_game` applies.
 */
export interface RoomSummary {
  room_code: string
  exists: boolean
  state: RoomState | null
  seats_taken: number | null
  seats_total: number | null
  week: number | null
  duration_weeks: number | null
  finished: boolean | null
  can_start: boolean | null
  start_blocked_reason: string | null
}

export interface RoomSummaryResponse {
  rooms: RoomSummary[]
}

/* ─── Socket: client → server (11 and 12, section 2) ─── */

export interface JoinWaitingEmit {
  room_id: string
  host_secret?: string
}

export interface JoinEmit {
  room_id: string
  display_name?: string
  session_token?: string
}

export interface LeaveEmit {
  room_id: string
}

export interface ConfigUpdateEmit {
  room_id: string
  host_secret: string
  config: Partial<GameConfig>
}

export interface SetRoleModeEmit {
  room_id: string
  host_secret: string
  mode: RoleAssignmentMode
}

export interface AssignRoleEmit {
  room_id: string
  host_secret: string
  alias: string
  role: Role | null
}

export interface ClaimRoleEmit {
  room_id: string
  role: Role
}

export interface ReleaseRoleEmit {
  room_id: string
}

export interface StartGameEmit {
  room_id: string
  host_secret: string
}

export interface SubmitOrderEmit {
  room_id: string
  /** A guard on the open week, not an instruction: a mismatch is rejected. */
  week: number
  order: number
}

export interface PauseGameEmit {
  room_id: string
  host_secret: string
}

export interface ResumeGameEmit {
  room_id: string
  host_secret: string
}

export interface ForceCloseWeekEmit {
  room_id: string
  host_secret: string
}

export interface SubstituteBotEmit {
  room_id: string
  host_secret: string
  role: Role
}

export interface EndGameEarlyEmit {
  room_id: string
  host_secret: string
}

/**
 * A player takes back the seat the host swapped to a bot. No role and no
 * secret: the server finds the seat from the connection, so nobody can name
 * somebody else's.
 */
export interface ReclaimSeatEmit {
  room_id: string
}

export interface RequestStateEmit {
  room_id: string
}

/* ─── Socket: server → client, lobby (11 section 2) ─── */

export interface Participant {
  alias: string
  display_name: string
  role: Role | null
  is_bot: boolean
  connected: boolean
  is_host: boolean
}

export type RoleToAlias = Record<Role, string | null>

/** The only event carrying a `session_token`. */
export interface JoinedPayload {
  alias: string
  session_token: string
  role: Role | null
  is_host: boolean
}

/** The only event carrying a `host_secret`. */
export interface HostClaimedPayload {
  room_id: string
  host_secret: string
}

export interface JoinErrorPayload {
  message: string
}

/**
 * The server's acknowledgement of a `leave` emit. It carries the room code the
 * seat was given up in, and nothing else: the server has already dropped this
 * `sid` from the room and re-broadcast `lobby_update` to everyone still in it.
 *
 * `leave` is refused once the game has started (`11 §3.3`), and the refusal
 * arrives as `join_error` rather than as an ack, so a screen that never offers
 * the control after the start never sees one.
 */
export interface LeaveAckPayload {
  room_id: string
}

export interface LobbyUpdatePayload {
  seq: number
  state: RoomState
  host_display_name: string | null
  participants: Participant[]
  role_to_alias: RoleToAlias
  role_assignment_mode: RoleAssignmentMode
  seats_total: number
  config_locked: boolean
  /** The server decides whether the game can start. The client never does. */
  can_start: boolean
  /** null exactly when `can_start` is true. */
  start_blocked_reason: string | null
}

export interface ConfigUpdatedPayload {
  seq: number
  config: GameConfig
}

export interface RolesAssignedPayload {
  seq: number
  role_to_alias: RoleToAlias
}

/**
 * `public_config()` (`11 section 3.6`): what every player may see once the game
 * runs. The same paths as `GameConfig`, without a single cost, delay or demand
 * field.
 */
export type PublicConfig = Pick<
  GameConfig,
  'duration_weeks' | 'stage_count' | 'currency_symbol' | 'visibility'
>

export interface GameStartedPayload {
  seq: number
  week: number
  duration_weeks: number
  role_to_alias: RoleToAlias
  bots: Role[]
  config_public: PublicConfig
}

/* ─── Socket: server → client, play (12 section 2) ─── */

/**
 * `own_history` is absent from the per-round `your_state`, the one after a
 * submission or a week close: the week's new record has already arrived in
 * `your_week_closed`, and the store appends it. Game start, `join` and
 * `request_state` carry the whole list.
 */
export interface YourStatePayload extends Omit<PlayerView, 'own_history'> {
  seq: number
  own_history?: WeekRecord[]
}

export interface HostStatePayload extends HostView {
  seq: number
}

/** Identity only — never a quantity. */
export interface OrderSubmittedPayload {
  seq: number
  week: number
  role: Role
  display_name: string
  is_bot: boolean
}

export interface WeekClosedPayload {
  seq: number
  week: number
  next_week: number | null
  awaiting_roles: Role[]
}

export interface YourWeekClosedPayload {
  seq: number
  week: number
  record: WeekRecord
}

export interface GamePausedPayload {
  seq: number
  reason: string
}

export interface GameResumedPayload {
  seq: number
}

/**
 * `host_disconnected` and `host_reconnected` share this shape. A host leaving
 * never pauses the game; players are only told, by a transient alert.
 */
export interface HostEventPayload {
  seq: number
}

/** `participant_disconnected` and `participant_reconnected` share this shape. */
export interface ParticipantEventPayload {
  seq: number
  alias: string
  display_name: string
  role: Role | null
}

export interface BotSubstitutedPayload {
  seq: number
  role: Role
  display_name: string
}

/** The player swapped out for a bot has taken the seat back. */
export interface SeatReclaimedPayload {
  seq: number
  role: Role
  alias: string
  display_name: string
}

export interface GameFinishedPayload {
  seq: number
  weeks_played: number
  stats: GameStats
  demand_series: number[]
  orders_by_role: Record<Role, number[]>
}

/**
 * Sent after `game_finished`, once the game is written to the database:
 * `game_id` is the permanent id behind `/results/g/:gameId`. Never sent when
 * persistence fails.
 */
export interface GamePersistedPayload {
  seq: number
  game_id: string
}

export interface ErrorPayload {
  message: string
  code: string
}
