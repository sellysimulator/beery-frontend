import type { ReactElement } from 'react'
import { Bar } from 'react-chartjs-2'
import '../charts/chartSetup'
import type { ResultsView } from '../charts/chartSetup'
import ChartBox from '../charts/ChartBox'
import { ROLE_LABEL } from '../lobby/roleCopy'
import { ROLE_ORDER, type Role } from '../../types/game'
import { NULL_RATIO_EXPLANATION } from './RoleStatsTable'
import { buildBullwhipRatioConfig } from './resultsChartsConfig'

export interface BullwhipRatioBarsProps {
  view: ResultsView
  /** The roles whose order line is currently on the chart above. */
  shown: readonly Role[]
}

/**
 * The ratio the host reads aloud, drawn: one bar per shown role on a log
 * axis with a 1x rule. A role's bar comes in with its stage.
 */
export function BullwhipRatioBars({ view, shown }: BullwhipRatioBarsProps): ReactElement | null {
  const rows = ROLE_ORDER.flatMap((role) => {
    if (!shown.includes(role)) return []
    const entry = view.per_role.find((candidate) => candidate.role === role)
    return entry ? [entry] : []
  })
  if (rows.length === 0) return null

  const config = buildBullwhipRatioConfig(view, shown)
  const hasZero = rows.some((entry) => entry.bullwhip_ratio === 0)

  return (
    <ChartBox
      title="Amplification by stage"
      headingLevel={3}
      caption={
        hasZero
          ? 'A ratio of zero cannot be drawn on a logarithmic axis, so that role has no bar; its figure is in the table.'
          : undefined
      }
      ariaLabel="Each shown role's bullwhip ratio as a bar on a logarithmic axis"
      height={72 + rows.length * 48}
      table={
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Bullwhip ratio per shown role</caption>
          <thead>
            <tr>
              <th scope="col" className="px-3 py-1">Role</th>
              <th scope="col" className="px-3 py-1">Ratio</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => (
              <tr key={entry.role}>
                <th scope="row" className="px-3 py-1 font-normal">{ROLE_LABEL[entry.role]}</th>
                <td className="numeric px-3 py-1">
                  {entry.bullwhip_ratio === null ? (
                    <span title={NULL_RATIO_EXPLANATION} aria-label={NULL_RATIO_EXPLANATION}>
                      —
                    </span>
                  ) : (
                    entry.bullwhip_ratio.toFixed(2)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <Bar data={config.data} options={config.options} plugins={config.plugins} />
    </ChartBox>
  )
}

export default BullwhipRatioBars
