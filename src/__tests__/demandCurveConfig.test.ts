/**
 * BE-5 (`CHARTS-PLAN.md`), the builder half: `buildDemandCurveConfig`'s curve
 * split (segment callbacks, the current-week band option) and the order
 * overlay (`docs/plan/20-frontend-host-console.md §2.1b`).
 *
 * Pure builder tests. Chart.js is never mocked and nothing here needs a canvas.
 */
import { describe, expect, it } from 'vitest'
import type { ChartConfiguration } from 'chart.js'

import {
  buildDemandCurveConfig,
  DEMAND_CURVE_LABEL,
  revealedDemand,
} from '../components/host/demandCurveConfig'
import { orderSeriesLabel } from '../components/charts/chartSetup'
import { DEMAND_COLOUR, roleStyle, withAlpha } from '../components/charts/chartTheme'
import { ROLE_ORDER } from '../types/game'
import type { Role } from '../types/game'

const DURATION = 24
const WEEK = 17
const SERIES: number[] = Array.from({ length: DURATION }, (_, i) => 1001 + i)

/** Closed weeks only: week 17 is open, so 16 entries. Values are unlike the demand series. */
function orders(role: Role, closed = WEEK - 1): number[] {
  const base = 5000 + ROLE_ORDER.indexOf(role) * 100
  return Array.from({ length: closed }, (_, i) => base + i)
}

const FULL_HISTORY: Record<Role, number[]> = {
  RETAILER: orders('RETAILER'),
  WHOLESALER: orders('WHOLESALER'),
  DISTRIBUTOR: orders('DISTRIBUTOR'),
  FACTORY: orders('FACTORY'),
}

type Ds = Record<string, unknown>
type SegmentCtx = { p0DataIndex: number; p1DataIndex: number }
type SegmentFn = (ctx: SegmentCtx) => unknown

function datasetsOf(config: ChartConfiguration<'line'>): Ds[] {
  return (config.data.datasets ?? []) as unknown as Ds[]
}

function demandDataset(config: ChartConfiguration<'line'>): Ds {
  const found = datasetsOf(config).find((d) => d.label === DEMAND_CURVE_LABEL)
  if (!found) throw new Error('no dataset labelled DEMAND_CURVE_LABEL')
  return found
}

function segmentFn(config: ChartConfiguration<'line'>, key: 'borderColor' | 'borderDash'): SegmentFn {
  const segment = demandDataset(config).segment as Record<string, unknown> | undefined
  const fn = segment?.[key]
  if (typeof fn !== 'function') {
    throw new Error(`the demand dataset must carry segment.${key} as a callback (20 §2.1b)`)
  }
  return fn as SegmentFn
}

/** The segment ending at point index `p1`, as Chart.js would hand it to the callback. */
function seg(p1: number): SegmentCtx {
  return { p0DataIndex: p1 - 1, p1DataIndex: p1 }
}

describe('buildDemandCurveConfig: without an order overlay', () => {
  const noOverlay: Array<[string, Parameters<typeof buildDemandCurveConfig>[2]]> = [
    ['no options', undefined],
    ['empty options', {}],
    ['orderHistory undefined', { orderHistory: undefined }],
    ['orderHistory null', { orderHistory: null }],
  ]

  it.each(noOverlay)('%s: one dataset holding the full series', (_name, options) => {
    const config = buildDemandCurveConfig([...SERIES], WEEK, options)

    expect(datasetsOf(config)).toHaveLength(1)
    expect(datasetsOf(config)[0].label).toBe(DEMAND_CURVE_LABEL)
    expect(datasetsOf(config)[0].data).toEqual(SERIES)
  })
})

