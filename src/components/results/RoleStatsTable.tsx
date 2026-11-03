import type { ReactElement } from 'react'
import type { ResultsView, RoleResultView } from '../charts/chartSetup'
import { ROLE_LABEL } from '../lobby/roleCopy'

export interface RoleStatsTableProps {
  view: ResultsView
}

/** Why a ratio can be missing, in the room's language (**D12**). */
export const NULL_RATIO_EXPLANATION =
  "Customer demand never varied, so there's nothing to amplify."

/**
 * What the `fill_rate` column is called on screen.
 *
 * The figure is `sum(shipped) / sum(obligation)` over the weeks played (**D12**),
 * and `obligation` counts the opening backlog again every week it is still
 * owed. "Fill rate" reads as "the share of orders eventually filled", which
 * this is not: a unit that waits three weeks is owed three times and shipped
 * once. The name says what it measures instead, and the definition sits beside
 * it so nobody has to guess (2026-11-02). The field keeps its wire name.
 */
export const SHIPPED_VS_WAITING_LABEL = 'Shipped vs waiting'

/** The one-line definition printed under the table. */
export const SHIPPED_VS_WAITING_DEFINITION =
  "Units shipped ÷ units owed, counting each week's backlog again, so a backlog that waits several weeks lowers it even if every unit is eventually shipped."

/** Why the shipped-vs-waiting figure can be missing: nothing was ever owed. */
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
/** The definition's id, which the column header points at. */
const FILL_RATE_DEFINITION_ID = 'results-shipped-vs-waiting-definition'

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

/*
 * The inline bar's fixed log domain, 0.1x to 1000x, clamped at the ends. Its
 * position is pure geometry from the server's ratio; it carries no text.
 */
const BAR_MIN = 0.1
const BAR_MAX = 1000

function logShare(value: number): number {
  const clamped = Math.min(BAR_MAX, Math.max(BAR_MIN, value))
  return (Math.log10(clamped) - Math.log10(BAR_MIN)) / (Math.log10(BAR_MAX) - Math.log10(BAR_MIN))
}

/** A decorative bar beside the ratio, with a tick where the ratio is 1x. */
function InlineRatioBar({ ratio }: { ratio: number }): ReactElement {
  return (
    <span
      aria-hidden="true"
      data-print="omit"
      className="relative block h-2 w-24 shrink-0 rounded-sm bg-surface-sunken"
    >
      <span
        className="absolute inset-y-0 left-0 rounded-sm bg-brand"
        style={{ width: `${logShare(ratio) * 100}%` }}
      />
      <span
        className="absolute -inset-y-0.5 w-px bg-ink-muted"
        style={{ left: `${logShare(1) * 100}%` }}
      />
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
        <span className="flex items-center gap-3">
          {role.bullwhip_ratio === null ? (
            <Missing explanation={NULL_RATIO_EXPLANATION} noteId={RATIO_NOTE_ID} />
          ) : (
            figure(role.bullwhip_ratio)
          )}
          {role.bullwhip_ratio !== null && role.bullwhip_ratio > 0 ? (
            <InlineRatioBar ratio={role.bullwhip_ratio} />
          ) : null}
        </span>
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
            <th scope="col" className="px-3 py-3" aria-describedby={FILL_RATE_DEFINITION_ID}>
              {SHIPPED_VS_WAITING_LABEL}
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
      <p id={FILL_RATE_DEFINITION_ID} className="px-3 py-2 text-sm text-ink-muted">
        <strong className="font-semibold text-ink">{SHIPPED_VS_WAITING_LABEL}:</strong>{' '}
        {SHIPPED_VS_WAITING_DEFINITION}
      </p>
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
