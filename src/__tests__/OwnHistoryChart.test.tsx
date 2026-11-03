/**
 * BE-3 (`CHARTS-PLAN.md`): the player's history, as two panels in one
 * crosshair group.
 *
 * Covers acceptance (1) every plotted value is a `WeekRecord` field, (2) the
 * supply line is a stacked dataset on top of on hand rather than a summed
 * series, (3) the orders panel shows both series, (4) the tables list the five
 * fields per week; and the failure modes "inventory position computed as a
 * sum" and "another role's history leaking in".
 *
 * `chart.js` and `react-chartjs-2` are never mocked. The builders are pure, so
 * the configuration is asserted directly, and the tables are the DOM surface.
 */
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { TooltipItem } from 'chart.js'
import type { WeekRecord } from '../types/game'
import OwnHistoryChart, { OwnHistoryChart as NamedOwnHistoryChart } from '../components/game/OwnHistoryChart'
import {
  BACKLOG_LABEL,
  ON_HAND_LABEL,
  ON_THE_WAY_LABEL,
  PLACED_LABEL,
  RECEIVED_LABEL,
  buildOwnOrdersConfig,
  buildOwnStockConfig,
} from '../components/game/ownHistoryConfig'

/*
 * Every figure is distinctive and no field equals the sum of two others, so a
 * summed series, a swapped column or a stray field cannot pass by coincidence.
 * The fields that are NOT part of the history (opening, shipped, costs) carry
 * their own distinctive numbers so a leak of any of them is visible.
 */
const ON_HAND = [1101, 1102, 1103]
const BACKLOG = [2201, 2202, 2203]
const ON_THE_WAY = [3301, 3302, 3303]
const RECEIVED = [4401, 4402, 4403]
const PLACED = [5501, 5502, 5503]
const NOT_PLOTTED = [9101, 9102, 9103, 9104, 9105, 9106, 9107, 9108]

function history(role: WeekRecord['role'] = 'RETAILER'): WeekRecord[] {
  return ON_HAND.map((onHand, index) => ({
    role,
    week: index + 1,
    opening_inventory: NOT_PLOTTED[0] + index * 10,
    opening_backlog: NOT_PLOTTED[1] + index * 10,
    arrived: NOT_PLOTTED[2] + index * 10,
    incoming_order: RECEIVED[index],
    obligation: NOT_PLOTTED[3] + index * 10,
    shipped: NOT_PLOTTED[4] + index * 10,
    unfulfilled: NOT_PLOTTED[5] + index * 10,
    closing_inventory: onHand,
    closing_backlog: BACKLOG[index],
    supply_line_after: ON_THE_WAY[index],
    orders_in_flight_after: NOT_PLOTTED[6] + index * 10,
    order: PLACED[index],
    was_bot: false,
    was_forced: false,
    holding_cost: NOT_PLOTTED[7] + index * 10,
    backlog_cost: 0,
    fixed_order_cost: 0,
    purchase_cost: 0,
    total_week_cost: 0,
    cumulative_cost: 0,
    production_started: null,
    production_queued: null,
  }))
}

function dataset(config: ReturnType<typeof buildOwnStockConfig>, label: string) {
  const found = config.data.datasets.find((d) => d.label === label)
  if (!found) throw new Error(`no dataset labelled "${label}"`)
  return found
}

function tooltipLabel(
  config: ReturnType<typeof buildOwnStockConfig>,
  label: string,
  dataIndex: number,
): string {
  const found = dataset(config, label)
  const callback = config.options?.plugins?.tooltip?.callbacks?.label
  if (!callback) throw new Error('the stock panel needs a tooltip label callback')
  const item = {
    dataset: found,
    datasetIndex: config.data.datasets.indexOf(found),
    dataIndex,
    parsed: { x: dataIndex, y: (found.data as number[])[dataIndex] },
    raw: (found.data as number[])[dataIndex],
    formattedValue: String((found.data as number[])[dataIndex]),
  } as unknown as TooltipItem<'line'>
  // Chart.js calls it with the item as `this` context's first argument.
  return String(callback.call({} as never, item))
}

function figuresIn(text: string, figure: number): number {
  return text.split(String(figure)).length - 1
}

