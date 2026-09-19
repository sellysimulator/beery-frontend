/**
 * `18-frontend-host-config.md §3.2` — the Zod shape behind the host form.
 *
 * "Zod mirrors the ranges in `00-decisions.md §5` for immediate feedback, but the
 * server is authoritative." So this file asserts exactly those ranges, plus the
 * two the config models themselves declare (`03-game-config.md §2`: the Sterman
 * parameters are `0.0 .. 1.0` and the target-stock multiplier `0.0 .. 10.0`). It
 * asserts nothing about clamping — the form never clamps; §3.1a's clamp belongs
 * to the server, and §3.2 makes this schema a hint rather than a gate.
 *
 * `18 §2` names `src/schemas/configSchema.ts` as the module but does not name the
 * export, so `schema()` below picks whichever exported value both exposes
 * `safeParse` and accepts a complete, in-range `GameConfig`.
 */
import { describe, it, expect } from 'vitest';

import * as configSchemaModule from '../schemas/configSchema';
import type {
  BotConfig,
  FactoryConfig,
  GameConfig,
  RoleConfig,
  VisibilityConfig,
} from '../types/game';

// ---------------------------------------------------------------------------
// Fixtures — `03-game-config.md §2`'s declared defaults
// ---------------------------------------------------------------------------

function roleDefaults(over: Partial<RoleConfig> = {}): RoleConfig {
  return {
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
    ...over,
  };
}

function factoryDefaults(over: Partial<FactoryConfig> = {}): FactoryConfig {
  return { ...roleDefaults(), production_delay_weeks: 2, production_capacity_per_week: null, ...over };
}

function visibilityDefaults(over: Partial<VisibilityConfig> = {}): VisibilityConfig {
  return {
    show_true_customer_demand_to_all: false,
    show_neighbour_inventory: false,
    show_all_inventories: false,
    show_supply_line_prominently: true,
    show_running_cost_to_players: true,
    show_leaderboard_during_game: false,
    max_order_quantity: null,
    allow_negative_orders: false,
    ...over,
  };
}

function botDefaults(over: Partial<BotConfig> = {}): BotConfig {
  return { theta: 0.25, alpha: 0.3, beta: 0.25, target_stock_multiplier: 3.0, ...over };
}

function validConfig(over: Partial<GameConfig> = {}): GameConfig {
  return {
    duration_weeks: 36,
    stage_count: 4,
    pause_on_disconnect: true,
    bot_fill_empty_roles: false,
    random_seed: null,
    currency_symbol: '$',
    role_assignment_mode: 'HOST_ASSIGNS',
    preset_name: null,
    roles: {
      RETAILER: roleDefaults(),
      WHOLESALER: roleDefaults(),
      DISTRIBUTOR: roleDefaults(),
      FACTORY: factoryDefaults(),
    },
    demand: { kind: 'STEP', initial_value: 4, step_week: 5, step_value: 8 },
    visibility: visibilityDefaults(),
    bot: botDefaults(),
    ...over,
  };
}

/** The same config with one role's field replaced. */
function withRetailer(over: Partial<RoleConfig>): GameConfig {
  const base = validConfig();
  return { ...base, roles: { ...base.roles, RETAILER: roleDefaults(over) } };
}

function withFactory(over: Partial<FactoryConfig>): GameConfig {
  const base = validConfig();
  return { ...base, roles: { ...base.roles, FACTORY: factoryDefaults(over) } };
}

// ---------------------------------------------------------------------------
// Finding the schema
// ---------------------------------------------------------------------------

interface Parser {
  safeParse(value: unknown): { success: boolean };
}

function isParser(value: unknown): value is Parser {
  return (
    !!value &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as Parser).safeParse === 'function'
  );
}

let cached: Parser | null = null;

function schema(): Parser {
  if (cached) return cached;
  const exported = configSchemaModule as unknown as Record<string, unknown>;
  const candidates = Object.values(exported).filter(isParser);
  if (candidates.length === 0) {
    throw new Error(
      'src/schemas/configSchema.ts exports nothing with `safeParse`. 18 §2 names the ' +
        'module but not the export, so this test accepts any exported Zod schema.',
    );
  }
  const whole = candidates.find((c) => c.safeParse(validConfig()).success);
  if (!whole) {
    throw new Error(
      'No export of src/schemas/configSchema.ts accepts a complete, in-range GameConfig ' +
        'built from 03 §2\'s declared defaults.',
    );
  }
  cached = whole;
  return whole;
}

function accepts(value: unknown): boolean {
  return schema().safeParse(value).success;
}

