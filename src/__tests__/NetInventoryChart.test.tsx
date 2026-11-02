/**
 * BE-2 (`CHARTS-PLAN.md`), B1: `NetInventoryChart` and `buildNetInventoryConfig`.
 *
 * Covers acceptance (1) every plotted value comes from `inventory` / `backlog`
 * with no subtraction, and (6) the live path (no series) renders none of B1.
 * Failure mode: net inventory computed as `inventory - backlog`.
 *
 * `chart.js` and `react-chartjs-2` are never mocked (`21 s2.2a`). The builder
 * module is wrapped, not replaced: the real builder runs and its arguments are
 * recorded, so the component's `group` argument can be read.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

import { ROLE_ORDER } from '../types/game'
import type { Role } from '../types/game'
import { resultsViewFromResponse } from '../components/charts/chartSetup'
import type { ResultsResponse, ResultsView } from '../components/charts/chartSetup'
import { QUANTITY_COLOUR } from '../components/charts/chartTheme'
import {
  BACKLOG_SERIES_LABEL,
  STOCK_SERIES_LABEL,
  buildNetInventoryConfig,
} from '../components/results/resultsChartsConfig'
import NetInventoryChart, { NetInventoryChart as NamedNetInventoryChart } from '../components/results/NetInventoryChart'

const rec = vi.hoisted(() => ({
  net: [] as Array<{ role: unknown; group: unknown }>,
}))

vi.mock('../components/results/resultsChartsConfig', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  const build = actual.buildNetInventoryConfig as (v: unknown, r: unknown, g: unknown) => unknown
  return {
    ...actual,
    buildNetInventoryConfig: (view: unknown, role: unknown, group: unknown) => {
      rec.net.push({ role, group })
      return build(view, role, group)
    },
  }
})

beforeEach(() => {
  rec.net.length = 0
})

/* --- fixtures -------------------------------------------------------- */

const INVENTORY: Record<Role, number[]> = {
  RETAILER: [21, 17, 13, 9, 5, 3],
  WHOLESALER: [30, 26, 22, 18, 14, 10],
  DISTRIBUTOR: [41, 37, 33, 29, 25, 19],
  FACTORY: [55, 51, 47, 43, 39, 35],
}
const BACKLOG: Record<Role, number[]> = {
  RETAILER: [2, 3, 5, 6, 7, 4],
  WHOLESALER: [1, 4, 8, 9, 12, 6],
  DISTRIBUTOR: [15, 16, 14, 13, 11, 17],
  FACTORY: [18, 20, 24, 23, 22, 27],
}
const PEAK_INVENTORY: Record<Role, number> = { RETAILER: 23, WHOLESALER: 34, DISTRIBUTOR: 46, FACTORY: 58 }
const PEAK_BACKLOG: Record<Role, number> = { RETAILER: 9, WHOLESALER: 13, DISTRIBUTOR: 19, FACTORY: 31 }

function response() {
  return {
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
      total_cost: 100 + i,
      peak_inventory: PEAK_INVENTORY[role],
      peak_backlog: PEAK_BACKLOG[role],
      weeks_in_backlog: 3,
      order_variance: 20 + i,
      bullwhip_ratio: 1.5 + i,
      fill_rate: 0.9,
      average_order: 10 + i,
      orders: [5, 6, 7, 8, 9, 10].map((n) => n + i),
      inventory: INVENTORY[role],
      backlog: BACKLOG[role],
      cumulative_cost: [1, 2, 3, 4, 5, 6],
    })),
    preset_name: 'Classic MIT',
  }
}

function makeView(): ResultsView {
  return resultsViewFromResponse(response() as unknown as ResultsResponse)
}

/* --- reading a config ------------------------------------------------ */

interface Dataset {
  label?: unknown
  data?: unknown
  fill?: unknown
  borderColor?: unknown
  backgroundColor?: unknown
}
interface Cfg {
  data?: { labels?: unknown[]; datasets?: Dataset[] }
  options?: {
    scales?: Record<string, { axis?: unknown; min?: unknown; max?: unknown } | undefined>
    plugins?: {
      crosshairSync?: { group?: unknown }
      tooltip?: { callbacks?: { label?: (ctx: unknown) => unknown } }
    }
  }
}

function cfg(role: Role, group: string | null = 'g'): Cfg {
  return buildNetInventoryConfig(makeView(), role, group) as unknown as Cfg
}

