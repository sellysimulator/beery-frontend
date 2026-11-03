/**
 * The Zod checks behind the host configuration panel (`03-game-config.md`
 * section 2), built from the server's own ranges.
 *
 * **The numbers are the server's, not ours** (2026-11-02). Every bound below
 * comes from the `Limits` object `GET /rooms/limits` returns — the same
 * `app/core/limits.py` the server validates against — so the form and the
 * server cannot disagree about a range. They did, on four fields, while the
 * form carried a hand-copied table: a step in week 1, a seasonal period past
 * 104, a stochastic mean of a million, and a cap of 0.
 *
 * **A value outside its range is refused, never clamped.** The panel shows the
 * message below beside the field and does not send the value; the server
 * refuses one that arrives anyway, with the same range in its message. The
 * cross-field rules (a `STEP`/`RAMP` week past `duration_weeks`, a `CUSTOM`
 * series shorter than the game) are checked here too, so a host does not have
 * to save to find out.
 */
import { z } from 'zod'
import type { Limits } from '../types/game'

/** The number as a host would write it: 1000000, 0.5, 6.28. */
function show(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)))
}

/**
 * The form's checks for one set of server limits.
 *
 * A factory rather than a constant because the limits arrive over the wire:
 * there is no compile-time copy of them to build a constant from.
 */
