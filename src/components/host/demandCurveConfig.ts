/**
 * The host demand curve's Chart.js registration and its one pure builder
 * (`20-frontend-host-console.md` section 2.1a, FROZEN).
 *
 * A Chart.js canvas is opaque to jsdom, so the configuration the chart is
 * handed has to be assertable without one. `buildDemandCurveConfig` returns
 * **exactly** what `DemandCurve` renders — the component passes it straight
 * through and adds nothing — which is what lets the chart's acceptance
 * criteria be checked against an object rather than against a mocked library.
 *
 * Registration lives here rather than being imported from section 21's
 * `chartSetup.ts`, because that file belongs to section 21 (**D19**) and
 * `ChartJS.register` is idempotent.
 */
import {
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type ChartConfiguration,
  type ChartDataset,
  type ChartType,
  type Plugin,
} from 'chart.js'
import { ROLE_ORDER, type Role } from '../../types/game'
import {
  AXIS_COLOUR,
  CURRENT_WEEK_COLOUR,
  DEMAND_COLOUR,
  GRID_COLOUR,
  roleStyle,
  withAlpha,
} from '../charts/chartTheme'
import { orderSeriesLabel } from '../charts/chartSetup'

declare module 'chart.js' {
  interface PluginOptionsByType<TType extends ChartType> {
    currentWeekBand?: { index: number } | false
    // Keeps the type parameter in use, as Chart.js's own declarations do.
    __currentWeekBandType?: TType
  }
}

/** Only the controllers, elements, scales and plugins this chart uses. */
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend)

/** The one dataset's label, shared with the chart's hidden table. */
export const DEMAND_CURVE_LABEL = 'True customer demand'

/**
 * The marker on the current week. Every other week's point is drawn at
 * radius `0`, so the single non-zero entry in `pointRadius` **is** the mark:
 * the configuration object states which week is current without anyone having
 * to read pixels off a canvas.
 */
export const CURRENT_WEEK_POINT_RADIUS = 9

export interface DemandCurveOptions {
  /**
   * Each role's order per closed week (`host_state.order_history`). Drawn as
   * one line per role present; absent or null draws the demand line alone.
   */
  orderHistory?: Partial<Record<Role, number[]>> | null
  /**
   * Plot demand only through this week (1-indexed, inclusive) — the projector's
   * rule, see `revealedDemand`. Absent or null plots the whole series, which is
   * the host console's view.
   */
  revealedThroughWeek?: number | null
}

/**
 * The part of the demand series the room has already seen: weeks 1 to `week`,
 * the open week included.
 *
 * It is the engine's own rule, not a second one: `player_view` truncates
 * `customer_demand_series` to `demand_series[:week]` (`07 §3.8`), because the
 * open week has already been settled and its demand is the Retailer's incoming
 * order on screen right now. Anything after it is the future, which only the
 * host may see — so the projector, which every player is looking at, plots
 * this and nothing else (`20 §2.4`). A week before the first, or a series
 * shorter than `week`, simply yields what exists.
 */
export function revealedDemand(demandSeries: number[], week: number): number[] {
  return demandSeries.slice(0, Math.max(0, Math.floor(week)))
}

/** Shade of the future: the same ink at a third of its strength, dashed. */
const FUTURE_COLOUR = withAlpha(DEMAND_COLOUR, 0.35)
const FUTURE_DASH = [4, 4]

/**
 * Shades the current week's column behind the lines. An inline plugin so the
 * band is part of the configuration object, not of the component.
 */
const currentWeekBand: Plugin<'line'> = {
  id: 'currentWeekBand',
  beforeDatasetsDraw(chart, _args, options) {
    const band = options as { index?: number } | false | undefined
    if (!band || typeof band.index !== 'number') return
    const x = chart.scales.x
    const { top, bottom } = chart.chartArea
    if (!x || band.index < 0 || band.index >= chart.data.labels!.length) return
    const centre = x.getPixelForValue(band.index)
    const half =
      chart.data.labels!.length > 1
        ? Math.abs(x.getPixelForValue(1) - x.getPixelForValue(0)) / 2
        : 8
    const { ctx } = chart
    ctx.save()
    ctx.fillStyle = withAlpha(CURRENT_WEEK_COLOUR, 0.14)
    ctx.fillRect(centre - half, top, half * 2, bottom - top)
    ctx.restore()
  },
}

