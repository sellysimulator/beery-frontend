/**
 * Pure builders for the results screen's three added charts. No React here:
 * like `buildBullwhipConfig`, each returns exactly what its component renders,
 * so the mapping from server field to plotted point can be asserted without a
 * canvas.
 *
 * Nothing is computed. Every plotted number is a server field; the only
 * arithmetic is flipping a sign so backlog hangs below the axis, which is
 * geometry, not a new figure.
 */
import type { Chart, ChartConfiguration, ChartDataset, Plugin } from 'chart.js'
import { ROLE_ORDER, type Role } from '../../types/game'
import type { ResultsView } from '../charts/chartSetup'
import { AXIS_COLOUR, GRID_COLOUR, QUANTITY_COLOUR, roleStyle } from '../charts/chartTheme'
import { ROLE_LABEL } from '../lobby/roleCopy'

export const STOCK_SERIES_LABEL = 'On hand'
export const BACKLOG_SERIES_LABEL = 'Backlog'

function weekLabels(weeks: number): string[] {
  return Array.from({ length: weeks }, (_, index) => String(index + 1))
}

/** The crosshair plugin's option, typed loosely because Chart.js does not know it. */
function crosshairOptions(group: string | null): Record<string, unknown> {
  return group === null ? {} : { crosshairSync: { group } }
}

/**
 * One role's stock above zero and backlog below it, on a y-range shared by
 * all four roles so the panels compare at a glance.
 *
 * The range comes from server peaks (`peak_inventory`, `peak_backlog`). The
 * backlog tooltip prints the server's own series, never the plotted negative.
 */
export function buildNetInventoryConfig(
  view: ResultsView,
  role: Role,
  group: string | null,
): ChartConfiguration<'line'> {
  const weeks = view.weeks_played
  const own = view.per_role.find((candidate) => candidate.role === role)
  const inventory = own?.inventory?.slice(0, weeks) ?? []
  const backlog = own?.backlog?.slice(0, weeks) ?? []

  const stock: ChartDataset<'line'> = {
    label: STOCK_SERIES_LABEL,
    data: inventory,
    borderColor: QUANTITY_COLOUR.inventory,
    backgroundColor: QUANTITY_COLOUR.inventorySoft,
    fill: 'origin',
    borderWidth: 2,
    pointRadius: 0,
    pointHoverRadius: 4,
    tension: 0,
  }
  const hanging: ChartDataset<'line'> = {
    label: BACKLOG_SERIES_LABEL,
    data: backlog.map((value) => -value),
    borderColor: QUANTITY_COLOUR.backlog,
    backgroundColor: QUANTITY_COLOUR.backlogSoft,
    fill: 'origin',
    borderWidth: 2,
    pointRadius: 0,
    pointHoverRadius: 4,
    tension: 0,
  }

  const top = Math.max(0, ...view.per_role.map((entry) => entry.peak_inventory))
  const bottom = -Math.max(0, ...view.per_role.map((entry) => entry.peak_backlog))

  return {
    type: 'line',
    data: { labels: weekLabels(weeks), datasets: [stock, hanging] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          callbacks: {
            label: (item) => {
              const value =
                item.datasetIndex === 1 ? backlog[item.dataIndex] : inventory[item.dataIndex]
              return `${item.dataset.label}: ${value}`
            },
          },
        },
        ...crosshairOptions(group),
      },
      scales: {
        x: {
          axis: 'x',
          title: { display: true, text: 'Week', color: AXIS_COLOUR },
          ticks: { color: AXIS_COLOUR },
          grid: { color: GRID_COLOUR },
        },
        y: {
          axis: 'y',
          min: bottom,
          max: top,
          title: { display: true, text: 'Units', color: AXIS_COLOUR },
          ticks: { color: AXIS_COLOUR },
          grid: { color: GRID_COLOUR },
        },
      },
    },
  }
}

/** One line per role, straight from `cumulative_cost`. */
export function buildCumulativeCostConfig(view: ResultsView): ChartConfiguration<'line'> {
  const weeks = view.weeks_played

  const datasets: ChartDataset<'line'>[] = view.per_role.map((entry) => {
    const style = roleStyle(entry.role)
    return {
      label: ROLE_LABEL[entry.role],
      data: entry.cumulative_cost?.slice(0, weeks) ?? [],
      borderColor: style.colour,
      backgroundColor: style.colour,
      borderDash: style.dash,
      borderWidth: 2,
      pointStyle: style.point,
      pointRadius: 0,
      pointHoverRadius: 5,
      tension: 0,
    }
  })

  return {
    type: 'line',
    data: { labels: weekLabels(weeks), datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { enabled: true } },
      scales: {
        x: {
          axis: 'x',
          title: { display: true, text: 'Week', color: AXIS_COLOUR },
          ticks: { color: AXIS_COLOUR },
          grid: { color: GRID_COLOUR },
        },
        y: {
          axis: 'y',
          beginAtZero: true,
          title: { display: true, text: `Cost so far (${view.currency_symbol})`, color: AXIS_COLOUR },
          ticks: { color: AXIS_COLOUR },
          grid: { color: GRID_COLOUR },
        },
      },
    },
  }
}

/** Draws the 1x rule: the point at which a role neither amplified nor damped demand. */
const oneTimesRule: Plugin<'bar'> = {
  id: 'oneTimesRule',
  afterDatasetsDraw(chart: Chart<'bar'>) {
    const x = chart.scales.x
    if (!x) return
    const pixel = x.getPixelForValue(1)
    const { top, bottom } = chart.chartArea
    const { ctx } = chart
    ctx.save()
    ctx.strokeStyle = AXIS_COLOUR
    ctx.setLineDash([4, 4])
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(pixel, top)
    ctx.lineTo(pixel, bottom)
    ctx.stroke()
    ctx.restore()
  },
}

/**
 * One horizontal bar per shown role whose ratio is a positive number, on a
 * logarithmic axis. A `null` ratio has nothing to draw, and `0` cannot sit on
 * a log axis, so neither gets a bar (its figure stays in the table).
 */
export function buildBullwhipRatioConfig(
  view: ResultsView,
  shown: readonly Role[],
): ChartConfiguration<'bar'> {
  const bars = ROLE_ORDER.flatMap((role) => {
    if (!shown.includes(role)) return []
    const entry = view.per_role.find((candidate) => candidate.role === role)
    const ratio = entry?.bullwhip_ratio
    return typeof ratio === 'number' && ratio > 0 ? [{ role, ratio }] : []
  })

  return {
    type: 'bar',
    data: {
      labels: bars.map((bar) => ROLE_LABEL[bar.role]),
      datasets: [
        {
          label: 'Bullwhip ratio',
          data: bars.map((bar) => bar.ratio),
          backgroundColor: bars.map((bar) => roleStyle(bar.role).colour),
          borderColor: bars.map((bar) => roleStyle(bar.role).colour),
          borderWidth: 1,
        },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      plugins: { legend: { display: false }, tooltip: { enabled: true } },
      scales: {
        x: {
          type: 'logarithmic',
          min: 0.1,
          title: { display: true, text: 'Bullwhip ratio (log scale)', color: AXIS_COLOUR },
          ticks: { color: AXIS_COLOUR },
          grid: { color: GRID_COLOUR },
        },
        y: {
          ticks: { color: AXIS_COLOUR },
          grid: { display: false },
        },
      },
    },
    plugins: [oneTimesRule],
  }
}
