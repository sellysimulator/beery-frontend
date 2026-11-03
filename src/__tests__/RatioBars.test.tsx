/**
 * BE-2 (`CHARTS-PLAN.md`), B2 ratio bars and B7 inline bars:
 * `BullwhipRatioBars`, `buildBullwhipRatioConfig` and `RoleStatsTable`.
 *
 * Covers acceptance (4) a `null` ratio renders the dash, (8) the ratio cell text
 * is unchanged and a positive ratio has one `aria-hidden` inline bar while a
 * `null` or `0` ratio has none, and (9) a ratio of `0` gets no bar in
 * `BullwhipRatioBars` and keeps its `0.00` in the table. Acceptance (3), a bar
 * absent until its stage, is in `BullwhipStepper.test.tsx`.
 *
 * The bars' dataset layout is not specified, so bars are read as "every finite
 * number across the datasets, in order".
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

import { ROLE_ORDER } from '../types/game'
import type { Role } from '../types/game'
import { resultsViewFromResponse } from '../components/charts/chartSetup'
import type { ResultsResponse, ResultsView } from '../components/charts/chartSetup'
import { roleStyle } from '../components/charts/chartTheme'
import { buildBullwhipRatioConfig } from '../components/results/resultsChartsConfig'
import BullwhipRatioBars, { BullwhipRatioBars as NamedBullwhipRatioBars } from '../components/results/BullwhipRatioBars'
import * as RoleStatsTableModule from '../components/results/RoleStatsTable'
import { NULL_RATIO_EXPLANATION } from '../components/results/RoleStatsTable'

const rec = vi.hoisted(() => ({ ratio: [] as unknown[] }))

vi.mock('../components/results/resultsChartsConfig', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  const build = actual.buildBullwhipRatioConfig as (v: unknown, s: unknown) => unknown
  return {
    ...actual,
    buildBullwhipRatioConfig: (view: unknown, shown: unknown) => {
      const config = build(view, shown)
      rec.ratio.push(config)
      return config
    },
  }
})

beforeEach(() => {
  rec.ratio.length = 0
})

type Ratios = Record<Role, number | null>
const RATIOS: Ratios = { RETAILER: 1.75, WHOLESALER: 3.5, DISTRIBUTOR: 6.25, FACTORY: 9.75 }

function makeView(ratios: Ratios = RATIOS): ResultsView {
  const payload = {
    room_code: 'BEERYX',
    weeks_played: 6,
    duration_weeks: 6,
    ended_early: false,
    currency_symbol: '$',
    started_at: '2026-03-04T10:00:00Z',
    finished_at: '2026-03-04T10:42:00Z',
    demand_series: [4, 4, 12, 12, 12, 12],
    chain_total_cost: 3243,
    demand_variance: 16,
    per_role: ROLE_ORDER.map((role, i) => ({
      role,
      display_name: `Player ${i}`,
      is_bot: false,
      total_cost: 411.5 + 100 * i,
      peak_inventory: 23 + 11 * i,
      peak_backlog: 9 + 4 * i,
      weeks_in_backlog: 3,
      order_variance: 31.25 + 40 * i,
      bullwhip_ratio: ratios[role],
      fill_rate: 0.9,
      average_order: 14.5 + 3 * i,
      orders: [5, 6, 7, 8, 9, 10].map((n) => n + i),
      inventory: [21, 17, 13, 9, 5, 3],
      backlog: [2, 3, 5, 6, 7, 4],
      cumulative_cost: [1, 2, 3, 4, 5, 6],
    })),
    preset_name: 'Classic MIT',
  }
  return resultsViewFromResponse(payload as unknown as ResultsResponse)
}

/* --- reading a bar config ------------------------------------------- */

interface Dataset {
  data?: unknown
  backgroundColor?: unknown
  borderColor?: unknown
}
interface Cfg {
  data?: { datasets?: Dataset[] }
  options?: { indexAxis?: unknown; scales?: Record<string, { type?: unknown; min?: unknown } | undefined> }
}

interface Bar {
  value: number
  colours: unknown[]
}

function bars(config: Cfg): Bar[] {
  const out: Bar[] = []
  for (const dataset of config.data?.datasets ?? []) {
    const raw = Array.isArray(dataset.data) ? (dataset.data as unknown[]) : []
    raw.forEach((point, i) => {
      const value = typeof point === 'number' ? point : Number((point as { x?: unknown } | null)?.x ?? Number.NaN)
      if (!Number.isFinite(value)) return
      const pick = (c: unknown) => (Array.isArray(c) ? c[i] : c)
      out.push({ value, colours: [pick(dataset.backgroundColor), pick(dataset.borderColor)] })
    })
  }
  return out
}

function build(view: ResultsView, shown: readonly Role[]): Cfg {
  return buildBullwhipRatioConfig(view, shown) as unknown as Cfg
}

