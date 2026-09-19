import type { ReactElement } from 'react'
import type { ResultsView, RoleResultView } from '../charts/chartSetup'
import { ROLE_LABEL } from '../lobby/roleCopy'

export interface RoleStatsTableProps {
  view: ResultsView
}

/** Why a ratio can be missing, in the room's language (**D12**). */
export const NULL_RATIO_EXPLANATION =
  "Customer demand never varied, so there's nothing to amplify."

/** Why a fill rate can be missing. */
const NULL_FILL_RATE_EXPLANATION = 'Nothing was ever demanded of this role.'

/**
 * The rule for the table's three *rates* — the ratio, the variance and the
 * average order: the server's number, two decimals.
 *
 * Counts do not go through here. `peak_inventory`, `peak_backlog` and
 * `weeks_in_backlog` are quantities, which `00-conventions.md` §4 makes `int`
 * everywhere, and "2.00 weeks in backlog" is wrong on a screen a host
 * projects (FM 14). Either way nothing is rounded before it is displayed,
 * added to, or derived from another figure (§3.2).
 */
function figure(value: number): string {
  return value.toFixed(2)
}

/** The em dash a missing figure renders as. Never `0`, never `∞`, never `NaN`. */
const MISSING = '—'

/** The ids the dashes point at, so the footnote explains the right one. */
const RATIO_NOTE_ID = 'results-null-ratio-note'
const FILL_RATE_NOTE_ID = 'results-null-fill-rate-note'

/**
 * A missing figure: the em dash, and nothing else in the cell.
 *
 * The explanation is the dash's tooltip and its accessible description — it
 * is deliberately **not** a text node inside the cell, because a cell that
 * reads `—Customer demand never varied…` is no longer a table of figures.
 */
function Missing({
  explanation,
  noteId,
}: {
  explanation: string
  noteId: string
}): ReactElement {
  return (
    <span title={explanation} aria-label={explanation} aria-describedby={noteId}>
      {MISSING}
    </span>
  )
}

function StatsRow({ role }: { role: RoleResultView }): ReactElement {
  return (
    <tr className="border-t border-border">
      <th scope="row" className="px-3 py-3 text-left font-semibold">
        <span className="flex items-center gap-2">
          {ROLE_LABEL[role.role]}
          {role.is_bot ? (
            <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand-strong">
              Bot
            </span>
          ) : null}
        </span>
      </th>
      <td className="numeric bg-brand-soft px-3 py-3 text-2xl font-bold text-ink">
        {role.bullwhip_ratio === null ? (
          <Missing explanation={NULL_RATIO_EXPLANATION} noteId={RATIO_NOTE_ID} />
        ) : (
          figure(role.bullwhip_ratio)
        )}
      </td>
      <td className="numeric px-3 py-3">{figure(role.order_variance)}</td>
      <td className="numeric px-3 py-3">{role.peak_inventory}</td>
      <td className="numeric px-3 py-3">{role.peak_backlog}</td>
      <td className="numeric px-3 py-3">{role.weeks_in_backlog}</td>
      <td className="numeric px-3 py-3">
        {role.fill_rate === null ? (
          <Missing explanation={NULL_FILL_RATE_EXPLANATION} noteId={FILL_RATE_NOTE_ID} />
        ) : (
          `${(role.fill_rate * 100).toFixed(0)}%`
        )}
      </td>
      <td className="numeric px-3 py-3">{figure(role.average_order)}</td>
    </tr>
  )
}

/**
 * How much each stage amplified, and the detail behind it (sections 2.3 and
 * 2.4 of the debrief order).
 *
 * Rows run Retailer → Factory so the amplification reads top to bottom, and
 * the ratio is the first and heaviest column because it is the one the host
 * reads aloud.
 *
 * Every cell is a server field printed as it arrived. A `null` ratio is the
 * `CONSTANT` generator — variance in demand of zero — and renders as an em
 * dash carrying its explanation, never as `0`, `∞` or `NaN` (**D12**).
 */
export function RoleStatsTable({ view }: RoleStatsTableProps): ReactElement {
  const missingRatio = view.per_role.some((role) => role.bullwhip_ratio === null)
  const missingFillRate = view.per_role.some((role) => role.fill_rate === null)

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface-raised">
      <table className="w-full text-left">
        <caption className="px-3 py-3 text-left text-sm text-ink-muted">
          The bullwhip ratio is the variance of a role&apos;s orders divided by the
          variance of true customer demand. The server computes it; this screen prints
          it.
        </caption>
        <thead>
          <tr className="bg-surface-sunken">
            <th scope="col" className="px-3 py-3">
              Role
            </th>
            <th scope="col" className="px-3 py-3">
              Bullwhip ratio
            </th>
            <th scope="col" className="px-3 py-3">
              Order variance
            </th>
            <th scope="col" className="px-3 py-3">
              Peak inventory
            </th>
            <th scope="col" className="px-3 py-3">
              Peak backlog
            </th>
            <th scope="col" className="px-3 py-3">
              Weeks in backlog
            </th>
            <th scope="col" className="px-3 py-3">
              Fill rate
            </th>
            <th scope="col" className="px-3 py-3">
              Average order
            </th>
          </tr>
        </thead>
        <tbody>
          {view.per_role.map((role) => (
            <StatsRow key={role.role} role={role} />
          ))}
        </tbody>
      </table>
      {missingRatio ? (
        <p id={RATIO_NOTE_ID} className="px-3 py-2 text-sm text-ink-muted">
          {MISSING} {NULL_RATIO_EXPLANATION}
        </p>
      ) : null}
      {missingFillRate ? (
        <p id={FILL_RATE_NOTE_ID} className="px-3 py-2 text-sm text-ink-muted">
          {MISSING} {NULL_FILL_RATE_EXPLANATION}
        </p>
      ) : null}
    </div>
  )
}

export default RoleStatsTable
