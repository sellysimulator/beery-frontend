import type { ReactElement } from 'react'
import { ROLE_ORDER, type GameConfig } from '../../types/game'
import { LEAD_TIME_HELP, LEAD_TIME_LABEL, ROLE_COLUMN_LABEL } from './copy'
import { useConfigPreview } from './useConfigPreview'

function weeks(count: number): string {
  return count === 1 ? '1 week' : `${count} weeks`
}

export interface LeadTimeRowProps {
  /** The stored config. Its lead times are the server's, for exactly this config. */
  config: GameConfig
}

/**
 * The last row of the starting-conditions grid: how long each role waits
 * between ordering and the beer arriving.
 *
 * The figure is the server's (`POST /rooms/preview`, 2026-11-03), from the
 * same `GameConfig.order_arrival_lead_weeks` the engine sends every player as
 * `order_arrival_lead_weeks`. It is not the sum of two cells above: an order
 * spends the **supplier's** order delay travelling, the Factory's lead time is
 * its production delay alone, and a grid that added up its own columns would
 * get both ends of the chain wrong. Until the server has answered, each cell
 * says so.
 */
export function LeadTimeRow({ config }: LeadTimeRowProps): ReactElement {
  const { preview, error } = useConfigPreview(config)

  return (
    <tr className="border-t border-border align-top" data-testid="lead-time-row">
      <th scope="row" className="py-3 pr-4 text-sm font-normal text-ink">
        <span className="block font-medium">{LEAD_TIME_LABEL}</span>
        <span className="block text-xs text-ink-muted">{error ?? LEAD_TIME_HELP}</span>
      </th>
      {ROLE_ORDER.map((role) => (
        <td
          key={role}
          className="numeric px-2 py-3 text-sm text-ink"
          aria-label={`${ROLE_COLUMN_LABEL[role]} — ${LEAD_TIME_LABEL}`}
          data-role={role}
        >
          {preview ? weeks(preview.lead_times[role]) : '…'}
        </td>
      ))}
    </tr>
  )
}

export default LeadTimeRow