describe('exports', () => {
  it('exposes the component as a named and a default export', () => {
    expect(OwnHistoryChart).toBe(NamedOwnHistoryChart)
  })

  it('pins the five labels', () => {
    expect(ON_HAND_LABEL).toBe('On hand')
    expect(BACKLOG_LABEL).toBe('Backlog (owed)')
    expect(ON_THE_WAY_LABEL).toBe('On the way')
    expect(RECEIVED_LABEL).toBe('Orders you received')
    expect(PLACED_LABEL).toBe('Orders you placed')
  })
})

describe('buildOwnStockConfig', () => {
  const config = buildOwnStockConfig(history(), 'g')

  it('is a line chart labelled by week', () => {
    expect(config.type).toBe('line')
    expect(config.data.labels).toEqual(['1', '2', '3'])
  })

  it('has exactly three datasets: on hand, on the way, backlog', () => {
    expect(config.data.datasets.map((d) => d.label).sort()).toEqual(
      [ON_HAND_LABEL, ON_THE_WAY_LABEL, BACKLOG_LABEL].sort(),
    )
  })

  it('on hand is closing_inventory, filled to the origin', () => {
    const onHand = dataset(config, ON_HAND_LABEL)
    expect(onHand.data).toEqual(ON_HAND)
    expect(onHand.fill).toBe('origin')
  })

  it('AC 2 / FM 1: on the way is supply_line_after exactly, never a sum', () => {
    const onTheWay = dataset(config, ON_THE_WAY_LABEL)
    expect(onTheWay.data).toEqual(ON_THE_WAY)
    // The inventory position, as a sum, is the bug this guards against.
    const summed = ON_HAND.map((v, i) => v + ON_THE_WAY[i])
    for (const d of config.data.datasets) expect(d.data).not.toEqual(summed)
    for (const d of config.data.datasets) {
      expect((d.data as number[]).some((v) => summed.includes(v))).toBe(false)
    }
  })

  it('AC 2: on the way shares on hand’s stack and fills to the dataset below it', () => {
    const onHand = dataset(config, ON_HAND_LABEL)
    const onTheWay = dataset(config, ON_THE_WAY_LABEL)
    expect(onHand.stack).toBeTruthy()
    expect(onTheWay.stack).toBe(onHand.stack)
    // On hand is drawn first, so the dataset below on the way is "-1".
    expect(config.data.datasets.indexOf(onTheWay)).toBe(config.data.datasets.indexOf(onHand) + 1)
    expect(onTheWay.fill).toBe('-1')
  })

  it('backlog is closing_backlog with its sign flipped, in a separate stack', () => {
    const backlog = dataset(config, BACKLOG_LABEL)
    expect(backlog.data).toEqual(BACKLOG.map((v) => -v))
    expect(backlog.stack).toBeTruthy()
    expect(backlog.stack).not.toBe(dataset(config, ON_HAND_LABEL).stack)
  })

  it('has one stacked y-axis', () => {
    const scales = config.options?.scales ?? {}
    expect(Object.keys(scales).filter((key) => key !== 'x')).toEqual(['y'])
    expect((scales.y as { stacked?: boolean }).stacked).toBe(true)
  })

  it('the tooltip prints the server’s values, not the flipped or stacked ones', () => {
    const backlog = tooltipLabel(config, BACKLOG_LABEL, 1)
    expect(backlog).toContain(String(BACKLOG[1]))
    expect(backlog).not.toContain('-')
    expect(tooltipLabel(config, ON_THE_WAY_LABEL, 2)).toContain(String(ON_THE_WAY[2]))
    expect(tooltipLabel(config, ON_HAND_LABEL, 0)).toContain(String(ON_HAND[0]))
  })

  it('reads by index so hovering a week shows all three', () => {
    expect(config.options?.interaction).toMatchObject({ mode: 'index', intersect: false })
  })

  it('does not draw Chart.js’s own legend (the DOM legend replaces it)', () => {
    expect(config.options?.plugins?.legend?.display).toBe(false)
  })

  it('joins the crosshair group it is given, and none when given null', () => {
    const plugins = config.options?.plugins as Record<string, unknown>
    expect(plugins.crosshairSync).toEqual({ group: 'g' })
    const alone = buildOwnStockConfig(history(), null).options?.plugins as Record<string, unknown>
    expect(alone.crosshairSync).toBeUndefined()
  })

  it('FM 2: with no records it plots nothing', () => {
    const empty = buildOwnStockConfig([], null)
    expect(empty.data.labels).toEqual([])
    for (const d of empty.data.datasets) expect(d.data).toEqual([])
  })
})