/**
 * The host's demand curve: by default the **full** series, including the
 * weeks not yet played, with the current week marked.
 *
 * The host is the only person entitled to see the future of the series
 * (`07 §3.9` sends it to their sid alone), and seeing where the step lands
 * before it lands is what lets them run the session — so the console's curve
 * never truncates at `currentWeek`.
 *
 * The projector is the exception: with `revealedThroughWeek` set, the demand
 * line stops at that week (`revealedDemand`), so no future value is in the
 * configuration at all — not merely drawn faded. The x axis keeps every week
 * of the game, so the room still sees how far through it is; the length of
 * the game is on the projector's header anyway.
 *
 * `currentWeek` is 1-indexed, as every week in Beery is. A value outside the
 * series simply marks nothing, which is the right answer before the first
 * week and after the last.
 */
export function buildDemandCurveConfig(
  demandSeries: number[],
  currentWeek: number,
  options: DemandCurveOptions = {},
): ChartConfiguration<'line'> {
  const currentIndex = currentWeek - 1
  const isCurrent = (index: number): boolean => index === currentIndex
  const revealedThroughWeek = options.revealedThroughWeek
  const plotted =
    revealedThroughWeek === undefined || revealedThroughWeek === null
      ? demandSeries
      : revealedDemand(demandSeries, revealedThroughWeek)

  const dataset: ChartDataset<'line'> = {
    label: DEMAND_CURVE_LABEL,
    // The whole series on the console; on the projector, only what the room
    // has already seen. Never sliced anywhere else.
    data: [...plotted],
    borderColor: DEMAND_COLOUR,
    backgroundColor: DEMAND_COLOUR,
    borderWidth: 3,
    tension: 0,
    // The mark, in three channels at once: size, shape and colour. Size alone
    // would be invisible on a projector; colour alone fails section 3.5.
    pointRadius: plotted.map((_, index) =>
      isCurrent(index) ? CURRENT_WEEK_POINT_RADIUS : 0,
    ),
    pointHoverRadius: plotted.map((_, index) =>
      isCurrent(index) ? CURRENT_WEEK_POINT_RADIUS : 4,
    ),
    pointStyle: plotted.map((_, index) => (isCurrent(index) ? 'rectRot' : 'circle')),
    pointBackgroundColor: plotted.map((_, index) =>
      isCurrent(index) ? CURRENT_WEEK_COLOUR : DEMAND_COLOUR,
    ),
    pointBorderColor: DEMAND_COLOUR,
    pointBorderWidth: plotted.map((_, index) => (isCurrent(index) ? 3 : 1)),
    // Weeks after the current one have not happened: drawn faded and dashed.
    segment: {
      borderColor: (ctx) => (ctx.p1DataIndex > currentIndex ? FUTURE_COLOUR : DEMAND_COLOUR),
      borderDash: (ctx) => (ctx.p1DataIndex > currentIndex ? FUTURE_DASH : undefined),
    },
  }

  // Closed weeks only, exactly as the server sent them. Before demand, so the
  // demand line is drawn last and stays on top.
  const history = options.orderHistory
  const orderDatasets: ChartDataset<'line'>[] = history
    ? ROLE_ORDER.filter((role) => history[role] !== undefined).map((role) => {
        const style = roleStyle(role)
        return {
          label: orderSeriesLabel(role),
          data: [...(history[role] as number[])],
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
    : []

  return {
    type: 'line',
    data: {
      labels: demandSeries.map((_, index) => String(index + 1)),
      datasets: [...orderDatasets, dataset],
    },
    plugins: [currentWeekBand],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: true },
        currentWeekBand: { index: currentIndex },
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
          beginAtZero: true,
          title: { display: true, text: 'Units', color: AXIS_COLOUR },
          ticks: { color: AXIS_COLOUR },
          grid: { color: GRID_COLOUR },
        },
      },
    },
  }
}
