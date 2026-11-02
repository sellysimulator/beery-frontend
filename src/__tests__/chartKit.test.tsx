/**
 * BE-1 (`CHARTS-PLAN.md`), the component half of the chart kit: `Legend`,
 * `ChartBox` and the `crosshairSync` plugin with its React context.
 *
 * Covers acceptance (4) the crosshair group syncs two charts by index, (5) the
 * `ChartBox` table toggle works, and the failure mode "a legend switch whose
 * name lacks the series label". Acceptance (3) is the unchanged
 * `BullwhipChart.test.tsx`, run beside this file.
 *
 * `chart.js` and `react-chartjs-2` are never mocked (`21 §2.2a`). jsdom cannot
 * create a chart, so the plugin is driven through its Chart.js hooks with
 * chart stand-ins: plain objects that carry exactly the members a plugin may
 * read from a chart and record what it asks of them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { Chart as ChartJS } from 'chart.js'
import Legend, { Legend as NamedLegend, type LegendItem } from '../components/charts/Legend'
import ChartBox, { ChartBox as NamedChartBox } from '../components/charts/ChartBox'
import {
  CROSSHAIR_SYNC_ID,
  crosshairSync,
  setCrosshairIndex,
  stepCrosshair,
} from '../components/charts/plugins/crosshairSync'
import { CrosshairGroup, useCrosshairGroup } from '../components/charts/plugins/CrosshairGroup'

/* ─── Legend ─── */

const ITEMS: LegendItem[] = [
  { key: 'DEMAND', label: 'True customer demand', swatch: { kind: 'line', color: '#3f3a30', width: 4 } },
  { key: 'RETAILER', label: 'Retailer orders', swatch: { kind: 'line', color: '#1f6f9c', dash: [6, 3] } },
  { key: 'FACTORY', label: 'Factory orders', swatch: { kind: 'line', color: '#a8480a', dash: [10, 3, 2, 3] } },
  { key: 'STOCK', label: 'On hand', swatch: { kind: 'fill', color: '#d6ecf8' } },
]

