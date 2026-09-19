/**
 * Turning the stored config into React Hook Form's values, and back again.
 *
 * `useForm({ values })` re-syncs the whole form whenever this object changes,
 * which is exactly the arrangement `18 section 3.0` describes: the store holds
 * the truth, React Hook Form holds only the keystrokes of the field being
 * edited, and a value the server clamped reappears in the input the moment the
 * response lands (AC 12, FM 1).
 */
import type { ConfigFormValues } from '../../schemas/configSchema'
import type { DemandKind, GameConfig, RoleConfig } from '../../types/game'
import { defaultDemand } from './demandDefaults'

const DEFAULT_ROLE: RoleConfig = {
  initial_inventory: 12,
  initial_backlog: 0,
  shipping_delay_weeks: 2,
  information_delay_weeks: 2,
  initial_pipeline_quantity: 4,
  initial_order_in_pipeline: 4,
  holding_cost_per_unit_week: 0.5,
  backlog_cost_per_unit_week: 1.0,
  fixed_order_cost: 0.0,
  unit_purchase_cost: 0.0,
  starting_capital: 0.0,
}

/**
 * The declared defaults of `GameConfig` (`03-game-config.md` section 2).
 *
 * It is the placeholder the form is initialised with while the stored config is
 * still in flight. Nothing is ever rendered from it — the panel shows a loading
 * line until the store has a config — but `useForm` has to be called before
 * that check, because a hook cannot be skipped.
 */
export const PLACEHOLDER_FORM_VALUES: ConfigFormValues = {
  duration_weeks: 36,
  pause_on_disconnect: true,
  bot_fill_empty_roles: false,
  random_seed: null,
  currency_symbol: '$',
  role_assignment_mode: 'HOST_ASSIGNS',
  preset_name: null,
  roles: {
    RETAILER: { ...DEFAULT_ROLE },
    WHOLESALER: { ...DEFAULT_ROLE },
    DISTRIBUTOR: { ...DEFAULT_ROLE },
    FACTORY: { ...DEFAULT_ROLE, production_delay_weeks: 2, production_capacity_per_week: null },
  },
  demand: defaultDemand('STEP'),
  visibility: {
    show_true_customer_demand_to_all: false,
    show_neighbour_inventory: false,
    show_all_inventories: false,
    show_supply_line_prominently: true,
    show_running_cost_to_players: true,
    show_leaderboard_during_game: false,
    max_order_quantity: null,
    allow_negative_orders: false,
  },
  bot: { theta: 0.25, alpha: 0.3, beta: 0.25, target_stock_multiplier: 3.0 },
}

/**
 * The form's values for a stored config.
 *
 * `demandKindOverride` is the one place the form runs ahead of the server: a
 * host who picks a different generator sees that generator's parameter block at
 * once, filled with its declared defaults — which is precisely what the payload
 * sent alongside it says (`18 section 3.1a`). It stops applying as soon as the
 * stored config agrees, so nothing here can mask a clamp.
 */
export function toFormValues(
  config: GameConfig,
  demandKindOverride: DemandKind | null,
): ConfigFormValues {
  const demand =
    demandKindOverride !== null && demandKindOverride !== config.demand.kind
      ? defaultDemand(demandKindOverride)
      : config.demand

  return {
    duration_weeks: config.duration_weeks,
    pause_on_disconnect: config.pause_on_disconnect,
    bot_fill_empty_roles: config.bot_fill_empty_roles,
    random_seed: config.random_seed,
    currency_symbol: config.currency_symbol,
    role_assignment_mode: config.role_assignment_mode,
    preset_name: config.preset_name,
    roles: {
      RETAILER: { ...config.roles.RETAILER },
      WHOLESALER: { ...config.roles.WHOLESALER },
      DISTRIBUTOR: { ...config.roles.DISTRIBUTOR },
      FACTORY: { ...config.roles.FACTORY },
    },
    demand: { ...demand },
    visibility: { ...config.visibility },
    bot: { ...config.bot },
  }
}
