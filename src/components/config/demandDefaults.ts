/**
 * The declared defaults of each demand model in `03-game-config.md` section 2.
 *
 * Changing the generator **replaces** the demand object with these rather than
 * carrying stale fields across, which mirrors what the server does with a
 * payload that changes `demand.kind` (`18 section 3.1a`): it discards the old
 * object entirely. Carrying a `step_week` into a `SEASONAL` config is how a
 * host ends up running a scenario nobody described.
 */
import type { DemandConfig, DemandKind } from '../../types/game'

/** `CustomDemand.values` has no declared default; an empty series is the seed. */
const DEFAULTS: { [K in DemandKind]: Extract<DemandConfig, { kind: K }> } = {
  CONSTANT: { kind: 'CONSTANT', value: 4 },
  STEP: { kind: 'STEP', initial_value: 4, step_week: 5, step_value: 8 },
  RAMP: { kind: 'RAMP', initial_value: 4, slope_per_week: 1.0, start_week: 5, cap: null },
  SEASONAL: { kind: 'SEASONAL', base: 8, amplitude: 4, period_weeks: 12, phase: 0.0 },
  STOCHASTIC: {
    kind: 'STOCHASTIC',
    distribution: 'NORMAL',
    mean: 8.0,
    stdev: 2.0,
    min: 0,
    max: 20,
  },
  CUSTOM: { kind: 'CUSTOM', values: [] },
}

export const DEMAND_KINDS: readonly DemandKind[] = [
  'CONSTANT',
  'STEP',
  'RAMP',
  'SEASONAL',
  'STOCHASTIC',
  'CUSTOM',
] as const

/** A fresh demand object of `kind`, carrying nothing from any other kind. */
export function defaultDemand(kind: DemandKind): DemandConfig {
  const base = DEFAULTS[kind]
  return base.kind === 'CUSTOM' ? { ...base, values: [] } : { ...base }
}
