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
  max_order_quantity: number | null
  allow_negative_orders: boolean
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

/** The hard ceilings from `00-decisions.md` section 5. */
export interface Limits {
  max_order_quantity: number
  max_weeks: number
  min_weeks: number
  max_delay_weeks: number
  min_delay_weeks: number
  max_initial_quantity: number
  max_unit_value: number
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
  orders_in_flight_after: number
  order: number
  was_bot: boolean
  holding_cost: number
  backlog_cost: number
  fixed_order_cost: number
  purchase_cost: number
  week_cost: number
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
  orders_in_flight: number
  /** Always `[]` for RETAILER. */
  orders_in_flight_slots: number[]
  incoming_order: number
  last_order: number | null
  settlement: WeekSettlement

  has_submitted: boolean
  /** Names only, never quantities. */
  awaiting_roles: Role[]
  own_history: WeekRecord[]

  max_order_quantity: number | null
  allow_negative_orders: boolean
  show_supply_line_prominently: boolean

  accumulated_cost?: number
  week_cost?: number
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
  supply_line: number
  orders_in_flight: number
  last_order: number | null
  incoming_order: number
  accumulated_cost: number
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
}

export interface PresetListResponse {
  presets: PresetSummary[]
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

export interface LobbyUpdatePayload {
  seq: number
  state: RoomState
  host_display_name: string | null
  participants: Participant[]
  role_to_alias: RoleToAlias
  role_assignment_mode: RoleAssignmentMode
  seats_total: number
  config_locked: boolean
}

export interface ConfigUpdatedPayload {
  seq: number
  config: GameConfig
}

export interface RolesAssignedPayload {
  seq: number
  role_to_alias: RoleToAlias
}

export interface GameStartedPayload {
  seq: number
  week: number
  duration_weeks: number
  role_to_alias: RoleToAlias
  bots: Role[]
  config_public: GameConfig
}

/* ─── Socket: server → client, play (12 section 2) ─── */

export interface YourStatePayload extends PlayerView {
  seq: number
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

export interface GameFinishedPayload {
  seq: number
  weeks_played: number
  stats: GameStats
  demand_series: number[]
  orders_by_role: Record<Role, number[]>
}

export interface ErrorPayload {
  message: string
  code: string
}