/* --- the builder ----------------------------------------------------- */

describe('buildBullwhipRatioConfig', () => {
  it('has one bar per shown role, in ROLE_ORDER, whose value is the server ratio', () => {
    const got = bars(build(makeView(), ROLE_ORDER))
    expect(got.map((b) => b.value)).toEqual([1.75, 3.5, 6.25, 9.75])
  })

  it('colours each bar by its role style', () => {
    const got = bars(build(makeView(), ROLE_ORDER))
    got.forEach((bar, i) => {
      expect(bar.colours).toContain(roleStyle(ROLE_ORDER[i]).colour)
    })
  })

  it('draws only the shown roles, still in ROLE_ORDER whatever order they are passed', () => {
    expect(bars(build(makeView(), ['FACTORY', 'WHOLESALER'])).map((b) => b.value)).toEqual([3.5, 9.75])
  })

  it('draws nothing for a role that is not shown', () => {
    expect(bars(build(makeView(), ['RETAILER'])).map((b) => b.value)).toEqual([1.75])
  })

  it('leaves out a null ratio (D12)', () => {
    const view = makeView({ ...RATIOS, WHOLESALER: null })
    expect(bars(build(view, ROLE_ORDER)).map((b) => b.value)).toEqual([1.75, 6.25, 9.75])
  })

  it('ACCEPTANCE 9: gives a ratio of exactly 0 no bar', () => {
    const view = makeView({ ...RATIOS, DISTRIBUTOR: 0 })
    expect(bars(build(view, ROLE_ORDER)).map((b) => b.value)).toEqual([1.75, 3.5, 9.75])
  })

  it('is horizontal, on a logarithmic x-axis that starts at 0.1', () => {
    const config = build(makeView(), ROLE_ORDER)
    expect(config.options?.indexAxis).toBe('y')
    expect(config.options?.scales?.x?.type).toBe('logarithmic')
    expect(config.options?.scales?.x?.min).toBe(0.1)
  })
})

/* --- the component --------------------------------------------------- */

function rowsFor(container: HTMLElement, role: Role): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('tr, [role="row"]')).filter((row) =>
    new RegExp(role, 'i').test(row.textContent ?? ''),
  )
}

function strayDigits(root: HTMLElement): string[] {
  const stray: string[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if ((n.parentElement as HTMLElement).closest('table, [role="table"]')) continue
    if (/\d/.test(n.textContent ?? '')) stray.push(n.textContent ?? '')
  }
  return stray
}

describe('BullwhipRatioBars', () => {
  it('has a named and a default export of the same component', () => {
    expect(NamedBullwhipRatioBars).toBe(BullwhipRatioBars)
  })

  it('lists every shown role in its table with the ratio to two decimals, and no other role', () => {
    const { container } = render(<BullwhipRatioBars view={makeView()} shown={['RETAILER', 'DISTRIBUTOR']} />)
    expect(rowsFor(container, 'RETAILER')).toHaveLength(1)
    expect(rowsFor(container, 'RETAILER')[0].textContent).toContain('1.75')
    expect(rowsFor(container, 'DISTRIBUTOR')[0].textContent).toContain('6.25')
    expect(rowsFor(container, 'WHOLESALER')).toHaveLength(0)
    expect(rowsFor(container, 'FACTORY')).toHaveLength(0)
  })

  it('hands the builder output with exactly the shown roles as bars', () => {
    render(<BullwhipRatioBars view={makeView()} shown={['WHOLESALER', 'FACTORY']} />)
    const latest = rec.ratio[rec.ratio.length - 1] as Cfg
    expect(bars(latest).map((b) => b.value)).toEqual([3.5, 9.75])
  })

  it('carries ratios only: none of the peak figures is in its table', () => {
    const { container } = render(<BullwhipRatioBars view={makeView()} shown={ROLE_ORDER} />)
    const cells = Array.from(container.querySelectorAll('td, th')).map((c) => (c.textContent ?? '').trim())
    for (const peak of [23, 34, 45, 56, 9, 13, 17, 21]) expect(cells).not.toContain(String(peak))
  })

  describe('ACCEPTANCE 4: a null ratio renders the dash', () => {
    it('shows the D12 dash with the explanation as its aria-label, and no bar', () => {
      const view = makeView({ ...RATIOS, WHOLESALER: null })
      const { container } = render(<BullwhipRatioBars view={view} shown={ROLE_ORDER} />)
      const row = rowsFor(container, 'WHOLESALER')[0]
      expect(row.textContent).toContain('—')
      expect(row.querySelector(`[aria-label="${NULL_RATIO_EXPLANATION}"]`)).not.toBeNull()
      const latest = rec.ratio[rec.ratio.length - 1] as Cfg
      expect(bars(latest)).toHaveLength(3)
    })

    it('shows no dash for a role that has a ratio', () => {
      const { container } = render(<BullwhipRatioBars view={makeView()} shown={ROLE_ORDER} />)
      expect(container.textContent).not.toContain('—')
    })
  })

  describe('ACCEPTANCE 9: a ratio of 0 gets no bar and keeps 0.00 in the table', () => {
    it('keeps the figure, draws no bar for it, and says so in words', () => {
      const view = makeView({ ...RATIOS, RETAILER: 0 })
      const { container } = render(<BullwhipRatioBars view={view} shown={ROLE_ORDER} />)
      expect(rowsFor(container, 'RETAILER')[0].textContent).toContain('0.00')
      const latest = rec.ratio[rec.ratio.length - 1] as Cfg
      expect(bars(latest).map((b) => b.value)).toEqual([3.5, 6.25, 9.75])
      const outside = Array.from(container.childNodes)
        .filter((n) => !(n instanceof HTMLElement && n.matches('table, [role="table"]')))
        .map((n) => n.textContent ?? '')
        .join(' ')
      expect(outside).toMatch(/zero/i)
    })
  })

  it('puts no numeric text outside its table', () => {
    const view = makeView({ ...RATIOS, RETAILER: 0, FACTORY: null })
    const { container } = render(<BullwhipRatioBars view={view} shown={ROLE_ORDER} />)
    expect(strayDigits(container)).toEqual([])
  })
})

