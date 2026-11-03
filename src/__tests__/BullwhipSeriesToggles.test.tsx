/**
 * BE-2 (`CHARTS-PLAN.md`), B2, as amended 2026-11-02: the series switches in
 * `BullwhipChart`.
 *
 * B2 shipped as a cumulative stage stepper ("Customer", "+ Retailer", …
 * "+ Factory"), and pressing "+ Factory" showed all four stages — not what a
 * button named after one stage reads as doing. It is now one switch per
 * series, each adding or removing that series only, plus a single Show all /
 * Clear selection toggle. The role switched on last is emphasised.
 *
 * Covers: each switch changes exactly its own series; the all toggle; the
 * emphasis; and ratio bars matching the roles shown (B2's failure mode:
 * a ratio bar visible for a stage that is not in).
 *
 * `chart.js` and `react-chartjs-2` are never mocked. `chartSetup.ts` and
 * `resultsChartsConfig.ts` are wrapped, not replaced: the real builders run
 * and their arguments and results are recorded.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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

const SWITCH_NAME: Record<Role, RegExp> = {
  RETAILER: /retailer/i,
  WHOLESALER: /wholesaler/i,
  DISTRIBUTOR: /distributor/i,
  FACTORY: /factory/i,
}

function roleSwitch(role: Role): HTMLElement {
  return screen.getByRole('switch', { name: SWITCH_NAME[role] })
}

function demandSwitch(): HTMLElement {
  return screen.getByRole('switch', { name: /demand/i })
}

function allToggle(): HTMLElement {
  return screen.getByRole('button', { name: /^(show all|clear selection)$/i })
}

/** Table cells whose whole text is exactly this ratio figure. */
function ratioCells(figure: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('td, th, [role="cell"]')).filter(
    (c) => (c.textContent ?? '').replace(/\s+/g, ' ').trim() === figure,
  )
}

type User = ReturnType<typeof userEvent.setup>

async function clearSelection(user: User): Promise<void> {
  expect(allToggle()).toHaveTextContent('Clear selection')
  await user.click(allToggle())
}

/* --- the controls ---------------------------------------------------- */