describe('buildOwnOrdersConfig', () => {
  const config = buildOwnOrdersConfig(history(), 'g')

  it('AC 3: shows orders you received and orders you placed', () => {
    expect(config.data.labels).toEqual(['1', '2', '3'])
    expect(config.data.datasets.map((d) => d.label)).toEqual([RECEIVED_LABEL, PLACED_LABEL])
    expect(dataset(config as never, RECEIVED_LABEL).data).toEqual(RECEIVED)
    expect(dataset(config as never, PLACED_LABEL).data).toEqual(PLACED)
  })

  it('is unstacked, on one units axis', () => {
    for (const d of config.data.datasets) expect(d.stack).toBeUndefined()
    const scales = config.options?.scales ?? {}
    expect(Object.keys(scales).filter((key) => key !== 'x')).toEqual(['y'])
    expect((scales.y as { stacked?: boolean }).stacked).toBeFalsy()
  })

  it('joins the crosshair group it is given, and none when given null', () => {
    const plugins = config.options?.plugins as Record<string, unknown>
    expect(plugins.crosshairSync).toEqual({ group: 'g' })
    const alone = buildOwnOrdersConfig(history(), null).options?.plugins as Record<string, unknown>
    expect(alone.crosshairSync).toBeUndefined()
  })

  it('does not draw Chart.js’s own legend', () => {
    expect(config.options?.plugins?.legend?.display).toBe(false)
  })
})

describe('AC 1: every plotted value is a WeekRecord field', () => {
  it('plots only the five fields (backlog sign-flipped), and no other field', () => {
    const fields = new Set([...ON_HAND, ...BACKLOG, ...ON_THE_WAY, ...RECEIVED, ...PLACED])
    const plotted: number[] = []
    for (const config of [buildOwnStockConfig(history(), 'g'), buildOwnOrdersConfig(history(), 'g')]) {
      for (const d of config.data.datasets) plotted.push(...(d.data as number[]))
    }
    expect(plotted).toHaveLength(15)
    for (const value of plotted) expect(fields.has(Math.abs(value))).toBe(true)
    for (const other of NOT_PLOTTED) {
      expect(plotted.some((v) => Math.abs(v - other) < 100 && v >= 9000)).toBe(false)
    }
  })
})