/* --- B7: inline bars in RoleStatsTable ------------------------------- */

const mod = RoleStatsTableModule as unknown as Record<string, unknown>
const RoleStatsTable = (mod.default ?? mod.RoleStatsTable) as (props: { view: ResultsView }) => React.ReactElement | null

/** Outermost aria-hidden elements with no text: the decorative bars (and any constant decoration). */
function hiddenDecor(root: HTMLElement): number {
  return Array.from(root.querySelectorAll<HTMLElement>('[aria-hidden="true"]')).filter(
    (el) => el.parentElement?.closest('[aria-hidden="true"]') == null && (el.textContent ?? '').trim() === '',
  ).length
}

function decorFor(ratios: Ratios): number {
  const { container, unmount } = render(<RoleStatsTable view={makeView(ratios)} />)
  const n = hiddenDecor(container)
  unmount()
  return n
}

const NONE: Ratios = { RETAILER: null, WHOLESALER: null, DISTRIBUTOR: null, FACTORY: null }

describe('RoleStatsTable inline ratio bars', () => {
  it('still exports NULL_RATIO_EXPLANATION as text', () => {
    expect(typeof NULL_RATIO_EXPLANATION).toBe('string')
    expect(NULL_RATIO_EXPLANATION.length).toBeGreaterThan(0)
  })

  it('ACCEPTANCE 8: leaves the ratio figure as plain text, two decimals, nothing added', () => {
    const { container } = render(<RoleStatsTable view={makeView()} />)
    const visible = (cell: HTMLElement) => {
      const copy = cell.cloneNode(true) as HTMLElement
      copy.querySelectorAll('[aria-hidden="true"]').forEach((el) => el.remove())
      return (copy.textContent ?? '').replace(/\s+/g, ' ').trim()
    }
    const cells = Array.from(container.querySelectorAll<HTMLElement>('td, th'))
    for (const figure of ['1.75', '3.50', '6.25', '9.75']) {
      const matches = cells.filter((c) => new RegExp(`^${figure.replace('.', '\\.')}(?!\\d)\\D*$`).test(visible(c)))
      expect(matches).toHaveLength(1)
    }
  })

  it('ACCEPTANCE 8: gives each positive ratio one aria-hidden bar', () => {
    expect(decorFor(RATIOS) - decorFor(NONE)).toBe(4)
  })

  it.each(ROLE_ORDER)('gives only the %s ratio a bar when only it is positive', (role) => {
    expect(decorFor({ ...NONE, [role]: 2.5 }) - decorFor(NONE)).toBe(1)
  })

  it('ACCEPTANCE 8: gives a null ratio no bar', () => {
    expect(decorFor({ ...RATIOS, WHOLESALER: null }) - decorFor(NONE)).toBe(3)
  })

  it('ACCEPTANCE 8: gives a ratio of 0 no bar, and keeps its 0.00 figure', () => {
    expect(decorFor({ ...RATIOS, WHOLESALER: 0 }) - decorFor(NONE)).toBe(3)
    const { container } = render(<RoleStatsTable view={makeView({ ...RATIOS, WHOLESALER: 0 })} />)
    expect(container.textContent).toContain('0.00')
  })

  it('draws a bar for a ratio outside the 0.1 to 1000 domain too (clamped, not dropped)', () => {
    expect(decorFor({ ...NONE, RETAILER: 0.01 }) - decorFor(NONE)).toBe(1)
    expect(decorFor({ ...NONE, FACTORY: 5000 }) - decorFor(NONE)).toBe(1)
  })
})