// ---------------------------------------------------------------------------

describe('the whole config', () => {
  it('accepts a complete config built from the declared defaults', () => {
    expect(accepts(validConfig())).toBe(true);
  });
});

describe('duration_weeks — MIN_WEEKS 8, MAX_WEEKS_LIMIT 104 (§5)', () => {
  it('accepts both ends of the range', () => {
    expect(accepts(validConfig({ duration_weeks: 8 }))).toBe(true);
    expect(accepts(validConfig({ duration_weeks: 104 }))).toBe(true);
  });

  it('rejects below MIN_WEEKS', () => {
    expect(accepts(validConfig({ duration_weeks: 7 }))).toBe(false);
  });

  it('rejects above MAX_WEEKS_LIMIT', () => {
    expect(accepts(validConfig({ duration_weeks: 105 }))).toBe(false);
    expect(accepts(validConfig({ duration_weeks: 500 }))).toBe(false);
  });
});

describe('delays — MIN_DELAY_WEEKS 1, MAX_DELAY_WEEKS 8 (§5)', () => {
  it('accepts both ends of the range', () => {
    expect(accepts(withRetailer({ shipping_delay_weeks: 1 }))).toBe(true);
    expect(accepts(withRetailer({ shipping_delay_weeks: 8 }))).toBe(true);
    expect(accepts(withRetailer({ information_delay_weeks: 1 }))).toBe(true);
    expect(accepts(withFactory({ production_delay_weeks: 8 }))).toBe(true);
  });

  it('rejects a zero delay, which collapses the pipeline', () => {
    expect(accepts(withRetailer({ shipping_delay_weeks: 0 }))).toBe(false);
    expect(accepts(withFactory({ production_delay_weeks: 0 }))).toBe(false);
  });

  it('rejects a delay above the cap', () => {
    expect(accepts(withRetailer({ shipping_delay_weeks: 9 }))).toBe(false);
    expect(accepts(withRetailer({ information_delay_weeks: 9 }))).toBe(false);
    expect(accepts(withFactory({ production_delay_weeks: 9 }))).toBe(false);
  });
});

describe('initial quantities — MAX_INITIAL_QUANTITY 9_999 (§5)', () => {
  it('accepts the ceiling', () => {
    expect(accepts(withRetailer({ initial_inventory: 9_999 }))).toBe(true);
    expect(accepts(withRetailer({ initial_backlog: 9_999 }))).toBe(true);
    expect(accepts(withRetailer({ initial_pipeline_quantity: 9_999 }))).toBe(true);
    expect(accepts(withRetailer({ initial_order_in_pipeline: 9_999 }))).toBe(true);
  });

  it('rejects above the ceiling', () => {
    expect(accepts(withRetailer({ initial_inventory: 10_000 }))).toBe(false);
    expect(accepts(withRetailer({ initial_backlog: 10_000 }))).toBe(false);
    expect(accepts(withRetailer({ initial_pipeline_quantity: 10_000 }))).toBe(false);
    expect(accepts(withRetailer({ initial_order_in_pipeline: 10_000 }))).toBe(false);
  });
});

describe('unit values — MAX_UNIT_VALUE 1_000_000.0 (§5)', () => {
  it('accepts the ceiling for every cost and starting_capital', () => {
    expect(accepts(withRetailer({ holding_cost_per_unit_week: 1_000_000 }))).toBe(true);
    expect(accepts(withRetailer({ backlog_cost_per_unit_week: 1_000_000 }))).toBe(true);
    expect(accepts(withRetailer({ fixed_order_cost: 1_000_000 }))).toBe(true);
    expect(accepts(withRetailer({ unit_purchase_cost: 1_000_000 }))).toBe(true);
    expect(accepts(withRetailer({ starting_capital: 1_000_000 }))).toBe(true);
  });

  it('rejects above the ceiling', () => {
    expect(accepts(withRetailer({ holding_cost_per_unit_week: 1_000_000.01 }))).toBe(false);
    expect(accepts(withRetailer({ backlog_cost_per_unit_week: 1e12 }))).toBe(false);
    expect(accepts(withRetailer({ fixed_order_cost: 1e12 }))).toBe(false);
    expect(accepts(withRetailer({ unit_purchase_cost: 1e12 }))).toBe(false);
    expect(accepts(withRetailer({ starting_capital: 1e12 }))).toBe(false);
  });
});