export function buildConfigFormSchema(limits: Limits) {
  const quantity = z
    .number()
    .int('Whole units only.')
    .min(0, 'Cannot be negative.')
    .max(limits.max_initial_quantity, `Maximum is ${limits.max_initial_quantity}.`)

  const money = z
    .number()
    .min(0, 'Cannot be negative.')
    .max(limits.max_unit_value, `Maximum is ${show(limits.max_unit_value)}.`)

  const delayWeeks = z
    .number()
    .int('Whole weeks only.')
    .min(limits.min_delay_weeks, `Minimum is ${limits.min_delay_weeks} week.`)
    .max(limits.max_delay_weeks, `Maximum is ${limits.max_delay_weeks} weeks.`)

  const orderQuantity = z
    .number()
    .int('Whole units only.')
    .min(0, 'Cannot be negative.')
    .max(limits.max_order_quantity, `Maximum is ${limits.max_order_quantity}.`)

  /** An optional cap: blank or 0 both mean "unlimited" (`03 section 3.1`). */
  const cap = z
    .number()
    .int('Whole units only.')
    .min(0, 'Cannot be negative. 0 means unlimited.')
    .max(limits.max_order_quantity, `Maximum is ${limits.max_order_quantity}.`)
    .nullable()

  const weekNumber = (minimum: number) =>
    z
      .number()
      .int('Whole weeks only.')
      .min(minimum, `Minimum is week ${minimum}.`)
      .max(limits.max_weeks, `Maximum is week ${limits.max_weeks}.`)

  const weight = z
    .number()
    .min(0, 'Minimum is 0.')
    .max(limits.max_bot_weight, `Maximum is ${show(limits.max_bot_weight)}.`)

  const roleConfigSchema = z.object({
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

  const factoryConfigSchema = roleConfigSchema.extend({
    production_delay_weeks: delayWeeks,
    production_capacity_per_week: cap,
  })

  const demandConfigSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('CONSTANT'), value: orderQuantity }),
    z.object({
      kind: z.literal('STEP'),
      initial_value: orderQuantity,
      step_week: weekNumber(limits.min_step_week),
      step_value: orderQuantity,
    }),
    z.object({
      kind: z.literal('RAMP'),
      initial_value: orderQuantity,
      slope_per_week: z
        .number()
        .min(-limits.max_order_quantity, `Minimum is -${limits.max_order_quantity}.`)
        .max(limits.max_order_quantity, `Maximum is ${limits.max_order_quantity}.`),
      start_week: weekNumber(1),
      cap: orderQuantity.nullable(),
    }),
    z.object({
      kind: z.literal('SEASONAL'),
      base: orderQuantity,
      amplitude: orderQuantity,
      period_weeks: z
        .number()
        .int('Whole weeks only.')
        .min(limits.min_period_weeks, `Minimum is ${limits.min_period_weeks} weeks.`)
        .max(limits.max_period_weeks, `Maximum is ${limits.max_period_weeks} weeks.`),
      phase: z
        .number()
        .min(-limits.max_phase, `Minimum is -${show(limits.max_phase)}.`)
        .max(limits.max_phase, `Maximum is ${show(limits.max_phase)}.`),
    }),
    z.object({
      kind: z.literal('STOCHASTIC'),
      distribution: z.enum(['NORMAL', 'POISSON', 'UNIFORM']),
      // A mean or spread above the order ceiling cannot be ordered against,
      // and the server refuses it (it used to clamp it to 9999 silently).
      mean: z
        .number()
        .min(0, 'Cannot be negative.')
        .max(limits.max_order_quantity, `Maximum is ${limits.max_order_quantity}.`),
      stdev: z
        .number()
        .min(0, 'Cannot be negative.')
        .max(limits.max_order_quantity, `Maximum is ${limits.max_order_quantity}.`),
      min: orderQuantity,
      max: orderQuantity,
    }),
    z.object({
      kind: z.literal('CUSTOM'),
      values: z.array(orderQuantity).min(1, 'Paste at least one week of demand.'),
    }),
  ])

  /**
   * `stage_count` is absent on purpose: it is `Literal[4]` for v1 and there is
   * no control for it, so putting it in the form would only create a field
   * that can never legally change.
   */
  return z
    .object({
      duration_weeks: z
        .number()
        .int('Whole weeks only.')
        .min(limits.min_weeks, `Minimum is ${limits.min_weeks} weeks.`)
        .max(limits.max_weeks, `Maximum is ${limits.max_weeks} weeks.`),
      pause_on_disconnect: z.boolean(),
      bot_fill_empty_roles: z.boolean(),
      /** null means "the server generates one at start and persists it" (D11). */
      random_seed: z
        .number()
        .int('Whole numbers only.')
        .min(-limits.max_random_seed, `Minimum is ${-limits.max_random_seed}.`)
        .max(limits.max_random_seed, `Maximum is ${limits.max_random_seed}.`)
        .nullable(),
      currency_symbol: z
        .string()
        .min(1, 'Pick a symbol.')
        .max(
          limits.max_currency_symbol_length,
          `${limits.max_currency_symbol_length} characters at most.`,
        ),
      role_assignment_mode: z.enum(['HOST_ASSIGNS', 'PLAYER_CHOOSES', 'RANDOM']),
      preset_name: z.string().nullable(),
      roles: z.object({
        RETAILER: roleConfigSchema,
        WHOLESALER: roleConfigSchema,
        DISTRIBUTOR: roleConfigSchema,
        FACTORY: factoryConfigSchema,
      }),
      demand: demandConfigSchema,
      visibility: z.object({
        show_true_customer_demand_to_all: z.boolean(),
        show_neighbour_inventory: z.boolean(),
        show_all_inventories: z.boolean(),
        show_supply_line_prominently: z.boolean(),
        show_running_cost_to_players: z.boolean(),
        show_leaderboard_during_game: z.boolean(),
        max_order_quantity: cap,
      }),
      bot: z.object({
        theta: weight,
        alpha: weight,
        beta: weight,
        target_stock_multiplier: z
          .number()
          .min(0, 'Minimum is 0.')
          .max(
            limits.max_target_stock_multiplier,
            `Maximum is ${show(limits.max_target_stock_multiplier)}.`,
          ),
      }),
    })
    .superRefine((config, ctx) => {
      // The two week rules that depend on the game's length: the server
      // refuses a step or ramp start after the last week (`03 section 3.1`
      // rules 3 and 4), so the form says so before the save.
      const last = config.duration_weeks
      if (config.demand.kind === 'STEP' && config.demand.step_week > last) {
        ctx.addIssue({
          code: 'custom',
          path: ['demand', 'step_week'],
          message: `The step must fall in week ${last} or earlier.`,
        })
      }
      if (config.demand.kind === 'RAMP' && config.demand.start_week > last) {
        ctx.addIssue({
          code: 'custom',
          path: ['demand', 'start_week'],
          message: `The ramp must start in week ${last} or earlier.`,
        })
      }
    })
}

export type ConfigFormSchema = ReturnType<typeof buildConfigFormSchema>
export type ConfigFormValues = z.infer<ConfigFormSchema>

/**
 * How many weeks of `CUSTOM` demand are missing, or 0 when the series is long
 * enough (or the generator is not `CUSTOM`).
 *
 * This blocks a save rather than only flagging it: the server answers a short
 * `CUSTOM` series with a 422 naming the field (`18 section 3.1a`), and a host
 * should not have to submit to find that out.
 */
export function customDemandShortfall(
  demand: { kind: string; values?: number[] },
  durationWeeks: number,
): number {
  if (demand.kind !== 'CUSTOM') return 0
  const count = demand.values?.length ?? 0
  return count >= durationWeeks ? 0 : durationWeeks - count
}
