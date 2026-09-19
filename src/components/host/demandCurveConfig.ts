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
} from 'chart.js'

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

/**
 * The palette from `src/index.css`, written out as literals.
 *
 * A CSS custom property is never resolved on a canvas, so these are copies of
 * `--color-demand` and `--color-brand` and have to be kept in step with that
 * file by hand (`21 §2.2a`).
 */
const DEMAND_COLOUR = '#3f3a30'
const CURRENT_WEEK_COLOUR = '#c98a00'
const AXIS_COLOUR = '#5c5547'
const GRID_COLOUR = '#e2dac8'

/**
 * The host's demand curve: the **full** series, including the weeks not yet
 * played, with the current week marked.
 *
 * The host is the only person entitled to see the future of the series
 * (`07 §3.9` sends it to their sid alone), and seeing where the step lands
 * before it lands is what lets them run the session — so nothing here
 * truncates at `currentWeek`.
 *
 * `currentWeek` is 1-indexed, as every week in Beery is. A value outside the
 * series simply marks nothing, which is the right answer before the first
 * week and after the last.
 */
export function buildDemandCurveConfig(
  demandSeries: number[],
  currentWeek: number,
): ChartConfiguration<'line'> {
  const currentIndex = currentWeek - 1
  const isCurrent = (index: number): boolean => index === currentIndex

  const dataset: ChartDataset<'line'> = {
    label: DEMAND_CURVE_LABEL,
    // The whole series. Never sliced to the week played so far.
    data: [...demandSeries],
    borderColor: DEMAND_COLOUR,
    backgroundColor: DEMAND_COLOUR,
    borderWidth: 3,
    tension: 0,
    // The mark, in three channels at once: size, shape and colour. Size alone
    // would be invisible on a projector; colour alone fails section 3.5.
    pointRadius: demandSeries.map((_, index) =>
      isCurrent(index) ? CURRENT_WEEK_POINT_RADIUS : 0,
    ),
    pointHoverRadius: demandSeries.map((_, index) =>
      isCurrent(index) ? CURRENT_WEEK_POINT_RADIUS : 4,
    ),
    pointStyle: demandSeries.map((_, index) => (isCurrent(index) ? 'rectRot' : 'circle')),
    pointBackgroundColor: demandSeries.map((_, index) =>
      isCurrent(index) ? CURRENT_WEEK_COLOUR : DEMAND_COLOUR,
    ),
    pointBorderColor: DEMAND_COLOUR,
    pointBorderWidth: demandSeries.map((_, index) => (isCurrent(index) ? 3 : 1)),
  }

  return {
    type: 'line',
    data: {
      labels: demandSeries.map((_, index) => String(index + 1)),
      datasets: [dataset],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
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
