/**
 * The results chart's Chart.js registration and its one pure builder.
 *
 * Two things live here, and the split is frozen by `21-frontend-results.md`
 * section 2.2a: a Chart.js canvas is opaque to jsdom, so the configuration the
 * chart is handed has to be assertable without a canvas. `buildBullwhipConfig`
 * returns **exactly** what `BullwhipChart` renders — the component adds
 * nothing to it — which is what lets the chart's acceptance criteria be
 * checked against an object instead of against a mocked library.
 *
 * `ResultsView` lives here rather than beside the page because the frozen
 * signature of the builder names it, and because every results component
 * reads that one view model and nothing else (section 2.0).
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
} from 'chart.js'
import { ROLE_ORDER, type Role } from '../../types/game'
import { ROLE_LABEL } from '../lobby/roleCopy'

/** Only the controllers, elements, scales and plugins this chart uses. */
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend)

/* ─── The one view model (section 2.0) ─── */

/**
 * One role's figures, as the screen reads them.
 *
 * `inventory`, `backlog` and `cumulative_cost` are the per-week series that
 * only the persisted payload carries, so they are optional here. An absent
 * series is **not rendered** — never zeroed, never re-derived from `orders`,
 * which would put a figure on the screen that the server never sent (§3.2).
 */
export interface RoleResultView {
  role: Role
  display_name: string
  is_bot: boolean
  total_cost: number
  peak_inventory: number
  peak_backlog: number
  weeks_in_backlog: number
  order_variance: number
  /** `null` when Var(customer demand) == 0 — exactly `CONSTANT` (**D12**). */
  bullwhip_ratio: number | null
  /** `null` when total obligation == 0 (**D12**). */
  fill_rate: number | null
  average_order: number
  orders: number[]
  /** URL path only. */
  inventory?: number[]
  /** URL path only. */
  backlog?: number[]
  /** URL path only. */
  cumulative_cost?: number[]
}

/**
 * What every component on the results screen reads, whichever path filled it.
 *
 * The two entry paths (§3.1) do not deliver the same fields, so both are
 * normalised into this before anything renders. The optional tail is the
 * session-facts block: present on the URL path, absent on the live one.
 */
export interface ResultsView {
  room_code: string
  weeks_played: number
  demand_series: number[]
  chain_total_cost: number
  demand_variance: number
  currency_symbol: string
  /** In `ROLE_ORDER`. */
  per_role: RoleResultView[]
  /** URL path only. */
  duration_weeks?: number
  /** URL path only. */
  ended_early?: boolean
  /** URL path only. */
  preset_name?: string | null
  /** URL path only. */
  started_at?: string
  /** URL path only. */
  finished_at?: string
}

/* ─── The persisted payload, and its normaliser (`15 §2`; §2.0 FROZEN) ─── */

/**
 * One role's entry in `GET /games/{code}/results` and
 * `GET /users/me/games/{id}` — the two routes that return the identical
 * payload (`15 §2`).
 */
export interface RoleResult {
  role: Role
  display_name: string
  is_bot: boolean
  total_cost: number
  peak_inventory: number
  peak_backlog: number
  weeks_in_backlog: number
  order_variance: number
  bullwhip_ratio: number | null
  fill_rate: number | null
  average_order: number
  orders: number[]
  inventory: number[]
  backlog: number[]
  cumulative_cost: number[]
}

export interface ResultsResponse {
  /** Permanent id for `/results/g/:gameId`; a room code is recycled. */
  public_id: string
  room_code: string
  weeks_played: number
  duration_weeks: number
  ended_early: boolean
  currency_symbol: string
  started_at: string
  finished_at: string
  demand_series: number[]
  chain_total_cost: number
  demand_variance: number
  per_role: RoleResult[]
  preset_name: string | null
}

/**
 * The persisted path's normaliser. Everything the screen can show is in the
 * payload, so the per-week series and the session facts are both present.
 *
 * It lives here beside `ResultsView` rather than in `ResultsPage.tsx` because
 * section 22's match detail renders the same payload through the same
 * components, and a second mapping of one contract drifts from the first the
 * moment either changes (`22 §2.4`).
 */
