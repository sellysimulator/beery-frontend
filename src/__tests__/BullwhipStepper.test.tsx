/**
 * BE-2 (`CHARTS-PLAN.md`), B2: the stage stepper in `BullwhipChart`.
 *
 * Covers acceptance (2) stage k hands `buildBullwhipConfig` exactly k role
 * series plus demand, and (3) a ratio bar is absent until its stage is in.
 * Failure mode: ratio bars visible before their stage. Acceptance (7), the
 * criterion-7 legend tests, is `BullwhipChart.test.tsx`, run unchanged.
 *
 * `chart.js` and `react-chartjs-2` are never mocked. `chartSetup.ts` and
 * `resultsChartsConfig.ts` are wrapped, not replaced: the real builders run
 * and their arguments and results are recorded.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ROLE_ORDER } from '../types/game'
import type { Role } from '../types/game'
import { resultsViewFromResponse } from '../components/charts/chartSetup'
import type { ResultsResponse, ResultsView } from '../components/charts/chartSetup'
import { DEMAND_COLOUR, roleStyle, withAlpha } from '../components/charts/chartTheme'
import BullwhipChart from '../components/results/BullwhipChart'

interface BuildCall {
  view: ResultsView
  options: { emphasis?: Role | null } | undefined
  config: Cfg
}

const rec = vi.hoisted(() => ({
  bullwhip: [] as unknown[],
  ratio: [] as Array<{ shown: unknown; config: unknown }>,
}))

vi.mock('../components/charts/chartSetup', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  const build = actual.buildBullwhipConfig as (v: unknown, o?: unknown) => unknown
  return {
    ...actual,
    buildBullwhipConfig: (view: unknown, options?: unknown) => {
      const config = build(view, options)
      rec.bullwhip.push({ view, options, config })
      return config
    },
  }
})

vi.mock('../components/results/resultsChartsConfig', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  const build = actual.buildBullwhipRatioConfig as (v: unknown, s: unknown) => unknown
  return {
    ...actual,
    buildBullwhipRatioConfig: (view: unknown, shown: unknown) => {
      const config = build(view, shown)
      rec.ratio.push({ shown, config })
      return config
    },
  }
})

beforeEach(() => {
  rec.bullwhip.length = 0
  rec.ratio.length = 0
})

/* --- fixtures -------------------------------------------------------- */

const RATIO: Record<Role, number> = { RETAILER: 1.75, WHOLESALER: 3.5, DISTRIBUTOR: 6.25, FACTORY: 9.75 }

function makeView(): ResultsView {
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
      bullwhip_ratio: RATIO[role],
      fill_rate: 0.9,
      average_order: 14.5 + 3 * i,
      orders: [5, 6, 7, 8, 9, 10].map((n) => n * (i + 2) + i),
      inventory: [21, 17, 13, 9, 5, 3],
      backlog: [2, 3, 5, 6, 7, 4],
      cumulative_cost: [1, 2, 3, 4, 5, 6],
    })),
    preset_name: 'Classic MIT',
  }
  return resultsViewFromResponse(payload as unknown as ResultsResponse)
}

/* --- reading the recorders ------------------------------------------- */

interface Dataset {
  label?: unknown
  borderColor?: unknown
}
interface Cfg {
  data?: { datasets?: Dataset[] }
}

function lastBuild(): BuildCall {
  const last = rec.bullwhip[rec.bullwhip.length - 1] as BuildCall | undefined
  if (!last) throw new Error('buildBullwhipConfig was never called')
  return last
}

function labels(call: BuildCall): string[] {
  return (call.config.data?.datasets ?? []).map((d) => String(d.label ?? ''))
}

function roleDataset(call: BuildCall, role: Role): Dataset {
  const found = (call.config.data?.datasets ?? []).filter(
    (d) => new RegExp(role, 'i').test(String(d.label ?? '')) && !/demand/i.test(String(d.label ?? '')),
  )
  if (found.length !== 1) throw new Error(`expected one ${role} series, found ${found.length}`)
  return found[0]
}

function demandDataset(call: BuildCall): Dataset {
  const found = (call.config.data?.datasets ?? []).filter((d) => /demand/i.test(String(d.label ?? '')))
  if (found.length !== 1) throw new Error(`expected one demand series, found ${found.length}`)
  return found[0]
}

/** Roles whose series the last configuration plots, in the order plotted. */
function plottedRoles(call: BuildCall): Role[] {
  return ROLE_ORDER.filter((role) =>
    labels(call).some((l) => new RegExp(role, 'i').test(l) && !/demand/i.test(l)),
  )
}

