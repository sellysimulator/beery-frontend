import type { ReactElement } from 'react'
import { Line } from 'react-chartjs-2'
import '../charts/chartSetup'
import type { ResultsView, RoleResultView } from '../charts/chartSetup'
import ChartBox from '../charts/ChartBox'
import Legend, { type LegendItem } from '../charts/Legend'
import CrosshairGroup, { useCrosshairGroup } from '../charts/plugins/CrosshairGroup'
import '../charts/plugins/crosshairSync'
import { QUANTITY_COLOUR } from '../charts/chartTheme'
import { ROLE_LABEL } from '../lobby/roleCopy'
import { ROLE_ORDER } from '../../types/game'
import {
  BACKLOG_SERIES_LABEL,
  STOCK_SERIES_LABEL,
  buildNetInventoryConfig,
} from './resultsChartsConfig'

export interface NetInventoryChartProps {
  view: ResultsView
}

const LEGEND: LegendItem[] = [
  { key: 'stock', label: STOCK_SERIES_LABEL, swatch: { kind: 'fill', color: QUANTITY_COLOUR.inventory } },
  { key: 'backlog', label: BACKLOG_SERIES_LABEL, swatch: { kind: 'fill', color: QUANTITY_COLOUR.backlog } },
]

/** Week, on hand and backlog (positive), exactly as the server sent them. */
function PanelTable({ view, entry }: { view: ResultsView; entry: RoleResultView }): ReactElement {
  const weeks = Array.from({ length: view.weeks_played }, (_, index) => index)
  return (
    <table className="w-full text-left text-sm">
      <caption className="sr-only">
        {ROLE_LABEL[entry.role]}: stock on hand and backlog, week by week
      </caption>
      <thead>
        <tr>
          <th scope="col" className="px-3 py-1">Week</th>
          <th scope="col" className="px-3 py-1">{STOCK_SERIES_LABEL}</th>
          <th scope="col" className="px-3 py-1">{BACKLOG_SERIES_LABEL}</th>
        </tr>
      </thead>
      <tbody>
        {weeks.map((index) => (
          <tr key={index}>
            <th scope="row" className="px-3 py-1 font-normal">{index + 1}</th>
            <td className="numeric px-3 py-1">{entry.inventory?.[index]}</td>
            <td className="numeric px-3 py-1">{entry.backlog?.[index]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Panel({ view, entry }: { view: ResultsView; entry: RoleResultView }): ReactElement {
  const group = useCrosshairGroup()
  const config = buildNetInventoryConfig(view, entry.role, group)
  return (
    <ChartBox
      title={ROLE_LABEL[entry.role]}
      headingLevel={3}
      ariaLabel={`${ROLE_LABEL[entry.role]}: stock on hand above the axis, backlog below it, by week`}
      height={200}
      table={<PanelTable view={view} entry={entry} />}
    >
      <Line data={config.data} options={config.options} />
    </ChartBox>
  )
}

/**
 * Four small panels, one per role, sharing one y-range and one crosshair.
 * Stock hangs above zero and backlog below it; both are server series.
 * Rendered only when every role carries both, which is the URL path.
 */
export function NetInventoryChart({ view }: NetInventoryChartProps): ReactElement | null {
  const complete =
    view.per_role.length > 0 && view.per_role.every((entry) => entry.inventory && entry.backlog)
  if (!complete) return null

  return (
    <section data-print="omit" aria-labelledby="results-net-inventory" className="flex flex-col gap-3">
      <h2 id="results-net-inventory" className="text-2xl font-semibold">
        Net inventory
      </h2>
      <Legend items={LEGEND} ariaLabel="Net inventory key" />
      <CrosshairGroup>
        <div className="grid gap-4 md:grid-cols-2">
          {ROLE_ORDER.flatMap((role) => {
            const entry = view.per_role.find((candidate) => candidate.role === role)
            return entry ? [<Panel key={role} view={view} entry={entry} />] : []
          })}
        </div>
      </CrosshairGroup>
    </section>
  )
}

export default NetInventoryChart