function nums(dataset: Dataset | undefined): number[] {
  const raw = Array.isArray(dataset?.data) ? (dataset.data as unknown[]) : []
  return raw.map((p) => (typeof p === 'number' ? p : Number((p as { y?: unknown } | null)?.y)))
}

function byLabel(config: Cfg, label: string): Dataset {
  const found = (config.data?.datasets ?? []).filter((d) => d.label === label)
  if (found.length !== 1) throw new Error(`expected exactly one dataset labelled "${label}", found ${found.length}`)
  return found[0]
}

function yScales(config: Cfg) {
  return Object.entries(config.options?.scales ?? {}).filter(([key, value]) =>
    value && typeof value.axis === 'string' ? value.axis === 'y' : /^y/i.test(key),
  )
}

/* --- builder --------------------------------------------------------- */

describe('buildNetInventoryConfig', () => {
  it('returns exactly two datasets: on hand and backlog', () => {
    const labels = (cfg('RETAILER').data?.datasets ?? []).map((d) => d.label)
    expect(labels).toHaveLength(2)
    expect(labels).toContain(STOCK_SERIES_LABEL)
    expect(labels).toContain(BACKLOG_SERIES_LABEL)
  })

  describe.each(ROLE_ORDER)('%s', (role) => {
    it('plots on hand as the server inventory series, unchanged', () => {
      expect(nums(byLabel(cfg(role), STOCK_SERIES_LABEL))).toEqual(INVENTORY[role])
    })

    it('plots backlog as the server series with its sign flipped, element by element', () => {
      expect(nums(byLabel(cfg(role), BACKLOG_SERIES_LABEL))).toEqual(BACKLOG[role].map((b) => -b))
    })

    it('FAILURE MODE: no dataset is inventory minus backlog, or any other combination', () => {
      const net = INVENTORY[role].map((v, i) => v - BACKLOG[role][i])
      const allowed = [INVENTORY[role].join(','), BACKLOG[role].map((b) => -b).join(',')]
      for (const dataset of cfg(role).data?.datasets ?? []) {
        const series = nums(dataset)
        expect(allowed).toContain(series.join(','))
        expect(series.join(',')).not.toBe(net.join(','))
      }
    })
  })

  it('slices the inventory series to weeks_played', () => {
    const view = makeView()
    const short = { ...view, weeks_played: 4 }
    const config = buildNetInventoryConfig(short, 'FACTORY', 'g') as unknown as Cfg
    expect(nums(byLabel(config, STOCK_SERIES_LABEL))).toEqual(INVENTORY.FACTORY.slice(0, 4))
  })

  it('fills both areas to the origin, in the inventory and backlog hues', () => {
    const config = cfg('WHOLESALER')
    const stock = byLabel(config, STOCK_SERIES_LABEL)
    const backlog = byLabel(config, BACKLOG_SERIES_LABEL)
    for (const d of [stock, backlog]) expect([true, 'origin']).toContain(d.fill)
    expect(stock.backgroundColor).toBe(QUANTITY_COLOUR.inventorySoft)
    expect(stock.borderColor).toBe(QUANTITY_COLOUR.inventory)
    expect(backlog.backgroundColor).toBe(QUANTITY_COLOUR.backlogSoft)
    expect(backlog.borderColor).toBe(QUANTITY_COLOUR.backlog)
  })

  it('shares one y-range across roles, taken from the four roles peak figures', () => {
    for (const role of ROLE_ORDER) {
      const y = yScales(cfg(role))
      expect(y).toHaveLength(1)
      expect(y[0][1]?.max).toBe(Math.max(...Object.values(PEAK_INVENTORY)))
      expect(y[0][1]?.min).toBe(-Math.max(...Object.values(PEAK_BACKLOG)))
    }
  })

  it('carries the crosshair group when given one, and none when given null', () => {
    expect(cfg('RETAILER', 'chain').options?.plugins?.crosshairSync?.group).toBe('chain')
    expect(typeof cfg('RETAILER', null).options?.plugins?.crosshairSync?.group).not.toBe('string')
  })

  it('prints backlog in the tooltip as the positive server value, never the plotted negative', () => {
    const config = cfg('DISTRIBUTOR')
    const label = config.options?.plugins?.tooltip?.callbacks?.label
    if (typeof label !== 'function') {
      throw new Error('the tooltip must print values through options.plugins.tooltip.callbacks.label')
    }
    const datasets = config.data?.datasets ?? []
    const index = datasets.findIndex((d) => d.label === BACKLOG_SERIES_LABEL)
    const dataset = datasets[index]
    const raw = nums(dataset)[2]
    const ctx = {
      dataset,
      datasetIndex: index,
      dataIndex: 2,
      raw,
      parsed: { x: 2, y: raw },
      formattedValue: String(raw),
      label: '3',
    }
    const out = label(ctx)
    const text = (Array.isArray(out) ? out : [out]).join(' ')
    expect(text).toContain(String(BACKLOG.DISTRIBUTOR[2]))
    expect(text).not.toContain(String(raw))
    expect(text).toMatch(/backlog/i)
  })
})