/** The `shown` roles the ratio builder was last given, read from the bars it returned. */
function lastShown(): Role[] | null {
  const last = rec.ratio[rec.ratio.length - 1]
  return last ? (last.shown as Role[]) : null
}

const STAGES = ['Customer', '+ Retailer', '+ Wholesaler', '+ Distributor', '+ Factory'] as const

function stepper(): HTMLElement {
  return screen.getByRole('group', { name: 'Bring the chain in stage by stage' })
}

function stageButton(k: number): HTMLElement {
  return within(stepper()).getByRole('button', { name: STAGES[k] })
}

function nextButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Next stage' })
}

function pressed(): number[] {
  return STAGES.map((_, k) => stageButton(k).getAttribute('aria-pressed') === 'true' ? k : -1).filter((k) => k >= 0)
}

/** Table cells whose whole text is exactly this ratio figure. */
function ratioCells(figure: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('td, th, [role="cell"]')).filter(
    (c) => (c.textContent ?? '').replace(/\s+/g, ' ').trim() === figure,
  )
}

function expectStage(k: number): void {
  const call = lastBuild()
  expect(pressed()).toEqual([k])
  expect(plottedRoles(call)).toEqual(ROLE_ORDER.slice(0, k))
  expect(call.config.data?.datasets).toHaveLength(k + 1)
  expect(demandDataset(call)).toBeDefined()
  expect(call.view.per_role.map((r) => r.role)).toEqual(ROLE_ORDER.slice(0, k))
}

/* --- the stepper's markup -------------------------------------------- */

describe('the stage stepper', () => {
  it('is a group of five stage buttons, each with aria-pressed, plus Next stage', () => {
    render(<BullwhipChart view={makeView()} />)
    for (let k = 0; k < STAGES.length; k += 1) {
      expect(stageButton(k)).toHaveAttribute('aria-pressed')
    }
    expect(within(stepper()).getAllByRole('button').length).toBeGreaterThanOrEqual(5)
    expect(nextButton()).toBeInTheDocument()
  })

  it('carries no numeric text', () => {
    render(<BullwhipChart view={makeView()} />)
    expect(stepper().textContent ?? '').not.toMatch(/\d/)
  })

  describe('start state', () => {
    it('has no stage pressed and every series on with no emphasis: today`s chart', () => {
      render(<BullwhipChart view={makeView()} />)
      expect(pressed()).toEqual([])
      const call = lastBuild()
      expect(call.config.data?.datasets).toHaveLength(5)
      expect(call.options?.emphasis ?? null).toBeNull()
      for (const role of ROLE_ORDER) expect(roleDataset(call, role).borderColor).toBe(roleStyle(role).colour)
      expect(nextButton()).toBeEnabled()
    })

    it('shows every role`s ratio bar', () => {
      render(<BullwhipChart view={makeView()} />)
      expect(lastShown()).toEqual(ROLE_ORDER)
      for (const role of ROLE_ORDER) expect(ratioCells(RATIO[role].toFixed(2))).not.toHaveLength(0)
    })
  })

  describe('ACCEPTANCE 2: stage k hands the builder exactly k role series plus demand', () => {
    it.each([0, 1, 2, 3, 4])('stage %i', async (k) => {
      const user = userEvent.setup()
      render(<BullwhipChart view={makeView()} />)
      await user.click(stageButton(k))
      expectStage(k)
    })

    it('can step backwards by pressing an earlier stage', async () => {
      const user = userEvent.setup()
      render(<BullwhipChart view={makeView()} />)
      await user.click(stageButton(4))
      await user.click(stageButton(1))
      expectStage(1)
    })
  })

  describe('Next stage', () => {
    it('goes to stage 0 from the start, then up one stage per press', async () => {
      const user = userEvent.setup()
      render(<BullwhipChart view={makeView()} />)
      for (let k = 0; k <= 4; k += 1) {
        await user.click(nextButton())
        expectStage(k)
      }
    })

    it('is disabled at stage 4, and not before', async () => {
      const user = userEvent.setup()
      render(<BullwhipChart view={makeView()} />)
      await user.click(stageButton(3))
      expect(nextButton()).toBeEnabled()
      await user.click(stageButton(4))
      expect(nextButton()).toBeDisabled()
    })
  })

  describe('emphasis', () => {
    it('gives no emphasis at stage 0', async () => {
      const user = userEvent.setup()
      render(<BullwhipChart view={makeView()} />)
      await user.click(stageButton(0))
      expect(lastBuild().options?.emphasis ?? null).toBeNull()
    })

    it.each([1, 2, 3, 4])('at stage %i emphasises the newest role and fades the earlier ones', async (k) => {
      const user = userEvent.setup()
      render(<BullwhipChart view={makeView()} />)
      await user.click(stageButton(k))
      const call = lastBuild()
      expect(call.options?.emphasis).toBe(ROLE_ORDER[k - 1])
      ROLE_ORDER.slice(0, k).forEach((role, i) => {
        const full = roleStyle(role).colour
        expect(roleDataset(call, role).borderColor).toBe(i === k - 1 ? full : withAlpha(full, 0.35))
      })
    })

    it('draws demand at full strength at every stage', async () => {
      const user = userEvent.setup()
      render(<BullwhipChart view={makeView()} />)
      const start = demandDataset(lastBuild()).borderColor
      expect(start).toBe(DEMAND_COLOUR)
      for (let k = 0; k <= 4; k += 1) {
        await user.click(stageButton(k))
        expect(demandDataset(lastBuild()).borderColor).toBe(start)
      }
    })
  })

  describe('legend switches', () => {
    it('leave stepping mode: no stage pressed, the hidden set as edited, no emphasis', async () => {
      const user = userEvent.setup()
      render(<BullwhipChart view={makeView()} />)
      await user.click(stageButton(2))
      expect(plottedRoles(lastBuild())).toEqual(['RETAILER', 'WHOLESALER'])

      await user.click(screen.getByRole('switch', { name: /factory/i }))

      expect(pressed()).toEqual([])
      const call = lastBuild()
      expect(plottedRoles(call)).toEqual(['RETAILER', 'WHOLESALER', 'FACTORY'])
      expect(call.options?.emphasis ?? null).toBeNull()
      for (const role of plottedRoles(call)) expect(roleDataset(call, role).borderColor).toBe(roleStyle(role).colour)
    })

    it('leave stepping mode when a series is switched off, too', async () => {
      const user = userEvent.setup()
      render(<BullwhipChart view={makeView()} />)
      await user.click(stageButton(3))
      await user.click(screen.getByRole('switch', { name: /retailer/i }))
      expect(pressed()).toEqual([])
      expect(plottedRoles(lastBuild())).toEqual(['WHOLESALER', 'DISTRIBUTOR'])
    })

    it('allow Next stage to resume from no stage at stage 0', async () => {
      const user = userEvent.setup()
      render(<BullwhipChart view={makeView()} />)
      await user.click(stageButton(3))
      await user.click(screen.getByRole('switch', { name: /factory/i }))
      await user.click(nextButton())
      expectStage(0)
    })
  })
})