describe('Legend', () => {
  it('has a named and a default export of the same component', () => {
    expect(NamedLegend).toBe(Legend)
  })

  describe('FAILURE MODE: a legend switch whose name lacks the series label', () => {
    it('names every switch exactly after its label', () => {
      render(<Legend items={ITEMS} hidden={new Set()} onToggle={() => {}} />)
      for (const item of ITEMS) {
        // A string `name` is an exact match on the whole accessible name, so a
        // swatch that leaked text into it, or a missing label, fails here.
        expect(screen.getByRole('switch', { name: item.label })).toBeInTheDocument()
      }
      expect(screen.getAllByRole('switch')).toHaveLength(ITEMS.length)
    })

    it('does not let the swatch contribute to the name: the swatch is aria-hidden', () => {
      render(<Legend items={ITEMS} hidden={new Set()} onToggle={() => {}} />)
      for (const item of ITEMS) {
        const button = screen.getByRole('switch', { name: item.label })
        const svg = button.querySelector('svg')
        expect(svg).not.toBeNull()
        expect(svg?.getAttribute('aria-hidden')).toBe('true')
      }
    })
  })

  describe('switch mode', () => {
    it('renders type="button" role="switch" with aria-checked and data-series', () => {
      render(<Legend items={ITEMS} hidden={new Set(['FACTORY'])} onToggle={() => {}} />)
      const retailer = screen.getByRole('switch', { name: 'Retailer orders' })
      expect(retailer.tagName).toBe('BUTTON')
      expect(retailer).toHaveAttribute('type', 'button')
      expect(retailer).toHaveAttribute('data-series', 'RETAILER')
      expect(retailer).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByRole('switch', { name: 'Factory orders' })).toHaveAttribute('aria-checked', 'false')
    })

    it('puts the switches in a group carrying the default name', () => {
      render(<Legend items={ITEMS} hidden={new Set()} onToggle={() => {}} />)
      const group = screen.getByRole('group', { name: 'Show or hide a series' })
      expect(within(group).getAllByRole('switch')).toHaveLength(ITEMS.length)
    })

    it('puts the switches in a group carrying the given ariaLabel', () => {
      render(<Legend items={ITEMS} hidden={new Set()} onToggle={() => {}} ariaLabel="Roles" />)
      expect(screen.getByRole('group', { name: 'Roles' })).toBeInTheDocument()
    })

    it('treats an absent hidden set as everything on', () => {
      render(<Legend items={ITEMS} onToggle={() => {}} />)
      for (const el of screen.getAllByRole('switch')) expect(el).toHaveAttribute('aria-checked', 'true')
    })

    it('strikes an off item through, and only that one', () => {
      render(<Legend items={ITEMS} hidden={new Set(['FACTORY'])} onToggle={() => {}} />)
      expect(screen.getByRole('switch', { name: 'Factory orders' }).className).toMatch(/line-through/)
      expect(screen.getByRole('switch', { name: 'Retailer orders' }).className).not.toMatch(/line-through/)
    })

    it('calls onToggle with the key on click, and from the keyboard', async () => {
      const onToggle = vi.fn()
      const user = userEvent.setup()
      render(<Legend items={ITEMS} hidden={new Set()} onToggle={onToggle} />)

      await user.click(screen.getByRole('switch', { name: 'Retailer orders' }))
      expect(onToggle).toHaveBeenLastCalledWith('RETAILER')

      screen.getByRole('switch', { name: 'Factory orders' }).focus()
      await user.keyboard('{Enter}')
      expect(onToggle).toHaveBeenLastCalledWith('FACTORY')
      expect(onToggle).toHaveBeenCalledTimes(2)
    })

    it('draws a line swatch with its colour, its dash and its width', () => {
      render(<Legend items={ITEMS} hidden={new Set()} onToggle={() => {}} />)
      const demand = screen.getByRole('switch', { name: 'True customer demand' }).querySelector('svg line')
      expect(demand?.getAttribute('stroke')).toBe('#3f3a30')
      expect(demand?.getAttribute('stroke-width')).toBe('4')
      expect(demand?.getAttribute('stroke-dasharray') ?? '').toBe('')

      const factory = screen.getByRole('switch', { name: 'Factory orders' }).querySelector('svg line')
      expect(factory?.getAttribute('stroke')).toBe('#a8480a')
      expect(factory?.getAttribute('stroke-dasharray')).toBe('10 3 2 3')
    })

    it('draws a fill swatch as a filled shape in its colour', () => {
      render(<Legend items={ITEMS} hidden={new Set()} onToggle={() => {}} />)
      const svg = screen.getByRole('switch', { name: 'On hand' }).querySelector('svg')
      expect(svg?.querySelector('line')).toBeNull()
      expect(svg?.querySelector('rect')?.getAttribute('fill')).toBe('#d6ecf8')
    })
  })

  describe('static mode (no onToggle)', () => {
    it('renders every label and no switch', () => {
      render(<Legend items={ITEMS} />)
      expect(screen.queryAllByRole('switch')).toHaveLength(0)
      for (const item of ITEMS) expect(screen.getByText(item.label)).toBeInTheDocument()
    })
  })

  describe('emphasis', () => {
    it('reports onFocusItem(key) on hover and focus, and null on leave and blur', async () => {
      const onFocusItem = vi.fn()
      const user = userEvent.setup()
      render(<Legend items={ITEMS} hidden={new Set()} onToggle={() => {}} onFocusItem={onFocusItem} />)
      const retailer = screen.getByRole('switch', { name: 'Retailer orders' })

      await user.hover(retailer)
      expect(onFocusItem).toHaveBeenLastCalledWith('RETAILER')
      await user.unhover(retailer)
      expect(onFocusItem).toHaveBeenLastCalledWith(null)

      act(() => retailer.focus())
      expect(onFocusItem).toHaveBeenLastCalledWith('RETAILER')
      act(() => retailer.blur())
      expect(onFocusItem).toHaveBeenLastCalledWith(null)
    })
  })
})