describe('the series switches', () => {
  it('are five switches, demand and one per role, plus the all toggle — and no stage stepper', () => {
    render(<BullwhipChart view={makeView()} />)
    expect(demandSwitch()).toHaveAttribute('aria-checked', 'true')
    for (const role of ROLE_ORDER) expect(roleSwitch(role)).toHaveAttribute('aria-checked', 'true')
    expect(screen.getAllByRole('switch')).toHaveLength(5)
    expect(allToggle()).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: /stage by stage/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /next stage|\+ factory/i })).toBeNull()
  })

  describe('start state', () => {
    it('has every series on with no emphasis: the whole chain', () => {
      render(<BullwhipChart view={makeView()} />)
      const call = lastBuild()
      expect(call.config.data?.datasets).toHaveLength(5)
      expect(call.options?.emphasis ?? null).toBeNull()
      for (const role of ROLE_ORDER) expect(roleDataset(call, role).borderColor).toBe(roleStyle(role).colour)
      expect(allToggle()).toHaveTextContent('Clear selection')
    })

    it('shows every role`s ratio bar', () => {
      render(<BullwhipChart view={makeView()} />)
      expect(lastShown()).toEqual(ROLE_ORDER)
      for (const role of ROLE_ORDER) expect(ratioCells(RATIO[role].toFixed(2))).not.toHaveLength(0)
    })
  })

  describe('each switch changes its own series and no other', () => {
    it.each(ROLE_ORDER)('switching %s on from an empty selection plots that role alone', async (role) => {
      const user = userEvent.setup()
      render(<BullwhipChart view={makeView()} />)
      await clearSelection(user)
      await user.click(roleSwitch(role))
      const call = lastBuild()
      expect(plottedRoles(call)).toEqual([role])
      expect(call.config.data?.datasets).toHaveLength(1)
      expect(call.view.per_role.map((r) => r.role)).toEqual([role])
    })

    it('FACTORY on its own is the Factory alone, never the whole chain', async () => {
      const user = userEvent.setup()
      render(<BullwhipChart view={makeView()} />)
      await clearSelection(user)
      await user.click(demandSwitch())
      await user.click(roleSwitch('FACTORY'))
      expect(plottedRoles(lastBuild())).toEqual(['FACTORY'])
      expect(demandDataset(lastBuild())).toBeDefined()
      for (const role of ['RETAILER', 'WHOLESALER', 'DISTRIBUTOR'] as const) {
        expect(roleSwitch(role)).toHaveAttribute('aria-checked', 'false')
      }
    })

    it('switching one role off from the full chain leaves the other three', async () => {
      const user = userEvent.setup()
      render(<BullwhipChart view={makeView()} />)
      await user.click(roleSwitch('WHOLESALER'))
      expect(plottedRoles(lastBuild())).toEqual(['RETAILER', 'DISTRIBUTOR', 'FACTORY'])
      expect(demandDataset(lastBuild())).toBeDefined()
    })

    it('brings the chain in one stage at a time, in whatever order the host picks', async () => {
      const user = userEvent.setup()
      render(<BullwhipChart view={makeView()} />)
      await clearSelection(user)
      await user.click(demandSwitch())
      const steps: Role[] = []
      for (const role of ROLE_ORDER) {
        await user.click(roleSwitch(role))
        steps.push(role)
        expect(plottedRoles(lastBuild())).toEqual(steps)
      }
    })
  })

  describe('the all toggle', () => {
    it('Clear selection switches every series off and says so', async () => {
      const user = userEvent.setup()
      render(<BullwhipChart view={makeView()} />)
      await clearSelection(user)
      expect(lastBuild().config.data?.datasets).toHaveLength(0)
      expect(screen.getAllByRole('switch').every((s) => s.getAttribute('aria-checked') === 'false')).toBe(true)
      expect(screen.getByRole('status')).toHaveTextContent(/nothing is selected/i)
      expect(allToggle()).toHaveTextContent('Show all')
    })

    it('Show all brings every series back from any partial selection', async () => {
      const user = userEvent.setup()
      render(<BullwhipChart view={makeView()} />)
      await user.click(roleSwitch('RETAILER'))
      expect(allToggle()).toHaveTextContent('Show all')
      await user.click(allToggle())
      expect(lastBuild().config.data?.datasets).toHaveLength(5)
      expect(allToggle()).toHaveTextContent('Clear selection')
    })
  })

  describe('emphasis', () => {
    it('emphasises the role switched on last and fades the others', async () => {
      const user = userEvent.setup()
      render(<BullwhipChart view={makeView()} />)
      await clearSelection(user)
      await user.click(roleSwitch('RETAILER'))
      await user.click(roleSwitch('DISTRIBUTOR'))
      const call = lastBuild()
      expect(call.options?.emphasis).toBe('DISTRIBUTOR')
      expect(roleDataset(call, 'DISTRIBUTOR').borderColor).toBe(roleStyle('DISTRIBUTOR').colour)
      expect(roleDataset(call, 'RETAILER').borderColor).toBe(withAlpha(roleStyle('RETAILER').colour, 0.35))
    })

    it('gives no emphasis to a role shown on its own', async () => {
      const user = userEvent.setup()
      render(<BullwhipChart view={makeView()} />)
      await clearSelection(user)
      await user.click(roleSwitch('FACTORY'))
      expect(lastBuild().options?.emphasis ?? null).toBeNull()
    })

    it('drops the emphasis when that role is switched off, or on Show all', async () => {
      const user = userEvent.setup()
      render(<BullwhipChart view={makeView()} />)
      await clearSelection(user)
      await user.click(roleSwitch('RETAILER'))
      await user.click(roleSwitch('WHOLESALER'))
      await user.click(roleSwitch('WHOLESALER'))
      expect(lastBuild().options?.emphasis ?? null).toBeNull()

      await user.click(roleSwitch('WHOLESALER'))
      expect(lastBuild().options?.emphasis).toBe('WHOLESALER')
      await user.click(allToggle())
      expect(lastBuild().options?.emphasis ?? null).toBeNull()
    })

    it('draws demand at full strength whatever is emphasised', async () => {
      const user = userEvent.setup()
      render(<BullwhipChart view={makeView()} />)
      await clearSelection(user)
      await user.click(demandSwitch())
      for (const role of ROLE_ORDER) {
        await user.click(roleSwitch(role))
        expect(demandDataset(lastBuild()).borderColor).toBe(DEMAND_COLOUR)
      }
    })
  })
})

/* --- ratio bars ------------------------------------------------------ */

describe('FAILURE MODE: a role`s ratio bar is shown exactly when its series is', () => {
  it('has no bars once the selection is cleared', async () => {
    const user = userEvent.setup()
    render(<BullwhipChart view={makeView()} />)
    await clearSelection(user)
    for (const role of ROLE_ORDER) expect(ratioCells(RATIO[role].toFixed(2))).toHaveLength(0)
  })

  it('brings back only the bar of the role switched on', async () => {
    const user = userEvent.setup()
    render(<BullwhipChart view={makeView()} />)
    await clearSelection(user)
    await user.click(roleSwitch('FACTORY'))
    expect(lastShown()).toEqual(['FACTORY'])
    expect(ratioCells(RATIO.FACTORY.toFixed(2)).length).toBeGreaterThan(0)
    for (const role of ['RETAILER', 'WHOLESALER', 'DISTRIBUTOR'] as const) {
      expect(ratioCells(RATIO[role].toFixed(2))).toHaveLength(0)
    }
  })

  it('hands the bar builder exactly the shown roles', async () => {
    const user = userEvent.setup()
    render(<BullwhipChart view={makeView()} />)
    await user.click(roleSwitch('WHOLESALER'))
    expect(lastShown()).toEqual(['RETAILER', 'DISTRIBUTOR', 'FACTORY'])
    const last = rec.ratio[rec.ratio.length - 1]
    const data = (last.config as { data?: { datasets?: Array<{ data?: unknown }> } }).data?.datasets ?? []
    const values = data.flatMap((d) => (Array.isArray(d.data) ? (d.data as unknown[]) : []))
    const numeric = values
      .map((v) => (typeof v === 'number' ? v : Number((v as { x?: unknown } | null)?.x)))
      .filter(Number.isFinite)
    expect(numeric).toEqual([RATIO.RETAILER, RATIO.DISTRIBUTOR, RATIO.FACTORY])
  })
})