describe('buildDemandCurveConfig: the order overlay', () => {
  it('adds one dataset per role, in ROLE_ORDER, before demand, which stays last', () => {
    const config = buildDemandCurveConfig([...SERIES], WEEK, { orderHistory: FULL_HISTORY })
    const datasets = datasetsOf(config)

    expect(datasets.map((d) => d.label)).toEqual([
      ...ROLE_ORDER.map((role) => orderSeriesLabel(role)),
      DEMAND_CURVE_LABEL,
    ])
    expect(datasets[datasets.length - 1].data).toEqual(SERIES)
  })

  it('keeps ROLE_ORDER even when the object lists its roles in another order', () => {
    const reversed: Partial<Record<Role, number[]>> = {}
    for (const role of [...ROLE_ORDER].reverse()) reversed[role] = FULL_HISTORY[role]

    const config = buildDemandCurveConfig([...SERIES], WEEK, { orderHistory: reversed })

    expect(datasetsOf(config).map((d) => d.label)).toEqual([
      ...ROLE_ORDER.map((role) => orderSeriesLabel(role)),
      DEMAND_CURVE_LABEL,
    ])
  })

  it.each(ROLE_ORDER)('%s: data is the closed weeks exactly, in the role style, with no points', (role) => {
    const config = buildDemandCurveConfig([...SERIES], WEEK, { orderHistory: FULL_HISTORY })
    const dataset = datasetsOf(config).find((d) => d.label === orderSeriesLabel(role))

    expect(dataset).toBeDefined()
    // Closed weeks only: not padded to the 24 weeks, not derived from anything.
    expect(dataset?.data).toEqual(FULL_HISTORY[role])
    expect((dataset?.data as number[]).length).toBe(WEEK - 1)
    expect(dataset?.borderColor).toBe(roleStyle(role).colour)
    expect(dataset?.borderDash).toEqual(roleStyle(role).dash)
    expect(dataset?.pointRadius).toBe(0)
  })

  it('draws only the roles present in the object', () => {
    const config = buildDemandCurveConfig([...SERIES], WEEK, {
      orderHistory: { WHOLESALER: FULL_HISTORY.WHOLESALER, FACTORY: FULL_HISTORY.FACTORY },
    })

    expect(datasetsOf(config).map((d) => d.label)).toEqual([
      orderSeriesLabel('WHOLESALER'),
      orderSeriesLabel('FACTORY'),
      DEMAND_CURVE_LABEL,
    ])
  })

  it('a role present with no closed week yet is a dataset with no data, not a missing one', () => {
    const config = buildDemandCurveConfig([...SERIES], 1, {
      orderHistory: { RETAILER: [], WHOLESALER: [], DISTRIBUTOR: [], FACTORY: [] },
    })

    expect(datasetsOf(config)).toHaveLength(5)
    for (const role of ROLE_ORDER) {
      const dataset = datasetsOf(config).find((d) => d.label === orderSeriesLabel(role))
      expect(dataset?.data).toEqual([])
    }
  })

  it('leaves the demand dataset holding the full series, whatever the overlay', () => {
    const config = buildDemandCurveConfig([...SERIES], WEEK, { orderHistory: FULL_HISTORY })

    expect(demandDataset(config).data).toEqual(SERIES)
  })
})

describe('buildDemandCurveConfig: the curve split (played solid, future faded)', () => {
  it.each([
    ['without an overlay', undefined],
    ['with an overlay', { orderHistory: FULL_HISTORY }],
  ] as const)('%s: segments up to the current week are solid DEMAND_COLOUR', (_name, options) => {
    const config = buildDemandCurveConfig([...SERIES], WEEK, options)
    const colour = segmentFn(config, 'borderColor')
    const dash = segmentFn(config, 'borderDash')

    // The current week's index is WEEK - 1 = 16. A segment whose end point is at or before it is played.
    for (const p1 of [1, 5, WEEK - 2, WEEK - 1]) {
      expect(colour(seg(p1))).toBe(DEMAND_COLOUR)
      const d = dash(seg(p1))
      expect(d === undefined || (Array.isArray(d) && d.length === 0)).toBe(true)
    }
  })

  it.each([
    ['without an overlay', undefined],
    ['with an overlay', { orderHistory: FULL_HISTORY }],
  ] as const)('%s: segments ending after the current week are faded and dashed [4, 4]', (_name, options) => {
    const config = buildDemandCurveConfig([...SERIES], WEEK, options)
    const colour = segmentFn(config, 'borderColor')
    const dash = segmentFn(config, 'borderDash')

    for (const p1 of [WEEK, WEEK + 3, DURATION - 1]) {
      expect(colour(seg(p1))).toBe(withAlpha(DEMAND_COLOUR, 0.35))
      expect(dash(seg(p1))).toEqual([4, 4])
    }
  })

  it('styles a future segment differently from a played one (acceptance 4)', () => {
    const config = buildDemandCurveConfig([...SERIES], WEEK)
    const colour = segmentFn(config, 'borderColor')
    const dash = segmentFn(config, 'borderDash')

    expect(colour(seg(WEEK))).not.toEqual(colour(seg(WEEK - 1)))
    expect(dash(seg(WEEK))).not.toEqual(dash(seg(WEEK - 1)))
  })

  it('moves the split with the current week', () => {
    const first = buildDemandCurveConfig([...SERIES], 1)
    // Week 1: index 0; every segment ends at index 1 or later, so all are future.
    expect(segmentFn(first, 'borderColor')(seg(1))).toBe(withAlpha(DEMAND_COLOUR, 0.35))

    const last = buildDemandCurveConfig([...SERIES], DURATION)
    // Week 24: index 23; the last segment ends at index 23, so none is future.
    expect(segmentFn(last, 'borderColor')(seg(DURATION - 1))).toBe(DEMAND_COLOUR)

    const mid = buildDemandCurveConfig([...SERIES], 10)
    expect(segmentFn(mid, 'borderColor')(seg(9))).toBe(DEMAND_COLOUR)
    expect(segmentFn(mid, 'borderColor')(seg(10))).toBe(withAlpha(DEMAND_COLOUR, 0.35))
  })
})