/* ─── ChartBox ─── */

function Table(): ReactElement {
  return (
    <table>
      <caption>Plotted values</caption>
      <tbody>
        <tr>
          <td>42</td>
        </tr>
      </tbody>
    </table>
  )
}

function box(props: Partial<Parameters<typeof ChartBox>[0]> = {}): ReactElement {
  return (
    <ChartBox
      title="Orders"
      ariaLabel="Orders by week"
      height={300}
      table={<Table />}
      {...props}
    >
      <div data-testid="plot">canvas</div>
    </ChartBox>
  )
}

describe('ChartBox', () => {
  it('has a named and a default export of the same component', () => {
    expect(NamedChartBox).toBe(ChartBox)
  })

  it('renders the title as an h3 by default, and honours headingLevel', () => {
    const { unmount } = render(box())
    expect(screen.getByRole('heading', { level: 3, name: 'Orders' })).toBeInTheDocument()
    unmount()
    render(box({ headingLevel: 2 }))
    expect(screen.getByRole('heading', { level: 2, name: 'Orders' })).toBeInTheDocument()
  })

  it('renders an h4 when asked', () => {
    render(box({ headingLevel: 4 }))
    expect(screen.getByRole('heading', { level: 4, name: 'Orders' })).toBeInTheDocument()
  })

  it('renders the caption, the controls and the legend when given', () => {
    render(box({ caption: 'Units per week', controls: <button>Mode</button>, legend: <p>The legend</p> }))
    expect(screen.getByText('Units per week')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mode' })).toBeInTheDocument()
    expect(screen.getByText('The legend')).toBeInTheDocument()
  })

  it('wraps the chart in a role="img" element carrying ariaLabel and the plot height', () => {
    render(box())
    const wrapper = screen.getByRole('img', { name: 'Orders by week' })
    expect(within(wrapper).getByTestId('plot')).toBeInTheDocument()
    expect(wrapper).toHaveStyle({ height: '300px' })
  })

  it('is not focusable outside a CrosshairGroup', () => {
    render(box())
    expect(screen.getByRole('img', { name: 'Orders by week' })).not.toHaveAttribute('tabindex')
  })

  describe('ACCEPTANCE 5: the table toggle', () => {
    function srOnlyAncestor(el: HTMLElement): HTMLElement | null {
      return el.closest('.sr-only')
    }

    it('keeps the table in the DOM, visually hidden in an sr-only wrapper, to begin with', () => {
      render(box())
      const table = screen.getByRole('table', { hidden: true })
      expect(srOnlyAncestor(table)).not.toBeNull()
      const toggle = screen.getByRole('button', { name: /show table/i })
      expect(toggle.tagName).toBe('BUTTON')
      expect(toggle).toHaveAttribute('aria-pressed', 'false')
    })

    it('shows that same element when pressed, below the chart, and leaves the chart up', async () => {
      const user = userEvent.setup()
      render(box())
      const before = screen.getByRole('table', { hidden: true })

      await user.click(screen.getByRole('button', { name: /show table/i }))

      const after = screen.getByRole('table')
      expect(after).toBe(before)
      expect(srOnlyAncestor(after)).toBeNull()
      expect(screen.getByRole('button', { pressed: true, name: /table/i })).toBeInTheDocument()
      expect(screen.getByTestId('plot')).toBeInTheDocument()
      expect(screen.getByRole('img', { name: 'Orders by week' })).toBeInTheDocument()

      const plot = screen.getByTestId('plot')
      expect(plot.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('never holds a second copy of the table, hidden or shown', async () => {
      const user = userEvent.setup()
      render(box())
      expect(screen.getAllByRole('table', { hidden: true })).toHaveLength(1)
      await user.click(screen.getByRole('button', { name: /show table/i }))
      expect(screen.getAllByRole('table', { hidden: true })).toHaveLength(1)
    })

    it('hides it again on a second press', async () => {
      const user = userEvent.setup()
      render(box())
      await user.click(screen.getByRole('button', { name: /show table/i }))
      await user.click(screen.getByRole('button', { pressed: true, name: /table/i }))
      expect(srOnlyAncestor(screen.getByRole('table', { hidden: true }))).not.toBeNull()
      expect(screen.getByRole('button', { name: /show table/i })).toHaveAttribute('aria-pressed', 'false')
    })
  })

  describe('the error boundary', () => {
    it('shows the fallback text when the chart throws, and keeps the table', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      function Boom(): ReactElement {
        throw new Error('no canvas')
      }
      render(
        <ChartBox title="Orders" ariaLabel="Orders by week" height={300} table={<Table />}>
          <Boom />
        </ChartBox>,
      )
      spy.mockRestore()
      expect(
        screen.getByText(
          'The chart could not be drawn here. The same figures are in the table that follows it.',
        ),
      ).toBeInTheDocument()
      expect(screen.getByRole('table', { hidden: true })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Orders' })).toBeInTheDocument()
    })
  })
})

/* ─── crosshairSync: the plugin, driven through its hooks ─── */

interface Call {
  elements: Array<{ datasetIndex: number; index: number }>
}

interface StandIn {
  chart: Record<string, unknown>
  options: { group: string }
  active: Call[]
  tooltipActive: Call[]
  moves: number[]
  lines: number[]
  update: ReturnType<typeof vi.fn>
  draw: ReturnType<typeof vi.fn>
}

/**
 * A chart stand-in. `step` and `left` give each chart its own pixel mapping so
 * the test can tell "the rule is at index n on this chart" from "the rule is
 * at the other chart's pixel".
 */
function standIn(opts: { group?: string | null; labels: number; datasets?: number; left: number; step: number }): StandIn {
  const datasets = opts.datasets ?? 2
  const px = (i: number): number => opts.left + opts.step * i
  const active: Call[] = []
  const tooltipActive: Call[] = []
  const moves: number[] = []
  const lines: number[] = []
  const update = vi.fn()
  const draw = vi.fn()
  const options = { group: opts.group ?? '' }
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
    fillRect: vi.fn(),
    moveTo: vi.fn((x: number) => void moves.push(x)),
    lineTo: vi.fn((x: number) => void lines.push(x)),
    rect: vi.fn(),
    lineWidth: 1,
    strokeStyle: '',
    fillStyle: '',
  }
  let current: Call['elements'] = []
  const plugins = opts.group === null ? {} : { crosshairSync: { group: opts.group } }
  const chart: Record<string, unknown> = {
    id: Math.floor(Math.random() * 1e9),
    ctx,
    canvas: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
    chartArea: { top: 10, bottom: 110, left: opts.left, right: px(opts.labels - 1) },
    data: {
      labels: Array.from({ length: opts.labels }, (_, i) => String(i + 1)),
      datasets: Array.from({ length: datasets }, () => ({ data: Array.from({ length: opts.labels }, () => 1) })),
    },
    options: { plugins },
    scales: {
      x: { getPixelForValue: (i: number) => px(i), left: opts.left, right: px(opts.labels - 1) },
      y: { top: 10, bottom: 110 },
    },
    getDatasetMeta: () => ({
      data: Array.from({ length: opts.labels }, (_, i) => ({ x: px(i), y: 50 })),
    }),
    getElementsAtEventForMode: () => current,
    getActiveElements: () => current,
    setActiveElements: vi.fn((els: Call['elements']) => {
      current = els
      active.push({ elements: els })
    }),
    tooltip: {
      getActiveElements: () => current,
      setActiveElements: vi.fn((els: Call['elements']) => {
        tooltipActive.push({ elements: els })
      }),
    },
    update,
    draw,
    render: draw,
  }
  return { chart, options, active, tooltipActive, moves, lines, update, draw }
}

type Hook = (chart: unknown, args: unknown, options: unknown) => void

function hook(name: string): Hook | undefined {
  return (crosshairSync as unknown as Record<string, Hook | undefined>)[name]
}

function call(name: string, s: StandIn, args: unknown = {}): void {
  hook(name)?.(s.chart, args, s.options)
}

const live: StandIn[] = []

/** Mount a stand-in the way Chart.js would: init, first update, first draw. */
function mount(s: StandIn): StandIn {
  call('beforeInit', s)
  call('afterInit', s)
  call('afterUpdate', s, {})
  call('afterDraw', s, {})
  live.push(s)
  return s
}

/** The x positions of every vertical rule drawn on the chart in one frame. */
function ruleXs(s: StandIn): number[] {
  s.moves.length = 0
  s.lines.length = 0
  call('beforeDatasetsDraw', s, {})
  call('afterDatasetsDraw', s, {})
  call('afterDraw', s, {})
  return [...new Set([...s.moves, ...s.lines])]
}

function lastActiveIndexes(calls: Call[]): number[] | null {
  const last = calls[calls.length - 1]
  return last ? last.elements.map((e) => e.index) : null
}

function hover(s: StandIn, index: number): void {
  s.chart.getElementsAtEventForMode = () => [
    { datasetIndex: 0, index },
    { datasetIndex: 1, index },
  ]
  s.chart.getActiveElements = s.chart.getElementsAtEventForMode
  ;(s.chart.tooltip as { getActiveElements: unknown }).getActiveElements = s.chart.getElementsAtEventForMode
  call('afterEvent', s, {
    event: { type: 'mousemove', x: 0, y: 50, native: {} },
    replay: false,
    changed: true,
    inChartArea: true,
  })
}

function leave(s: StandIn): void {
  s.chart.getElementsAtEventForMode = () => []
  s.chart.getActiveElements = () => []
  ;(s.chart.tooltip as { getActiveElements: unknown }).getActiveElements = () => []
  call('afterEvent', s, {
    event: { type: 'mouseout', x: -1, y: -1, native: {} },
    replay: false,
    changed: true,
    inChartArea: false,
  })
}

afterEach(() => {
  while (live.length > 0) {
    const s = live.pop() as StandIn
    call('beforeDestroy', s)
    call('afterDestroy', s)
    call('stop', s)
  }
})

describe('crosshairSync registration', () => {
  it('is the plugin with id "crosshairSync", registered with Chart.js on import', () => {
    expect(CROSSHAIR_SYNC_ID).toBe('crosshairSync')
    expect(crosshairSync.id).toBe(CROSSHAIR_SYNC_ID)
    expect(ChartJS.registry.getPlugin(CROSSHAIR_SYNC_ID)).toBe(crosshairSync)
  })
})

describe('ACCEPTANCE 4: a crosshair group syncs two charts by index', () => {
  it('draws the rule at index n on every chart in the group when one chart is hovered', () => {
    const a = mount(standIn({ group: 'g-hover', labels: 8, left: 0, step: 10 }))
    const b = mount(standIn({ group: 'g-hover', labels: 8, left: 5, step: 20 }))

    hover(a, 3)

    expect(ruleXs(a)).toEqual([30])
    expect(ruleXs(b)).toEqual([65])
  })

  it('sets the active elements and the tooltip at index n on the other chart', () => {
    const a = mount(standIn({ group: 'g-active', labels: 8, left: 0, step: 10 }))
    const b = mount(standIn({ group: 'g-active', labels: 8, left: 5, step: 20 }))

    hover(a, 4)

    expect(lastActiveIndexes(b.active)).toEqual([4, 4])
    expect(lastActiveIndexes(b.tooltipActive)).toEqual([4, 4])
    expect((b.chart.setActiveElements as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).toEqual([
      { datasetIndex: 0, index: 4 },
      { datasetIndex: 1, index: 4 },
    ])
    expect(b.update.mock.calls.length + b.draw.mock.calls.length).toBeGreaterThan(0)
  })

  it('follows the hover to a new index', () => {
    const a = mount(standIn({ group: 'g-follow', labels: 8, left: 0, step: 10 }))
    const b = mount(standIn({ group: 'g-follow', labels: 8, left: 5, step: 20 }))

    hover(a, 1)
    hover(a, 6)

    expect(ruleXs(b)).toEqual([125])
    expect(lastActiveIndexes(b.active)).toEqual([6, 6])
  })

  it('syncs from setCrosshairIndex(group, n) with no hover at all', () => {
    const a = mount(standIn({ group: 'g-set', labels: 8, left: 0, step: 10 }))
    const b = mount(standIn({ group: 'g-set', labels: 8, left: 5, step: 20 }))

    setCrosshairIndex('g-set', 2)

    expect(ruleXs(a)).toEqual([20])
    expect(ruleXs(b)).toEqual([45])
    expect(lastActiveIndexes(a.active)).toEqual([2, 2])
    expect(lastActiveIndexes(b.active)).toEqual([2, 2])
    expect(lastActiveIndexes(b.tooltipActive)).toEqual([2, 2])
  })

  it('clears the rule and the active elements everywhere on null', () => {
    const a = mount(standIn({ group: 'g-null', labels: 8, left: 0, step: 10 }))
    const b = mount(standIn({ group: 'g-null', labels: 8, left: 5, step: 20 }))
    setCrosshairIndex('g-null', 5)
    expect(ruleXs(a)).not.toEqual([])

    setCrosshairIndex('g-null', null)

    expect(ruleXs(a)).toEqual([])
    expect(ruleXs(b)).toEqual([])
    expect(lastActiveIndexes(a.active)).toEqual([])
    expect(lastActiveIndexes(b.active)).toEqual([])
  })

  it('clears the other charts when the pointer leaves the hovered one', () => {
    const a = mount(standIn({ group: 'g-leave', labels: 8, left: 0, step: 10 }))
    const b = mount(standIn({ group: 'g-leave', labels: 8, left: 5, step: 20 }))
    hover(a, 3)
    expect(ruleXs(b)).toEqual([65])

    leave(a)

    expect(ruleXs(b)).toEqual([])
    expect(ruleXs(a)).toEqual([])
  })

  it('leaves a chart in another group alone', () => {
    const a = mount(standIn({ group: 'g-one', labels: 8, left: 0, step: 10 }))
    const other = mount(standIn({ group: 'g-two', labels: 8, left: 0, step: 10 }))

    hover(a, 3)
    setCrosshairIndex('g-one', 4)

    expect(ruleXs(other)).toEqual([])
    expect(other.active).toHaveLength(0)
    expect(other.tooltipActive).toHaveLength(0)
  })

  it('leaves a chart with no crosshairSync option untouched', () => {
    const grouped = mount(standIn({ group: 'g-plain', labels: 8, left: 0, step: 10 }))
    const plain = mount(standIn({ group: null, labels: 8, left: 0, step: 10 }))

    hover(grouped, 3)
    setCrosshairIndex('g-plain', 5)
    hover(plain, 2)

    expect(ruleXs(plain)).toEqual([])
    expect(plain.active).toHaveLength(0)
    expect(plain.tooltipActive).toHaveLength(0)
    expect(plain.update).not.toHaveBeenCalled()
  })

  it('stops acting on a chart once it is destroyed', () => {
    const a = mount(standIn({ group: 'g-gone', labels: 8, left: 0, step: 10 }))
    const b = mount(standIn({ group: 'g-gone', labels: 8, left: 5, step: 20 }))
    call('beforeDestroy', b)
    call('afterDestroy', b)
    call('stop', b)
    b.active.length = 0

    hover(a, 3)

    expect(b.active).toHaveLength(0)
  })
})

describe('stepCrosshair', () => {
  it('moves the rule by delta, on every chart in the group', () => {
    const a = mount(standIn({ group: 'g-step', labels: 8, left: 0, step: 10 }))
    const b = mount(standIn({ group: 'g-step', labels: 8, left: 5, step: 20 }))
    setCrosshairIndex('g-step', 2)

    stepCrosshair('g-step', 1)
    expect(ruleXs(a)).toEqual([30])
    expect(ruleXs(b)).toEqual([65])

    stepCrosshair('g-step', -2)
    expect(ruleXs(a)).toEqual([10])
    expect(ruleXs(b)).toEqual([25])
  })

  it('clamps at zero', () => {
    const a = mount(standIn({ group: 'g-low', labels: 8, left: 0, step: 10 }))
    setCrosshairIndex('g-low', 0)
    stepCrosshair('g-low', -1)
    expect(ruleXs(a)).toEqual([0])
  })

  it('clamps to the shortest label count in the group', () => {
    const long = mount(standIn({ group: 'g-high', labels: 8, left: 0, step: 10 }))
    const short = mount(standIn({ group: 'g-high', labels: 5, left: 0, step: 10 }))
    setCrosshairIndex('g-high', 4)

    stepCrosshair('g-high', 1)
    stepCrosshair('g-high', 3)

    expect(ruleXs(short)).toEqual([40])
    expect(ruleXs(long)).toEqual([40])
  })
})

/* ─── CrosshairGroup and ChartBox inside it ─── */

describe('CrosshairGroup and useCrosshairGroup', () => {
  function Probe({ onGroup }: { onGroup: (g: string | null) => void }): ReactElement {
    onGroup(useCrosshairGroup())
    return <span />
  }

  it('gives null outside any group', () => {
    const seen: Array<string | null> = []
    render(<Probe onGroup={(g) => seen.push(g)} />)
    expect(seen.at(-1)).toBeNull()
  })

  it('gives every descendant the same non-empty id', () => {
    const seen: Array<string | null> = []
    render(
      <CrosshairGroup>
        <Probe onGroup={(g) => seen.push(g)} />
        <div>
          <Probe onGroup={(g) => seen.push(g)} />
        </div>
      </CrosshairGroup>,
    )
    expect(seen.length).toBeGreaterThanOrEqual(2)
    expect(seen[0]).toBeTruthy()
    expect(new Set(seen).size).toBe(1)
  })

  it('gives two groups two different ids', () => {
    const first: Array<string | null> = []
    const second: Array<string | null> = []
    render(
      <>
        <CrosshairGroup>
          <Probe onGroup={(g) => first.push(g)} />
        </CrosshairGroup>
        <CrosshairGroup>
          <Probe onGroup={(g) => second.push(g)} />
        </CrosshairGroup>
      </>,
    )
    expect(first.at(-1)).toBeTruthy()
    expect(second.at(-1)).toBeTruthy()
    expect(first.at(-1)).not.toBe(second.at(-1))
  })

  describe('a ChartBox inside a group', () => {
    function setup(): { wrapper: HTMLElement; chart: StandIn } {
      let group: string | null = null
      render(
        <CrosshairGroup>
          <Probe onGroup={(g) => (group = g)} />
          {box()}
        </CrosshairGroup>,
      )
      const chart = mount(standIn({ group: group as unknown as string, labels: 8, left: 0, step: 10 }))
      return { wrapper: screen.getByRole('img', { name: 'Orders by week' }), chart }
    }

    it('makes the canvas wrapper focusable', () => {
      const { wrapper } = setup()
      expect(wrapper).toHaveAttribute('tabindex', '0')
    })

    it('maps ArrowRight to one step forward and ArrowLeft to one step back', () => {
      const { wrapper, chart } = setup()
      const group = chart.options.group
      setCrosshairIndex(group, 3)

      fireEvent.keyDown(wrapper, { key: 'ArrowRight' })
      expect(ruleXs(chart)).toEqual([40])

      fireEvent.keyDown(wrapper, { key: 'ArrowLeft' })
      fireEvent.keyDown(wrapper, { key: 'ArrowLeft' })
      expect(ruleXs(chart)).toEqual([20])
    })

    it('ignores other keys', () => {
      const { wrapper, chart } = setup()
      setCrosshairIndex(chart.options.group, 3)
      fireEvent.keyDown(wrapper, { key: 'ArrowUp' })
      fireEvent.keyDown(wrapper, { key: 'a' })
      expect(ruleXs(chart)).toEqual([30])
    })
  })
})
