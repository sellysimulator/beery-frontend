/**
 * Zod mirrors of `GameConfig` (`03-game-config.md` section 2), used by the host
 * configuration panel for immediate, field-level feedback.
 *
 * **This is a hint, not a gate** (`18 section 3.2`). The server clamps every
 * host-supplied value (`00-decisions.md` section 5) and is the only authority on
 * what a room is actually configured with. Everything here exists so a host sees
 * "Maximum is 104 weeks" as they type rather than after a round trip; a value the
 * schema rejects is still sent, because the server's clamp is what the panel
 * renders back (`18 section 3.0`).
 *
 * The one exception is `CUSTOM` demand shorter than `duration_weeks`, which the
 * server *rejects* rather than clamps. That check needs `duration_weeks` as well
 * as the demand block, so it lives in `customDemandShortfall` and is enforced by
 * the panel, not by a field schema.
 */
import { z } from 'zod'
import type { Limits } from '../types/game'

/** `00-decisions.md` section 5, in the shape section 03 injects server-side. */
export const FORM_LIMITS: Limits = {
  max_order_quantity: 9_999,
  max_weeks: 104,
  min_weeks: 8,
  max_delay_weeks: 8,
  min_delay_weeks: 1,
  max_initial_quantity: 9_999,
  max_unit_value: 1_000_000.0,
}

const quantity = z
  .number()
  .int('Whole units only.')
  .min(0, 'Cannot be negative.')
  .max(FORM_LIMITS.max_initial_quantity, `Maximum is ${FORM_LIMITS.max_initial_quantity}.`)

const money = z
  .number()
  .min(0, 'Cannot be negative.')
  .max(FORM_LIMITS.max_unit_value, `Maximum is ${FORM_LIMITS.max_unit_value}.`)

const delayWeeks = z
  .number()
  .int('Whole weeks only.')
  .min(FORM_LIMITS.min_delay_weeks, `Minimum is ${FORM_LIMITS.min_delay_weeks} week.`)
  .max(FORM_LIMITS.max_delay_weeks, `Maximum is ${FORM_LIMITS.max_delay_weeks} weeks.`)

const orderQuantity = z
  .number()
  .int('Whole units only.')
  .min(0, 'Cannot be negative.')
  .max(FORM_LIMITS.max_order_quantity, `Maximum is ${FORM_LIMITS.max_order_quantity}.`)

const unitInterval = z.number().min(0, 'Minimum is 0.').max(1, 'Maximum is 1.')

export const roleConfigSchema = z.object({
  initial_inventory: quantity,
  initial_backlog: quantity,
  shipping_delay_weeks: delayWeeks,
  information_delay_weeks: delayWeeks,
  initial_pipeline_quantity: quantity,
  initial_order_in_pipeline: quantity,
  holding_cost_per_unit_week: money,
  backlog_cost_per_unit_week: money,
  fixed_order_cost: money,
  unit_purchase_cost: money,
  starting_capital: money,
})

export const factoryConfigSchema = roleConfigSchema.extend({
  production_delay_weeks: delayWeeks,
  /** null means "uncapped", which is the declared default. */
  production_capacity_per_week: orderQuantity.nullable(),
})

export const botConfigSchema = z.object({
  theta: unitInterval,
  alpha: unitInterval,
  beta: unitInterval,
  target_stock_multiplier: z.number().min(0, 'Minimum is 0.').max(10, 'Maximum is 10.'),
})

export const visibilityConfigSchema = z.object({
  show_true_customer_demand_to_all: z.boolean(),
  show_neighbour_inventory: z.boolean(),
  show_all_inventories: z.boolean(),
  show_supply_line_prominently: z.boolean(),
  show_running_cost_to_players: z.boolean(),
  show_leaderboard_during_game: z.boolean(),
  max_order_quantity: orderQuantity.nullable(),
  allow_negative_orders: z.boolean(),
})

