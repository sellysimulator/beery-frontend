import type { ReactElement } from 'react'
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import type { WeekRecord } from '../../types/game'
import ChartBox from '../charts/ChartBox'
import Legend, { type LegendItem } from '../charts/Legend'
import { QUANTITY_COLOUR } from '../charts/chartTheme'
import { CrosshairGroup, useCrosshairGroup } from '../charts/plugins/CrosshairGroup'
import '../charts/plugins/crosshairSync'
import {
  BACKLOG_LABEL,
  ON_HAND_LABEL,
  ON_THE_WAY_LABEL,
  PLACED_LABEL,
  RECEIVED_LABEL,
  buildOwnOrdersConfig,
  buildOwnStockConfig,
} from './ownHistoryConfig'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip)

export interface OwnHistoryChartProps {
  /** `your_state.own_history` — this player's own weeks, and nobody else's. */
  history: WeekRecord[]
}

const STOCK_LEGEND: LegendItem[] = [
  { key: 'on-hand', label: ON_HAND_LABEL, swatch: { kind: 'fill', color: QUANTITY_COLOUR.inventory } },
  { key: 'on-the-way', label: ON_THE_WAY_LABEL, swatch: { kind: 'fill', color: QUANTITY_COLOUR.supplyLine } },
  { key: 'backlog', label: BACKLOG_LABEL, swatch: { kind: 'fill', color: QUANTITY_COLOUR.backlog } },
]

const ORDERS_LEGEND: LegendItem[] = [
  {
    key: 'received',
    label: RECEIVED_LABEL,
    swatch: { kind: 'line', color: QUANTITY_COLOUR.inventory, dash: [6, 3] },
  },
  { key: 'placed', label: PLACED_LABEL, swatch: { kind: 'line', color: QUANTITY_COLOUR.order } },
]

/**
 * Each `WeekRecord` field is in exactly one of the two tables, once per week,
 * so every figure is in the document once (the 3D board's AC 17).
 */
function StockTable({ history }: { history: WeekRecord[] }): ReactElement {
  return (
    <table className="w-full text-sm">
      <caption className="text-left text-sm text-ink-muted">
        Your stock, week by week
      </caption>
      <thead>
        <tr>
          <th scope="col">Week</th>
          <th scope="col">On hand</th>
          <th scope="col">Backlog</th>
          <th scope="col">On the way</th>
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
            <td className="numeric">{record.supply_line_after}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function OrdersTable({ history }: { history: WeekRecord[] }): ReactElement {
  return (
    <table className="w-full text-sm">
      <caption className="text-left text-sm text-ink-muted">
        Your orders, week by week
      </caption>
      <thead>
        <tr>
          <th scope="col">Week</th>
          <th scope="col">Received</th>
          <th scope="col">Placed</th>
        </tr>
      </thead>
      <tbody>
        {history.map((record) => (
          <tr key={record.week}>
            <th scope="row" className="font-normal">
              {record.week}
            </th>
            <td className="numeric">{record.incoming_order}</td>
            <td className="numeric">{record.order}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** The two panels. They read the group from context, so they sit inside `CrosshairGroup`. */
function Panels({ history }: { history: WeekRecord[] }): ReactElement {
  const group = useCrosshairGroup()
  const stock = buildOwnStockConfig(history, group)
  const orders = buildOwnOrdersConfig(history, group)

  return (
    <>
      <ChartBox
        title="Your stock"
        headingLevel={3}
        caption="What you hold, what is owed, and what is on its way"
        ariaLabel="Your on hand, backlog and on-the-way units, week by week"
        height={220}
        legend={<Legend items={STOCK_LEGEND} />}
        table={<StockTable history={history} />}
      >
        <Line data={stock.data} options={stock.options} />
      </ChartBox>
      <ChartBox
        title="Your orders"
        headingLevel={3}
        caption="What you were asked for, and what you asked for"
        ariaLabel="Orders you received and orders you placed, week by week"
        height={220}
        legend={<Legend items={ORDERS_LEGEND} />}
        table={<OrdersTable history={history} />}
      >
        <Line data={orders.data} options={orders.options} />
      </ChartBox>
    </>
  )
}

/**
 * The player's **own** history across the weeks so far, as two panels that
 * share one crosshair (`beer-game-spec.md` section 9.3): stock on top, orders
 * below.
 *
 * Never anyone else's: the only input is `your_state.own_history`, which the
 * server built for this role alone. The chart the whole class sees belongs to
 * the results screen (section 21).
 *
 * Each `ChartBox` wraps its canvas in an error boundary, because a chart that
 * cannot get a drawing context must not take the game screen down with it;
 * the same figures are in its table either way.
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

  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised px-5 py-4"
      aria-label="Your history"
    >
      <h2 className="text-xl font-semibold">Your history</h2>
      <CrosshairGroup>
        <Panels history={history} />
      </CrosshairGroup>
    </section>
  )
}

export default OwnHistoryChart
