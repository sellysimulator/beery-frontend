import type { ReactElement } from 'react'
import type { Role } from '../../types/game'
import type { ResultsView } from '../charts/chartSetup'
import { ROLE_LABEL } from '../lobby/roleCopy'
import { formatMoney } from './CostSummary'

export interface ChainCostBarProps {
  view: ResultsView
  /** Shares the Reveal state with `CostSummary` (section 2.1). */
  revealed: boolean
}

/**
 * Pastel fills, ink text. A pastel on bone is around 1.5:1, so the figure and
 * the label inside each segment are `--color-ink`, and the segment's own hue
 * is the role hue from `src/index.css`.
 */
const SEGMENT_CLASS: Record<Role, string> = {
  RETAILER: 'bg-role-retailer-soft border-role-retailer',
  WHOLESALER: 'bg-role-wholesaler-soft border-role-wholesaler',
  DISTRIBUTOR: 'bg-role-distributor-soft border-role-distributor',
  FACTORY: 'bg-role-factory-soft border-role-factory',
}

/**
 * What the whole chain paid, and how that total is split between the four
 * stages.
 *
 * The bar's widths are the only derived thing on this screen, and they are
 * geometry rather than a reported figure: every **number** here is a server
 * field printed as it arrived (section 3.2). Each segment is labelled with
 * its role as well as coloured, so the split reads without colour.
 */
export function ChainCostBar({ view, revealed }: ChainCostBarProps): ReactElement {
  const total = view.chain_total_cost
  const symbol = view.currency_symbol

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border-strong bg-surface-sunken px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold">The chain paid</h3>
        <p className="numeric text-figure" aria-label="Chain total cost">
          {revealed ? formatMoney(symbol, total) : '•••'}
        </p>
      </div>

      {revealed && total > 0 ? (
        <div className="flex h-10 w-full overflow-hidden rounded-md border border-border">
          {view.per_role.map((role) => (
            <div
              key={role.role}
              className={`${SEGMENT_CLASS[role.role]} flex items-center justify-center overflow-hidden border-l-4 px-1 text-xs whitespace-nowrap text-ink`}
              style={{ width: `${(role.total_cost / total) * 100}%` }}
              title={`${ROLE_LABEL[role.role]} ${formatMoney(symbol, role.total_cost)}`}
            >
              {ROLE_LABEL[role.role]}
            </div>
          ))}
        </div>
      ) : (
        <div className="h-10 w-full rounded-md border border-dashed border-border-strong bg-surface" />
      )}
    </div>
  )
}

export default ChainCostBar
