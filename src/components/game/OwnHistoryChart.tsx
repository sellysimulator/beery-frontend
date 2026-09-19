import type { ReactElement } from 'react'
import {
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import type { WeekRecord } from '../../types/game'
import ErrorBoundary from '../shared/ErrorBoundary'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend)

/**
 * The quantity colours from `index.css`. Chart.js paints onto a canvas, where
 * a CSS custom property is not resolved for it, so the three values are
 * written out here and are the same hues the rest of the screen uses.
 */
const SERIES_COLOUR = {
  inventory: '#1f6f9c',
  backlog: '#a8420a',
  order: '#c98a00',
} as const

const AXIS_COLOUR = '#5c5547'
const GRID_COLOUR = '#e2dac8'

export interface OwnHistoryChartProps {
  /** `your_state.own_history` — this player's own weeks, and nobody else's. */
  history: WeekRecord[]
}

/** The same three series as the chart, read out as a table. */
function HistoryTable({ history }: { history: WeekRecord[] }): ReactElement {
  return (
    <table className="sr-only">
      <caption className="text-left text-sm text-ink-muted">
        Your inventory, backlog and orders, week by week
      </caption>
      <thead>
        <tr>
          <th scope="col">Week</th>
          <th scope="col">On hand</th>
          <th scope="col">Backlog</th>
          <th scope="col">Ordered</th>
        </tr>
      </thead>
      <tbody>
        {history.map((record) => (
          <tr key={record.week}>
            <th scope="row" className="font-normal">
              {record.week}
            </th>
            <td className="numeric">{record.closing_inventory}</td>
            <td className="numeric">{record.closing_backlog}</td>
            <td className="numeric">{record.order}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * A running chart of the player's **own** inventory, backlog and orders
 * across the weeks so far (`beer-game-spec.md` section 9.3).
 *
 * Never anyone else's: the only input is `your_state.own_history`, which the
 * server built for this role alone. The chart the whole class sees — demand
 * against all four order streams — belongs to the results screen (section 21).
 *
 * The canvas is wrapped in an error boundary because a chart that cannot get a
 * drawing context must not take the game screen down with it; the same figures
 * are in the table either way.
 */
export function OwnHistoryChart({ history }: OwnHistoryChartProps): ReactElement {
  if (history.length === 0) {
    return (
      <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised px-5 py-4">
        <h2 className="text-xl font-semibold">Your history</h2>
        <p className="text-ink-muted">
          No week has closed yet. Your inventory, backlog and orders will chart here as
          the game runs, so you can see the effect of decisions you made weeks ago.
        </p>
      </section>
    )
  }

  const data: ChartData<'line', number[], string> = {
    labels: history.map((record) => String(record.week)),
    datasets: [
      {
        label: 'On hand',
        data: history.map((record) => record.closing_inventory),
        borderColor: SERIES_COLOUR.inventory,
        backgroundColor: SERIES_COLOUR.inventory,
        tension: 0.2,
      },
      {
        label: 'Backlog (owed)',
        data: history.map((record) => record.closing_backlog),
        borderColor: SERIES_COLOUR.backlog,
        backgroundColor: SERIES_COLOUR.backlog,
        borderDash: [6, 3],
        tension: 0.2,
      },
      {
        label: 'Orders you placed',
        data: history.map((record) => record.order),
        borderColor: SERIES_COLOUR.order,
        backgroundColor: SERIES_COLOUR.order,
        tension: 0.2,
      },
    ],
  }

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'bottom', labels: { color: AXIS_COLOUR } },
    },
    scales: {
      x: {
        title: { display: true, text: 'Week', color: AXIS_COLOUR },
        ticks: { color: AXIS_COLOUR },
        grid: { color: GRID_COLOUR },
      },
      y: {
        title: { display: true, text: 'Units', color: AXIS_COLOUR },
        ticks: { color: AXIS_COLOUR },
        grid: { color: GRID_COLOUR },
      },
    },
  }

  return (
    <section
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised px-5 py-4"
      aria-label="Your history"
    >
      <h2 className="text-xl font-semibold">Your history</h2>
      <ErrorBoundary
        fallback={
          <p className="text-sm text-ink-muted">
            The chart could not be drawn here. The same week-by-week figures are in the
            table that follows it.
          </p>
        }
      >
        <div className="h-64">
          <Line data={data} options={options} />
        </div>
      </ErrorBoundary>
      <HistoryTable history={history} />
    </section>
  )
}

export default OwnHistoryChart