describe('OwnHistoryChart', () => {
  it('keeps the empty state’s copy and has no tables', () => {
    render(<OwnHistoryChart history={[]} />)
    expect(screen.getByRole('heading', { name: 'Your history' })).toBeInTheDocument()
    expect(document.body).toHaveTextContent(/No week has closed yet/)
    expect(document.body).toHaveTextContent(
      'Your inventory, backlog and orders will chart here as the game runs, so you can see the effect of decisions you made weeks ago.',
    )
    expect(screen.queryAllByRole('table', { hidden: true })).toHaveLength(0)
  })

  it('has exactly one element labelled "Your history"', () => {
    render(<OwnHistoryChart history={history()} />)
    expect(screen.getAllByLabelText('Your history')).toHaveLength(1)
  })

  it('draws two panels, each a chart with its own heading', () => {
    render(<OwnHistoryChart history={history()} />)
    const section = screen.getByLabelText('Your history')
    // The canvas element carries role="img" too; the wrappers are the ones with a label of ours.
    expect(within(section).getAllByRole('img', { name: /week by week/ })).toHaveLength(2)
    expect(within(section).getAllByRole('figure')).toHaveLength(2)
  })

  it('puts both panels in one crosshair group: each canvas wrapper is focusable', () => {
    render(<OwnHistoryChart history={history()} />)
    for (const img of screen.getAllByRole('img', { name: /week by week/ })) expect(img).toHaveAttribute('tabindex', '0')
  })

  it('AC 4: the tables carry the five fields, week by week', () => {
    render(<OwnHistoryChart history={history()} />)
    const tables = screen.getAllByRole('table', { hidden: true })
    expect(tables).toHaveLength(2)

    const rowsOf = (table: HTMLElement) =>
      within(table)
        .getAllByRole('row', { hidden: true })
        .slice(1)
        .map((row) =>
          within(row)
            .getAllByRole('cell', { hidden: true })
            .map((cell) => cell.textContent),
        )

    const stock = tables.find((t) => t.textContent?.includes(ON_HAND_LABEL))!
    const orders = tables.find((t) => t.textContent?.includes('Received'))!
    expect(stock).toBeDefined()
    expect(orders).toBeDefined()
    expect(stock).not.toBe(orders)

    const stockHeads = within(stock)
      .getAllByRole('columnheader', { hidden: true })
      .map((h) => h.textContent)
    expect(stockHeads).toHaveLength(4)
    expect(stockHeads[0]).toBe('Week')
    expect(stockHeads[1]).toMatch(/on hand/i)
    expect(stockHeads[2]).toMatch(/backlog/i)
    expect(stockHeads[3]).toMatch(/on the way/i)
    expect(rowsOf(stock)).toEqual(ON_HAND.map((v, i) => [String(v), String(BACKLOG[i]), String(ON_THE_WAY[i])]))

    const orderHeads = within(orders)
      .getAllByRole('columnheader', { hidden: true })
      .map((h) => h.textContent)
    expect(orderHeads).toHaveLength(3)
    expect(orderHeads[1]).toMatch(/received/i)
    expect(orderHeads[2]).toMatch(/placed/i)
    expect(rowsOf(orders)).toEqual(RECEIVED.map((v, i) => [String(v), String(PLACED[i])]))
  })

  it('one row per closed week, with the week as the row header', () => {
    render(<OwnHistoryChart history={history()} />)
    for (const table of screen.getAllByRole('table', { hidden: true })) {
      const heads = within(table).getAllByRole('rowheader', { hidden: true })
      expect(heads.map((h) => h.textContent)).toEqual(['1', '2', '3'])
    }
  })

  it('Board3D AC 17: every history figure is in the DOM exactly once', () => {
    render(<OwnHistoryChart history={history()} />)
    const body = document.body.textContent ?? ''
    for (const figure of [...ON_HAND, ...BACKLOG, ...ON_THE_WAY, ...RECEIVED, ...PLACED]) {
      expect(figuresIn(body, figure), `${figure} is not in the DOM exactly once`).toBe(1)
    }
  })

  it('FM 2: no field outside the five reaches the DOM', () => {
    render(<OwnHistoryChart history={history()} />)
    const body = document.body.textContent ?? ''
    for (const base of NOT_PLOTTED) {
      for (const week of [0, 10, 20]) expect(body).not.toContain(String(base + week))
    }
  })

  it('FM 2: names no role in the DOM', () => {
    render(<OwnHistoryChart history={history('RETAILER')} />)
    const body = document.body.textContent ?? ''
    for (const role of ['retailer', 'wholesaler', 'distributor', 'factory']) {
      expect(body.toLowerCase()).not.toContain(role)
    }
  })

  it('labels each chart and offers the table toggle without a second copy of the table', async () => {
    const user = userEvent.setup()
    render(<OwnHistoryChart history={history()} />)
    const toggles = screen.getAllByRole('button', { name: /show table/i })
    expect(toggles).toHaveLength(2)

    await user.click(toggles[0])
    expect(screen.getAllByRole('table', { hidden: true })).toHaveLength(2)
    const body = document.body.textContent ?? ''
    for (const figure of [...ON_HAND, ...PLACED]) expect(figuresIn(body, figure)).toBe(1)
  })

  it('the legend names every series once', () => {
    render(<OwnHistoryChart history={history()} />)
    const section = screen.getByLabelText('Your history')
    for (const label of [ON_HAND_LABEL, BACKLOG_LABEL, ON_THE_WAY_LABEL, RECEIVED_LABEL, PLACED_LABEL]) {
      expect(within(section).getAllByText(label, { exact: true }).length).toBeGreaterThanOrEqual(1)
    }
  })
})