describe('max_order_quantity — MAX_ORDER_QUANTITY 9_999 (§5)', () => {
  it('accepts null, meaning uncapped by the host', () => {
    expect(accepts(validConfig({ visibility: visibilityDefaults({ max_order_quantity: null }) }))).toBe(
      true,
    );
  });

  it('accepts the ceiling and rejects above it', () => {
    expect(
      accepts(validConfig({ visibility: visibilityDefaults({ max_order_quantity: 9_999 }) })),
    ).toBe(true);
    expect(
      accepts(validConfig({ visibility: visibilityDefaults({ max_order_quantity: 10_000 }) })),
    ).toBe(false);
  });
});

describe('bot parameters (03 §2)', () => {
  it('accepts theta, alpha and beta at both ends of 0.0 .. 1.0', () => {
    for (const key of ['theta', 'alpha', 'beta'] as const) {
      expect(accepts(validConfig({ bot: botDefaults({ [key]: 0 }) })), `${key} = 0`).toBe(true);
      expect(accepts(validConfig({ bot: botDefaults({ [key]: 1 }) })), `${key} = 1`).toBe(true);
    }
  });

  it('rejects theta, alpha and beta outside 0.0 .. 1.0', () => {
    for (const key of ['theta', 'alpha', 'beta'] as const) {
      expect(accepts(validConfig({ bot: botDefaults({ [key]: -0.1 }) })), `${key} = -0.1`).toBe(false);
      expect(accepts(validConfig({ bot: botDefaults({ [key]: 1.1 }) })), `${key} = 1.1`).toBe(false);
    }
  });

  it('bounds target_stock_multiplier at 0.0 .. 10.0', () => {
    expect(accepts(validConfig({ bot: botDefaults({ target_stock_multiplier: 0 }) }))).toBe(true);
    expect(accepts(validConfig({ bot: botDefaults({ target_stock_multiplier: 10 }) }))).toBe(true);
    expect(accepts(validConfig({ bot: botDefaults({ target_stock_multiplier: -1 }) }))).toBe(false);
    expect(accepts(validConfig({ bot: botDefaults({ target_stock_multiplier: 10.5 }) }))).toBe(false);
  });
});

describe('the demand union (03 §2)', () => {
  it('accepts every generator with its declared defaults', () => {
    const demands: GameConfig['demand'][] = [
      { kind: 'CONSTANT', value: 4 },
      { kind: 'STEP', initial_value: 4, step_week: 5, step_value: 8 },
      { kind: 'RAMP', initial_value: 4, slope_per_week: 1.0, start_week: 5, cap: null },
      { kind: 'SEASONAL', base: 8, amplitude: 4, period_weeks: 12, phase: 0.0 },
      { kind: 'STOCHASTIC', distribution: 'NORMAL', mean: 8.0, stdev: 2.0, min: 0, max: 20 },
      { kind: 'CUSTOM', values: [4, 4, 4, 4, 8, 8, 8, 8] },
    ];
    for (const demand of demands) {
      expect(accepts(validConfig({ demand })), `${demand.kind}`).toBe(true);
    }
  });

  it('accepts a RAMP cap of null and a numeric cap alike', () => {
    expect(
      accepts(
        validConfig({
          demand: { kind: 'RAMP', initial_value: 4, slope_per_week: 2, start_week: 3, cap: 12 },
        }),
      ),
    ).toBe(true);
  });

  it('rejects a generator kind that is not one of the six', () => {
    expect(accepts(validConfig({ demand: { kind: 'SINE', base: 8 } as unknown as GameConfig['demand'] }))).toBe(
      false,
    );
  });

  it('rejects a STEP that is missing a parameter of its own kind', () => {
    expect(
      accepts(
        validConfig({
          demand: { kind: 'STEP', initial_value: 4, step_value: 8 } as unknown as GameConfig['demand'],
        }),
      ),
    ).toBe(false);
  });
});

describe('role_assignment_mode (03 §2)', () => {
  it('accepts the three declared modes', () => {
    for (const mode of ['HOST_ASSIGNS', 'PLAYER_CHOOSES', 'RANDOM'] as const) {
      expect(accepts(validConfig({ role_assignment_mode: mode })), mode).toBe(true);
    }
  });

  it('rejects a mode outside the enum', () => {
    expect(
      accepts(
        validConfig({
          role_assignment_mode: 'FIRST_COME' as unknown as GameConfig['role_assignment_mode'],
        }),
      ),
    ).toBe(false);
  });
});

describe('random_seed (D11)', () => {
  it('accepts null, which means "the server generates one at start"', () => {
    expect(accepts(validConfig({ random_seed: null }))).toBe(true);
  });

  it('accepts an integer seed', () => {
    expect(accepts(validConfig({ random_seed: 20_251_118 }))).toBe(true);
  });
});