/* --- ratio bars ------------------------------------------------------ */

describe('ratio bars come in with their stage', () => {
  describe('FAILURE MODE / ACCEPTANCE 3: a role`s ratio bar is absent until its stage is in', () => {
    it.each([0, 1, 2, 3, 4])('at stage %i only the first k roles are shown', async (k) => {
      const user = userEvent.setup()
      render(<BullwhipChart view={makeView()} />)
      const before = lastShown()
      rec.ratio.length = 0
      await user.click(stageButton(k))
      // With no role shown the bars may not be built at all.
      const now = rec.ratio.length > 0 ? lastShown() : k === 0 ? [] : before
      expect(now).toEqual(ROLE_ORDER.slice(0, k))
      ROLE_ORDER.forEach((role, i) => {
        const cells = ratioCells(RATIO[role].toFixed(2))
        if (i < k) expect(cells.length).toBeGreaterThan(0)
        else expect(cells).toHaveLength(0)
      })
    })

    it('hands the bar builder a view whose bars match the shown roles at each stage', async () => {
      const user = userEvent.setup()
      render(<BullwhipChart view={makeView()} />)
      await user.click(stageButton(2))
      const last = rec.ratio[rec.ratio.length - 1]
      const data = (last.config as { data?: { datasets?: Array<{ data?: unknown }> } }).data?.datasets ?? []
      const values = data.flatMap((d) => (Array.isArray(d.data) ? (d.data as unknown[]) : []))
      const numeric = values.map((v) => (typeof v === 'number' ? v : Number((v as { x?: unknown } | null)?.x))).filter(Number.isFinite)
      expect(numeric).toEqual([RATIO.RETAILER, RATIO.WHOLESALER])
    })

    it('brings a role`s bar back when its legend switch is turned on', async () => {
      const user = userEvent.setup()
      render(<BullwhipChart view={makeView()} />)
      await user.click(stageButton(1))
      expect(ratioCells(RATIO.FACTORY.toFixed(2))).toHaveLength(0)
      await user.click(screen.getByRole('switch', { name: /factory/i }))
      expect(ratioCells(RATIO.FACTORY.toFixed(2)).length).toBeGreaterThan(0)
    })
  })
})