/* --- component ------------------------------------------------------- */

function tables(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('table, [role="table"]'))
}

function cellNumbers(table: HTMLElement): number[] {
  return Array.from(table.querySelectorAll<HTMLElement>('td, th, [role="cell"], [role="rowheader"], [role="columnheader"]'))
    .map((c) => (c.textContent ?? '').replace(/[\s,$]/g, ''))
    .filter((t) => /^[-−]?\d+(?:\.\d+)?$/.test(t))
    .map((t) => Number(t.replace('−', '-')))
}

function textOutsideTables(root: HTMLElement): string[] {
  const out: string[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if ((n.parentElement as HTMLElement).closest('table, [role="table"]')) continue
    const t = (n.textContent ?? '').trim()
    if (t) out.push(t)
  }
  return out
}

describe('NetInventoryChart', () => {
  it('has a named and a default export of the same component', () => {
    expect(NamedNetInventoryChart).toBe(NetInventoryChart)
  })

  it('renders four panels, titled by role, in ROLE_ORDER', () => {
    const { container } = render(<NetInventoryChart view={makeView()} />)
    const headings = Array.from(container.querySelectorAll<HTMLElement>('h2, h3, h4')).map((h) => h.textContent ?? '')
    const seen = ROLE_ORDER.map((role) => headings.findIndex((h) => new RegExp(role, 'i').test(h)))
    expect(seen.every((i) => i >= 0)).toBe(true)
    expect([...seen].sort((a, b) => a - b)).toEqual(seen)
    expect(tables(container)).toHaveLength(4)
  })

  it('builds each panel for its role, all four in one crosshair group', () => {
    render(<NetInventoryChart view={makeView()} />)
    const latest = new Map<unknown, unknown>()
    for (const call of rec.net) latest.set(call.role, call.group)
    expect([...latest.keys()].sort()).toEqual([...ROLE_ORDER].sort())
    const groups = new Set(latest.values())
    expect(groups.size).toBe(1)
    expect(typeof [...groups][0]).toBe('string')
  })

  it('prints on hand and backlog from the server in each panel table, backlog positive', () => {
    const { container } = render(<NetInventoryChart view={makeView()} />)
    const all = tables(container)
    ROLE_ORDER.forEach((role, i) => {
      const numbers = cellNumbers(all[i])
      for (const v of INVENTORY[role]) expect(numbers).toContain(v)
      for (const b of BACKLOG[role]) expect(numbers).toContain(b)
      expect(numbers.every((n) => n >= 0)).toBe(true)
      expect(all[i].textContent).not.toMatch(/[-−]\s*\d/)
      expect(all[i].textContent).toMatch(/backlog/i)
      expect(all[i].textContent).toMatch(/on hand/i)
    })
  })

  it('puts no numeric text outside the tables', () => {
    const { container } = render(<NetInventoryChart view={makeView()} />)
    expect(textOutsideTables(container).filter((t) => /\d/.test(t))).toEqual([])
  })

  describe('ACCEPTANCE 6: the live path, with no series, renders none of it', () => {
    it('renders nothing when no role carries inventory or backlog', () => {
      const view = makeView()
      const live: ResultsView = {
        ...view,
        per_role: view.per_role.map((r) => {
          const copy = { ...r }
          delete copy.inventory
          delete copy.backlog
          delete copy.cumulative_cost
          return copy
        }),
      }
      const { container } = render(<NetInventoryChart view={live} />)
      expect(container).toBeEmptyDOMElement()
    })

    it.each(['inventory', 'backlog'] as const)('renders nothing when one role lacks %s', (field) => {
      const view = makeView()
      const partial: ResultsView = {
        ...view,
        per_role: view.per_role.map((r) => {
          if (r.role !== 'WHOLESALER') return r
          const copy = { ...r }
          delete copy[field]
          return copy
        }),
      }
      const { container } = render(<NetInventoryChart view={partial} />)
      expect(container).toBeEmptyDOMElement()
    })
  })
})