const weekNumber = z
  .number()
  .int('Whole weeks only.')
  .min(1, 'Week 0 never exists.')
  .max(FORM_LIMITS.max_weeks, `Maximum is ${FORM_LIMITS.max_weeks}.`)

export const constantDemandSchema = z.object({
  kind: z.literal('CONSTANT'),
  value: orderQuantity,
})

export const stepDemandSchema = z.object({
  kind: z.literal('STEP'),
  initial_value: orderQuantity,
  step_week: weekNumber,
  step_value: orderQuantity,
})

export const rampDemandSchema = z.object({
  kind: z.literal('RAMP'),
  initial_value: orderQuantity,
  slope_per_week: z
    .number()
    .min(-FORM_LIMITS.max_order_quantity, 'Out of range.')
    .max(FORM_LIMITS.max_order_quantity, 'Out of range.'),
  start_week: weekNumber,
  cap: orderQuantity.nullable(),
})

export const seasonalDemandSchema = z.object({
  kind: z.literal('SEASONAL'),
  base: orderQuantity,
  amplitude: orderQuantity,
  period_weeks: weekNumber,
  phase: z.number().min(-Math.PI * 2, 'Out of range.').max(Math.PI * 2, 'Out of range.'),
})

export const stochasticDemandSchema = z.object({
  kind: z.literal('STOCHASTIC'),
  distribution: z.enum(['NORMAL', 'POISSON', 'UNIFORM']),
  mean: money,
  stdev: money,
  min: orderQuantity,
  max: orderQuantity,
})

export const customDemandSchema = z.object({
  kind: z.literal('CUSTOM'),
  values: z.array(orderQuantity).min(1, 'Paste at least one week of demand.'),
})

export const demandConfigSchema = z.discriminatedUnion('kind', [
  constantDemandSchema,
  stepDemandSchema,
  rampDemandSchema,
  seasonalDemandSchema,
  stochasticDemandSchema,
  customDemandSchema,
])

/**
 * `stage_count` is absent on purpose: it is `Literal[4]` for v1 and there is no
 * control for it, so putting it in the form would only create a field that can
 * never legally change.
 */
export const configFormSchema = z.object({
  duration_weeks: z
    .number()
    .int('Whole weeks only.')
    .min(FORM_LIMITS.min_weeks, `Minimum is ${FORM_LIMITS.min_weeks} weeks.`)
    .max(FORM_LIMITS.max_weeks, `Maximum is ${FORM_LIMITS.max_weeks} weeks.`),
  pause_on_disconnect: z.boolean(),
  bot_fill_empty_roles: z.boolean(),
  /** null means "the server generates one at start and persists it" (D11). */
  random_seed: z.number().int('Whole numbers only.').nullable(),
  currency_symbol: z.string().min(1, 'Pick a symbol.').max(4, 'Four characters at most.'),
  role_assignment_mode: z.enum(['HOST_ASSIGNS', 'PLAYER_CHOOSES', 'RANDOM']),
  preset_name: z.string().nullable(),
  roles: z.object({
    RETAILER: roleConfigSchema,
    WHOLESALER: roleConfigSchema,
    DISTRIBUTOR: roleConfigSchema,
    FACTORY: factoryConfigSchema,
  }),
  demand: demandConfigSchema,
  visibility: visibilityConfigSchema,
  bot: botConfigSchema,
})

export type ConfigFormValues = z.infer<typeof configFormSchema>

/**
 * How many weeks of `CUSTOM` demand are missing, or 0 when the series is long
 * enough (or the generator is not `CUSTOM`).
 *
 * This is the one client-side rule that blocks a save rather than hinting at
 * one: the server answers a short `CUSTOM` series with a 422 naming the field
 * (`18 section 3.1a`), and a host should not have to submit to find that out.
 */
export function customDemandShortfall(
  demand: { kind: string; values?: number[] },
  durationWeeks: number,
): number {
  if (demand.kind !== 'CUSTOM') return 0
  const count = demand.values?.length ?? 0
  return count >= durationWeeks ? 0 : durationWeeks - count
}
