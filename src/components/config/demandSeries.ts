/**
 * The host-side preview of the customer demand series (`18 section 2.6`).
 *
 * This is the one piece of arithmetic the client is allowed to do, and it is
 * display only: the series that gets played is generated server-side at start
 * (`04-demand-generator.md`). It lives in this section's own directory and is
 * imported by nothing outside it.
 *
 * **Rounding is half-up**, `Math.floor(x + 0.5)`, never `Math.round`.
 * `Math.round(-0.5)` is `-0`, i.e. it rounds exact negative halves away from
 * the direction the generator uses, and exact halves are not exotic here: a
 * `slope_per_week` of `0.5` produces one on every other week. This is the one
 * place the preview could silently disagree with the game that gets played.
 */
import type { DemandConfig, Distribution } from '../../types/game'

/** Half-up rounding. See the note above; `Math.round` is not equivalent. */
export function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5)
}

/**
 * A tiny deterministic generator, used only for the `STOCHASTIC` example draw.
 *
 * It is seeded from the generator's own parameters so the preview stays still
 * while a host reads it, instead of redrawing on every render. It deliberately
 * does NOT try to reproduce the server's stream: the server derives its own
 * from `random_seed` (D11), and the preview is labelled as an example because
 * of that.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

function seedFrom(parts: number[]): number {
  let hash = 0x811c9dc5
  for (const part of parts) {
    const scaled = Math.trunc(part * 1000)
    hash = Math.imul(hash ^ (scaled & 0xffff), 0x01000193)
    hash = Math.imul(hash ^ ((scaled >>> 16) & 0xffff), 0x01000193)
  }
  return hash >>> 0
}

function drawNormal(rng: () => number, mean: number, stdev: number): number {
  // Box-Muller. `1 - rng()` keeps the log argument away from 0.
  const u = 1 - rng()
  const v = rng()
  return mean + stdev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

function drawPoisson(rng: () => number, mean: number): number {
  if (mean <= 0) return 0
  // Knuth. `mean` is a preview parameter and small in practice.
  const limit = Math.exp(-Math.min(mean, 30))
  let count = 0
  let product = rng()
  while (product > limit && count < 10_000) {
    count += 1
    product *= rng()
  }
  return count
}

function stochasticSeries(
  demand: { distribution: Distribution; mean: number; stdev: number; min: number; max: number },
  weeks: number,
): number[] {
  const low = Math.min(demand.min, demand.max)
  const high = Math.max(demand.min, demand.max)
  const rng = mulberry32(
    seedFrom([demand.mean, demand.stdev, low, high, demand.distribution.length]),
  )

  const series: number[] = []
  for (let week = 1; week <= weeks; week += 1) {
    let raw: number
    if (demand.distribution === 'UNIFORM') {
      raw = low + rng() * (high - low)
    } else if (demand.distribution === 'POISSON') {
      raw = drawPoisson(rng, demand.mean)
    } else {
      raw = drawNormal(rng, demand.mean, demand.stdev)
    }
    series.push(Math.min(high, Math.max(low, roundHalfUp(raw))))
  }
  return series
}

/**
 * The demand for weeks `1..weeks`, as integers.
 *
 * The formulae are `18 section 2.6`, restated from `04-demand-generator.md`:
 *
 * - `CONSTANT`  `value`
 * - `STEP`      `initial_value` while `w < step_week`, then `step_value`
 * - `RAMP`      `initial_value` while `w < start_week`, else
 *               `initial_value + slope_per_week * (w - start_week + 1)` — the
 *               `+ 1` means the first ramped week already carries one slope
 *               step — then the cap when it is not null, then a floor of 0
 * - `SEASONAL`  `base + amplitude * sin(2*pi*(w - 1)/period_weeks + phase)`,
 *               `phase` in radians, floored at 0
 * - `CUSTOM`    `values[w - 1]`, truncated to `weeks`
 * - `STOCHASTIC` an example draw; see `isExampleDraw`
 */
export function demandSeries(demand: DemandConfig, weeks: number): number[] {
  const span = Math.max(0, Math.trunc(weeks))
  if (span === 0) return []

  switch (demand.kind) {
    case 'CONSTANT':
      return Array.from({ length: span }, () => roundHalfUp(Math.max(0, demand.value)))

    case 'STEP':
      return Array.from({ length: span }, (_unused, index) => {
        const week = index + 1
        const raw = week < demand.step_week ? demand.initial_value : demand.step_value
        return roundHalfUp(Math.max(0, raw))
      })

    case 'RAMP':
      return Array.from({ length: span }, (_unused, index) => {
        const week = index + 1
        let raw =
          week < demand.start_week
            ? demand.initial_value
            : demand.initial_value + demand.slope_per_week * (week - demand.start_week + 1)
        if (demand.cap !== null) raw = Math.min(raw, demand.cap)
        return roundHalfUp(Math.max(0, raw))
      })

    case 'SEASONAL':
      return Array.from({ length: span }, (_unused, index) => {
        const week = index + 1
        const period = demand.period_weeks === 0 ? 1 : demand.period_weeks
        const raw =
          demand.base +
          demand.amplitude * Math.sin((2 * Math.PI * (week - 1)) / period + demand.phase)
        return roundHalfUp(Math.max(0, raw))
      })

    case 'STOCHASTIC':
      return stochasticSeries(demand, span)

    case 'CUSTOM':
      return demand.values.slice(0, span).map((value) => roundHalfUp(Math.max(0, value)))
  }
}

/**
 * Whether the preview is an example rather than the series that will be played.
 *
 * Only `STOCHASTIC` is: every other generator is a pure function of the config,
 * so the preview and the game agree exactly.
 */
export function isExampleDraw(demand: DemandConfig): boolean {
  return demand.kind === 'STOCHASTIC'
}

/** The `data-series` attribute value: comma-separated integers. */
export function seriesAttribute(series: number[]): string {
  return series.join(',')
}
