/**
 * A Chart.js plugin that keeps one vertical rule, and the hovered point, at
 * the same week on every chart of a group.
 *
 * Charts opt in with `options.plugins.crosshairSync.group`; a chart without
 * it is never touched. The state is one index per group, kept here at module
 * level because the charts of a group are separate canvases with no shared
 * parent Chart.js knows about.
 */
import type { Chart, ChartOptions, Plugin } from 'chart.js'
import { Chart as ChartJS } from 'chart.js'
import { CHART_TOKENS } from '../chartTheme'

export const CROSSHAIR_SYNC_ID = 'crosshairSync'

export interface CrosshairSyncOptions {
  group: string
}

interface ActiveElement {
  datasetIndex: number
  index: number
}

const indexes = new Map<string, number | null>()
const members = new Map<string, Set<Chart>>()
/** The chart whose hover is driving a group, so it is not told to redo what it just did. */
const sources = new Map<string, Chart>()

function groupOf(chart: Chart): string | null {
  const options = (chart.options as ChartOptions | undefined)?.plugins as
    | Record<string, unknown>
    | undefined
  const own = options?.[CROSSHAIR_SYNC_ID] as Partial<CrosshairSyncOptions> | false | undefined
  return own && typeof own.group === 'string' && own.group !== '' ? own.group : null
}

function join(chart: Chart): void {
  const group = groupOf(chart)
  if (group === null) return
  let set = members.get(group)
  if (!set) {
    set = new Set()
    members.set(group, set)
  }
  set.add(chart)
}

function leave(chart: Chart): void {
  for (const [group, set] of members) {
    set.delete(chart)
    if (set.size === 0) {
      members.delete(group)
      indexes.delete(group)
      sources.delete(group)
    }
  }
}

function labelCount(chart: Chart): number {
  return (chart.data?.labels as unknown[] | undefined)?.length ?? 0
}

/** Put the active elements and the tooltip at `index` on `chart`, or clear them. */
function show(chart: Chart, index: number | null): void {
  const count = chart.data?.datasets?.length ?? 0
  const elements: ActiveElement[] =
    index === null || index >= labelCount(chart)
      ? []
      : Array.from({ length: count }, (_unused, datasetIndex) => ({ datasetIndex, index }))
  chart.setActiveElements(elements)
  chart.tooltip?.setActiveElements(elements, { x: 0, y: 0 })
  chart.update('none')
}

function apply(group: string, index: number | null): void {
  indexes.set(group, index)
  const source = sources.get(group)
  for (const chart of members.get(group) ?? []) {
    if (chart === source) {
      // Its own hover already drew; it only needs the rule repainted.
      chart.draw()
      continue
    }
    show(chart, index)
  }
}

/** Draw (or clear) the rule at `index` on every chart of `group`. */
export function setCrosshairIndex(group: string, index: number | null): void {
  sources.delete(group)
  apply(group, index)
}

/** Move the rule by `delta`, clamped to the shortest label count in the group. */
export function stepCrosshair(group: string, delta: number): void {
  const charts = [...(members.get(group) ?? [])]
  if (charts.length === 0) return
  const shortest = Math.min(...charts.map(labelCount))
  if (shortest <= 0) return
  const current = indexes.get(group) ?? null
  const base = current ?? (delta >= 0 ? -1 : shortest)
  const next = Math.min(shortest - 1, Math.max(0, base + delta))
  setCrosshairIndex(group, next)
}

function pixelFor(chart: Chart, index: number): number | null {
  const scale = (chart.scales as Record<string, { getPixelForValue?: (v: number) => number }> | undefined)?.x
  const fromScale = scale?.getPixelForValue?.(index)
  if (typeof fromScale === 'number' && Number.isFinite(fromScale)) return fromScale
  const point = chart.getDatasetMeta(0)?.data?.[index] as { x?: number } | undefined
  return typeof point?.x === 'number' ? point.x : null
}

function drawRule(chart: Chart): void {
  const group = groupOf(chart)
  if (group === null) return
  const index = indexes.get(group)
  if (index === null || index === undefined || index >= labelCount(chart)) return
  const x = pixelFor(chart, index)
  if (x === null) return
  const { top, bottom } = chart.chartArea
  const ctx = chart.ctx
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(x, top)
  ctx.lineTo(x, bottom)
  ctx.lineWidth = 1
  ctx.strokeStyle = CHART_TOKENS['--color-ink-muted']
  ctx.setLineDash([4, 3])
  ctx.stroke()
  ctx.restore()
}

export const crosshairSync: Plugin = {
  id: CROSSHAIR_SYNC_ID,
  beforeInit(chart) {
    join(chart)
  },
  afterInit(chart) {
    join(chart)
  },
  afterUpdate(chart) {
    join(chart)
  },
  afterEvent(chart, args) {
    const group = groupOf(chart)
    if (group === null) return
    join(chart)
    const type = args.event.type
    if (type === 'mouseout') {
      sources.set(group, chart)
      apply(group, null)
      return
    }
    if (type !== 'mousemove') return
    const hit = chart.getElementsAtEventForMode(
      args.event as unknown as Event,
      'index',
      { intersect: false },
      true,
    )
    const next = hit.length > 0 ? hit[0].index : null
    if (next === (indexes.get(group) ?? null)) return
    sources.set(group, chart)
    apply(group, next)
  },
  afterDatasetsDraw(chart) {
    drawRule(chart)
  },
  beforeDestroy(chart) {
    leave(chart)
  },
  afterDestroy(chart) {
    leave(chart)
  },
}

ChartJS.register(crosshairSync)
