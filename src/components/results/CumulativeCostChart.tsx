import type { ReactElement } from 'react'
import { Line } from 'react-chartjs-2'
import '../charts/chartSetup'
import type { ResultsView } from '../charts/chartSetup'
import ChartBox from '../charts/ChartBox'
import Legend, { type LegendItem } from '../charts/Legend'
import { roleStyle } from '../charts/chartTheme'
import { ROLE_LABEL } from '../lobby/roleCopy'
import { formatMoney } from './CostSummary'
import { buildCumulativeCostConfig } from './resultsChartsConfig'

export interface CumulativeCostChartProps {
  view: ResultsView
  revealed: boolean
}

/**
 * The cost race: each role's running cost, week by week.
 *
 * Costs are hidden until the host presses Reveal, so before that this renders
 * nothing at all. Persisted path only.
 */
export function CumulativeCostChart({
  view,
  revealed,
}: CumulativeCostChartProps): ReactElement | null {
  if (!revealed) return null
  if (view.per_role.length === 0 || view.per_role.some((entry) => !entry.cumulative_cost)) {
    return null
  }

  const config = buildCumulativeCostConfig(view)
  const weeks = Array.from({ length: view.weeks_played }, (_, index) => index)
  const legend: LegendItem[] = view.per_role.map((entry) => ({
    key: entry.role,
    label: ROLE_LABEL[entry.role],
    swatch: { kind: 'line', color: roleStyle(entry.role).colour, dash: roleStyle(entry.role).dash },
  }))

  return (
    <section data-print="omit" aria-labelledby="results-cost-race" className="flex flex-col gap-3">
      <h2 id="results-cost-race" className="text-2xl font-semibold">
        The cost race
      </h2>
      <ChartBox
        title="Cost so far, by role"
        headingLevel={3}
        ariaLabel="Each role's running cost, week by week"
        height={320}
        legend={<Legend items={legend} ariaLabel="Roles" />}
        table={
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Each role&apos;s running cost, week by week</caption>
            <thead>
              <tr>
                <th scope="col" className="px-3 py-1">Week</th>
                {view.per_role.map((entry) => (
                  <th key={entry.role} scope="col" className="px-3 py-1">
                    {ROLE_LABEL[entry.role]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((index) => (
                <tr key={index}>
                  <th scope="row" className="px-3 py-1 font-normal">{index + 1}</th>
                  {view.per_role.map((entry) => {
                    const value = entry.cumulative_cost?.[index]
                    return (
                      <td key={entry.role} className="numeric px-3 py-1">
                        {value === undefined ? null : formatMoney(view.currency_symbol, value)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        }
      >
        <Line data={config.data} options={config.options} />
      </ChartBox>
    </section>
  )
}

export default CumulativeCostChart
