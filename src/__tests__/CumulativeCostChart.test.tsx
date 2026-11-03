/**
 * BE-2 (`CHARTS-PLAN.md`), B3: `CumulativeCostChart` and `buildCumulativeCostConfig`.
 *
 * Covers acceptance (5) cumulative cost is hidden before Reveal, and (6) the
 * live path renders none of B3. Failure mode: the cost race visible before Reveal.
 */
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import { ROLE_ORDER } from '../types/game'
import type { Role } from '../types/game'
import { resultsViewFromResponse } from '../components/charts/chartSetup'
import type { ResultsResponse, ResultsView } from '../components/charts/chartSetup'
import { roleStyle } from '../components/charts/chartTheme'
import { buildCumulativeCostConfig } from '../components/results/resultsChartsConfig'
import CumulativeCostChart, { CumulativeCostChart as NamedCumulativeCostChart } from '../components/results/CumulativeCostChart'

const CUMULATIVE: Record<Role, number[]> = {
  RETAILER: [68.5, 137.25, 205.75, 274.5, 343.25, 412.5],
  WHOLESALER: [71, 150.5, 232, 311.75, 399.25, 480],
  DISTRIBUTOR: [80.25, 171, 262.5, 360, 455.75, 561.5],
  FACTORY: [90, 190.75, 301.25, 410, 530.5, 640.25],
}

function makeView(symbol = '$'): ResultsView {
  const payload = {
    room_code: 'BEERYX',
    weeks_played: 6,
    duration_weeks: 6,
    ended_early: false,
    currency_symbol: symbol,
    started_at: '2026-03-04T10:00:00Z',
    finished_at: '2026-03-04T10:42:00Z',
    demand_series: [4, 4, 12, 12, 12, 12],
    chain_total_cost: 3243,
    demand_variance: 16,
    per_role: ROLE_ORDER.map((role, i) => ({
      role,
      display_name: `Player ${i}`,
      is_bot: false,
      total_cost: 700 + i,
      peak_inventory: 23 + i,
      peak_backlog: 9 + i,
      weeks_in_backlog: 3,
      order_variance: 20 + i,
      bullwhip_ratio: 1.5 + i,
      fill_rate: 0.9,
      average_order: 10 + i,
      orders: [5, 6, 7, 8, 9, 10].map((n) => n + i),
      inventory: [21, 17, 13, 9, 5, 3],
      backlog: [2, 3, 5, 6, 7, 4],
      cumulative_cost: CUMULATIVE[role],
    })),
    preset_name: 'Classic MIT',
  }
  return resultsViewFromResponse(payload as unknown as ResultsResponse)
}

interface Dataset {
  label?: unknown
  data?: unknown
  borderColor?: unknown
  borderDash?: unknown
}
interface Cfg {
  data?: { datasets?: Dataset[] }
  options?: { scales?: Record<string, { axis?: unknown; title?: { text?: unknown } } | undefined> }
}

function nums(dataset: Dataset): number[] {
  const raw = Array.isArray(dataset.data) ? (dataset.data as unknown[]) : []
  return raw.map((p) => (typeof p === 'number' ? p : Number((p as { y?: unknown } | null)?.y)))
}

function forRole(config: Cfg, role: Role): Dataset {
  const found = (config.data?.datasets ?? []).filter((d) => new RegExp(role, 'i').test(String(d.label ?? '')))
  if (found.length !== 1) throw new Error(`expected one ${role} line, found ${found.length}`)
  return found[0]
}

describe('buildCumulativeCostConfig', () => {
  const config = buildCumulativeCostConfig(makeView()) as unknown as Cfg

  it('draws one line per role, and nothing else', () => {
    expect(config.data?.datasets).toHaveLength(4)
  })

  it.each(ROLE_ORDER)('draws the %s line from its server cumulative_cost, in its colour and dash', (role) => {
    const line = forRole(config, role)
    expect(nums(line)).toEqual(CUMULATIVE[role])
    expect(line.borderColor).toBe(roleStyle(role).colour)
    expect(line.borderDash).toEqual(roleStyle(role).dash)
  })

  it.each(['$', '€'])('names the currency %s in the y-axis title', (symbol) => {
    const c = buildCumulativeCostConfig(makeView(symbol)) as unknown as Cfg
    const y = Object.entries(c.options?.scales ?? {}).filter(([k, v]) =>
      v && typeof v.axis === 'string' ? v.axis === 'y' : /^y/i.test(k),
    )
    expect(y).toHaveLength(1)
    expect(String(y[0][1]?.title?.text)).toContain(symbol)
  })
})

function tableNumbers(root: ParentNode): number[] {
  return Array.from(root.querySelectorAll<HTMLElement>('table td, table th, [role="cell"], [role="rowheader"]'))
    .map((c) => (c.textContent ?? '').replace(/[\s,$€]/g, ''))
    .filter((t) => /^-?\d+(?:\.\d+)?$/.test(t))
    .map(Number)
}

describe('CumulativeCostChart', () => {
  it('has a named and a default export of the same component', () => {
    expect(NamedCumulativeCostChart).toBe(CumulativeCostChart)
  })

  describe('FAILURE MODE / ACCEPTANCE 5: the cost race stays hidden until Reveal', () => {
    it('renders nothing while revealed is false', () => {
      const { container } = render(<CumulativeCostChart view={makeView()} revealed={false} />)
      expect(container).toBeEmptyDOMElement()
    })

    it('appears when revealed turns true, and goes again when it turns false', () => {
      const view = makeView()
      const { container, rerender } = render(<CumulativeCostChart view={view} revealed={false} />)
      expect(container).toBeEmptyDOMElement()
      rerender(<CumulativeCostChart view={view} revealed />)
      expect(container).not.toBeEmptyDOMElement()
      rerender(<CumulativeCostChart view={view} revealed={false} />)
      expect(container).toBeEmptyDOMElement()
    })

    it('leaks no cumulative figure into the page before Reveal', () => {
      const { container } = render(<CumulativeCostChart view={makeView()} revealed={false} />)
      expect(container.textContent).toBe('')
    })
  })

  it('prints the server cumulative_cost values in its table once revealed', () => {
    const { container } = render(<CumulativeCostChart view={makeView()} revealed />)
    const numbers = tableNumbers(container)
    for (const role of ROLE_ORDER) for (const v of CUMULATIVE[role]) expect(numbers).toContain(v)
  })

  it('puts no numeric text outside its table', () => {
    const { container } = render(<CumulativeCostChart view={makeView()} revealed />)
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    const stray: string[] = []
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if ((n.parentElement as HTMLElement).closest('table, [role="table"]')) continue
      if (/\d/.test(n.textContent ?? '')) stray.push(n.textContent ?? '')
    }
    expect(stray).toEqual([])
  })

  describe('ACCEPTANCE 6: the live path, with no series, renders none of it', () => {
    it('renders nothing when no role has cumulative_cost, even when revealed', () => {
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
      const { container } = render(<CumulativeCostChart view={live} revealed />)
      expect(container).toBeEmptyDOMElement()
    })

    it('renders nothing when a single role lacks cumulative_cost', () => {
      const view = makeView()
      const partial: ResultsView = {
        ...view,
        per_role: view.per_role.map((r) => {
          if (r.role !== 'DISTRIBUTOR') return r
          const copy = { ...r }
          delete copy.cumulative_cost
          return copy
        }),
      }
      const { container } = render(<CumulativeCostChart view={partial} revealed />)
      expect(container).toBeEmptyDOMElement()
    })
  })
})