describe('buildDemandCurveConfig: the current week band', () => {
  type Opts = { plugins?: { currentWeekBand?: unknown } }

  it.each([
    ['without an overlay', undefined],
    ['with an overlay', { orderHistory: FULL_HISTORY }],
  ] as const)('%s: names the current week by index in options.plugins.currentWeekBand', (_name, options) => {
    const config = buildDemandCurveConfig([...SERIES], WEEK, options)

    expect((config.options as Opts).plugins?.currentWeekBand).toEqual({ index: WEEK - 1 })
  })

  it('follows the week it was built for', () => {
    expect((buildDemandCurveConfig([...SERIES], 3).options as Opts).plugins?.currentWeekBand).toEqual({ index: 2 })
    expect((buildDemandCurveConfig([...SERIES], 24).options as Opts).plugins?.currentWeekBand).toEqual({ index: 23 })
  })

  it('carries an inline plugin in the configuration’s plugins array', () => {
    const config = buildDemandCurveConfig([...SERIES], WEEK)

    expect(Array.isArray(config.plugins)).toBe(true)
    expect((config.plugins ?? []).length).toBeGreaterThanOrEqual(1)
  })
})

/**
 * Task 4 (2026-11-02): the projector plots only the weeks the room has already
 * seen — weeks 1 to the open week, the engine's own `customer_demand_series`
 * rule (`07 §3.8`) — while the host console keeps the whole series.
 */
describe('buildDemandCurveConfig: revealedThroughWeek (the projector)', () => {
  function pointArrays(config: ChartConfiguration<'line'>): unknown[][] {
    const demand = demandDataset(config)
    return ['pointRadius', 'pointHoverRadius', 'pointStyle', 'pointBackgroundColor', 'pointBorderWidth'].map(
      (key) => demand[key] as unknown[],
    )
  }

  it('revealedDemand is weeks 1 to the open week, the open week included', () => {
    expect(revealedDemand(SERIES, WEEK)).toEqual(SERIES.slice(0, WEEK))
    expect(revealedDemand(SERIES, 1)).toEqual([SERIES[0]])
    expect(revealedDemand(SERIES, 0)).toEqual([])
    expect(revealedDemand(SERIES, DURATION + 5)).toEqual(SERIES)
  })

  it('carries no demand value past the revealed week, in data or in any per-point array', () => {
    const config = buildDemandCurveConfig([...SERIES], WEEK, { revealedThroughWeek: WEEK })

    expect(demandDataset(config).data).toEqual(SERIES.slice(0, WEEK))
    for (const future of SERIES.slice(WEEK)) {
      expect(demandDataset(config).data as number[]).not.toContain(future)
    }
    for (const array of pointArrays(config)) expect(array).toHaveLength(WEEK)
  })

  it('still marks the open week, which is the last point plotted', () => {
    const config = buildDemandCurveConfig([...SERIES], WEEK, { revealedThroughWeek: WEEK })
    const radii = demandDataset(config).pointRadius as number[]

    expect(radii[WEEK - 1]).toBeGreaterThan(0)
    expect(radii.filter((r) => r > 0)).toHaveLength(1)
  })

  it('keeps the x axis the length of the game, so the room sees how far through it is', () => {
    const config = buildDemandCurveConfig([...SERIES], WEEK, { revealedThroughWeek: WEEK })

    expect(config.data.labels).toHaveLength(DURATION)
  })

  it.each([
    ['absent', {}],
    ['null', { revealedThroughWeek: null }],
  ] as const)('%s: the console view, the whole series future included', (_name, options) => {
    const config = buildDemandCurveConfig([...SERIES], WEEK, options)

    expect(demandDataset(config).data).toEqual(SERIES)
  })
})