export function resultsViewFromResponse(payload: ResultsResponse): ResultsView {
  const perRole: RoleResultView[] = ROLE_ORDER.flatMap((role) => {
    const entry = payload.per_role.find((candidate) => candidate.role === role)
    if (!entry) return []
    return [
      {
        role,
        display_name: entry.display_name,
        is_bot: entry.is_bot,
        total_cost: entry.total_cost,
        peak_inventory: entry.peak_inventory,
        peak_backlog: entry.peak_backlog,
        weeks_in_backlog: entry.weeks_in_backlog,
        order_variance: entry.order_variance,
        bullwhip_ratio: entry.bullwhip_ratio,
        fill_rate: entry.fill_rate,
        average_order: entry.average_order,
        orders: entry.orders,
        inventory: entry.inventory,
        backlog: entry.backlog,
        cumulative_cost: entry.cumulative_cost,
      },
    ]
  })

  return {
    room_code: payload.room_code,
    weeks_played: payload.weeks_played,
    demand_series: payload.demand_series,
    chain_total_cost: payload.chain_total_cost,
    demand_variance: payload.demand_variance,
    currency_symbol: payload.currency_symbol,
    per_role: perRole,
    duration_weeks: payload.duration_weeks,
    ended_early: payload.ended_early,
    preset_name: payload.preset_name,
    started_at: payload.started_at,
    finished_at: payload.finished_at,
  }
}

/* ─── Series styling ─── */

/**
 * The palette from `src/index.css`, written out as literals.
 *
 * Chart.js paints onto a canvas, where a CSS custom property is never
 * resolved for it, so these are the same hues the rest of the screen uses:
 * `--color-demand` for true customer demand and the four `--color-role-*`
 * values for the order streams.
 *
 * Colour is never the only channel. Each order series also carries its own
 * dash pattern and its own legend point style, so the chart survives a
 * projector, a photocopy and colour-blindness.
 */
const DEMAND_COLOUR = '#3f3a30'
const AXIS_COLOUR = '#5c5547'
const GRID_COLOUR = '#e2dac8'

interface SeriesStyle {
  colour: string
  dash: number[]
  point: 'triangle' | 'rect' | 'rectRot' | 'star'
}

const ORDER_SERIES: Record<Role, SeriesStyle> = {
  RETAILER: { colour: '#1f6f9c', dash: [6, 3], point: 'triangle' },
  WHOLESALER: { colour: '#04705a', dash: [14, 4], point: 'rect' },
  DISTRIBUTOR: { colour: '#9c4f78', dash: [2, 3], point: 'rectRot' },
  FACTORY: { colour: '#a8480a', dash: [10, 3, 2, 3], point: 'star' },
}

/** The label each series carries in the legend and in the hidden table. */
export const DEMAND_SERIES_LABEL = 'True customer demand'

export function orderSeriesLabel(role: Role): string {
  return `${ROLE_LABEL[role]} orders`
}

/**
 * The reveal, as a configuration object (section 2.2).
 *
 * The rules that make the chart teach the lesson rather than hide it:
 *   - five series on **one** Y axis. A secondary axis rescales the order
 *     curves next to demand and destroys the very comparison the screen
 *     exists for;
 *   - that axis begins at zero, because a truncated axis exaggerates the
 *     variation in demand and understates the contrast;
 *   - true customer demand is the **last** dataset, so Chart.js draws it on
 *     top of the four order curves, and it carries no dash;
 *   - the legend is Chart.js's own, whose default click handler toggles one
 *     dataset at a time — the single most useful control in the debrief, as
 *     it lets a host bring the chain in one stage at a time.
 *
 * Nothing here computes: every plotted number is a server field.
 */
export function buildBullwhipConfig(view: ResultsView): ChartConfiguration<'line'> {
  const weeks = view.weeks_played
  const labels = Array.from({ length: weeks }, (_, index) => String(index + 1))

  const orderDatasets: ChartDataset<'line'>[] = view.per_role.map((role) => {
    const style = ORDER_SERIES[role.role]
    return {
      label: orderSeriesLabel(role.role),
      data: role.orders.slice(0, weeks),
      borderColor: style.colour,
      backgroundColor: style.colour,
      borderDash: style.dash,
      borderWidth: 2,
      pointStyle: style.point,
      pointRadius: 0,
      pointHoverRadius: 5,
      tension: 0.15,
    }
  })

  // Last in the array, and therefore drawn on top. No `borderDash` key at all.
  const demandPoints = view.demand_series.slice(0, weeks)
  const demandDataset: ChartDataset<'line'> = {
    label: DEMAND_SERIES_LABEL,
    data: demandPoints,
    borderColor: DEMAND_COLOUR,
    backgroundColor: DEMAND_COLOUR,
    borderWidth: 4,
    pointStyle: 'circle',
    pointRadius: 0,
    pointHoverRadius: 5,
    tension: 0,
  }

  return {
    type: 'line',
    data: {
      labels,
      // A series the view no longer carries is not a flat line at the bottom
      // of the chart: it is gone. That is what makes the legend's demand
      // switch behave like the four role switches (AC 7).
      datasets: demandPoints.length > 0 ? [...orderDatasets, demandDataset] : orderDatasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: { usePointStyle: true, color: AXIS_COLOUR, font: { size: 14 } },
        },
        tooltip: { enabled: true },
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
