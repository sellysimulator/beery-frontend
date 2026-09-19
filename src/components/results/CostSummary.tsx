/* eslint-disable react-refresh/only-export-components --
   `formatMoney` is this screen's one money rule and three of its components
   need the identical one. Two copies of a money formatter is how two parts of
   one screen start disagreeing. */
import type { ReactElement } from 'react'
import type { ResultsView, RoleResultView } from '../charts/chartSetup'
import { ROLE_LABEL } from '../lobby/roleCopy'

/**
 * The only money rule on this screen: the server's figure, the configured
 * symbol, two decimals. A negative figure reads `-$5.00`, not `$-5.00`.
 *
 * Nothing here multiplies, adds or derives (section 3.2).
 */
export function formatMoney(symbol: string, value: number): string {
  const magnitude = Math.abs(value).toFixed(2)
  return value < 0 ? `-${symbol}${magnitude}` : `${symbol}${magnitude}`
}

export interface CostSummaryProps {
  view: ResultsView
  /** Costs are hidden until the host presses Reveal (section 2.1). */
  revealed: boolean
  onToggle: () => void
}

/** The placeholder a hidden figure leaves behind. */
const HIDDEN = '•••'

function RoleCostCard({
  role,
  symbol,
  revealed,
}: {
  role: RoleResultView
  symbol: string
  revealed: boolean
}): ReactElement {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface-raised px-5 py-4">
      <h3 className="text-lg font-semibold">{ROLE_LABEL[role.role]}</h3>
      <p className="flex items-center gap-2 text-sm text-ink-muted">
        {role.display_name ? <span>{role.display_name}</span> : null}
        {role.is_bot ? (
          <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand-strong">
            Bot
          </span>
        ) : null}
      </p>
      <p className="numeric text-figure text-ink" aria-label={`${ROLE_LABEL[role.role]} total cost`}>
        {revealed ? formatMoney(symbol, role.total_cost) : HIDDEN}
      </p>
    </div>
  )
}

/**
 * Final cost per role — the first thing the debrief walks through, and the
 * one the manual tells the host to make the room guess at before showing
 * (`beer-game-manual.md` Part 1 Step 7).
 *
 * The Reveal control is part of the debrief, not part of the handout, so it
 * carries `data-print="omit"` (section 3.3).
 */
export function CostSummary({ view, revealed, onToggle }: CostSummaryProps): ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <div data-print="omit" className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={revealed}
          className="rounded-md bg-brand px-4 py-2 font-semibold text-ink-inverse transition hover:bg-brand-strong"
        >
          {revealed ? 'Hide the costs' : 'Reveal the costs'}
        </button>
        {revealed ? null : (
          <p className="text-sm text-ink-muted">
            Ask the room who they think did worst before you reveal it.
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {view.per_role.map((role) => (
          <RoleCostCard
            key={role.role}
            role={role}
            symbol={view.currency_symbol}
            revealed={revealed}
          />
        ))}
      </div>
    </div>
  )
}

export default CostSummary
