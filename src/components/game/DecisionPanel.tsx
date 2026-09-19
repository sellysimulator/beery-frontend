import type { ReactElement } from 'react'
import { ROLE_ORDER, type PlayerView } from '../../types/game'
import { ROLE_LABEL } from '../lobby/roleCopy'
import { formatMoney } from './SettlementRecap'
import SupplyLine from './SupplyLine'

/** The warning mark that rides with every backlog figure (§3.4, AC 8). */
function BacklogIcon(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-7 w-7 shrink-0"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M12 3 1.5 21h21L12 3Z"
        fill="currentColor"
        fillOpacity="0.18"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M12 9.5v5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="12" cy="17.6" r="1.1" fill="currentColor" />
    </svg>
  )
}

interface FigureProps {
  label: string
  value: number
  detail?: string
  tone?: string
}

function Figure({ label, value, detail, tone = 'text-ink' }: FigureProps): ReactElement {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface-raised px-4 py-3">
      <h3 className="text-sm uppercase tracking-wide text-ink-muted">{label}</h3>
      <p className={`numeric text-figure ${tone}`}>{value}</p>
      {detail ? <p className="text-sm text-ink-muted">{detail}</p> : null}
    </div>
  )
}

export interface DecisionPanelProps {
  view: PlayerView
}

/**
 * "What you have" — always visible, always in the same order
 * (`beer-game-spec.md` section 9.1, §2.2).
 *
 * Every figure is a `your_state` field rendered as it arrived. The panel
 * computes nothing, not even a total: `supply_line` and `orders_in_flight` are
 * the server's sums, not sums of the slot lists beside them.
 *
 * The conditional blocks below the core each appear only when the server sent
 * their field, which is exactly when the host's visibility flag is on — the
 * redaction happened server-side, before the payload was built
 * (`07-game-engine.md` section 3.8).
 */
export function DecisionPanel({ view }: DecisionPanelProps): ReactElement {
  const money = (value: number): string => formatMoney(view.currency_symbol, value)
  const showRunningCost =
    view.week_cost !== undefined ||
    view.accumulated_cost !== undefined ||
    view.balance !== undefined

  const neighbours = view.neighbours
  const neighbourEntries = neighbours
    ? ROLE_ORDER.filter((role) => neighbours[role] !== undefined)
    : []

  return (
    <section className="flex flex-col gap-4" aria-label="What you have">
      <div className="grid gap-3 sm:grid-cols-2">
        <Figure
          label="On hand"
          value={view.inventory}
          detail="Beer in your warehouse right now."
          tone="text-inventory"
        />

        {view.backlog > 0 ? (
          <div className="flex flex-col gap-1 rounded-lg border border-backlog bg-backlog-soft px-4 py-3 text-backlog">
            <h3 className="text-sm uppercase tracking-wide">Backlog</h3>
            <div className="flex items-center gap-3">
              <BacklogIcon />
              <p className="numeric text-figure">{`${view.backlog} units owed`}</p>
            </div>
            <p className="text-sm">
              You still have to ship these, and they cost you every week until you do.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface-raised px-4 py-3">
            <h3 className="text-sm uppercase tracking-wide text-ink-muted">Backlog</h3>
            <p className="numeric text-figure">0</p>
            <p className="text-sm text-ink-muted">
              Nothing owed. Everything your customer has asked for has gone out.
            </p>
          </div>
        )}
      </div>

      <SupplyLine
        kind="shipments"
        slots={view.supply_line_slots}
        total={view.supply_line}
        prominent={view.show_supply_line_prominently}
      />

      {/* "Orders you've placed" is what this role has ordered and its supplier
          has not yet received — the supplier's order pipeline, whose contents
          are by construction this role's own orders. The Factory has no
          supplier, and its production order is already counted in the supply
          line, so the block is absent for that role and only that role
          (AC 7, `07-game-engine.md` section 3.8). It is never the role's own
          order pipeline, which would show next week's demand. */}
      {view.role === 'FACTORY' ? null : (
        <SupplyLine
          kind="orders"
          slots={view.orders_in_flight_slots}
          total={view.orders_in_flight}
          prominent={view.show_supply_line_prominently}
        />
      )}

      <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface-raised px-4 py-3">
        <h3 className="text-sm uppercase tracking-wide text-ink-muted">
          This week&apos;s incoming order
        </h3>
        <p className="numeric text-figure">{view.incoming_order}</p>
        <p className="text-sm text-ink-muted">How much your customer wants from you.</p>
      </div>

      {showRunningCost ? (
        <div
          className="flex flex-col gap-1 rounded-lg border border-border bg-surface-raised px-4 py-3"
          aria-label="Your costs"
        >
          <h3 className="text-sm uppercase tracking-wide text-ink-muted">Your costs</h3>
          {view.week_cost !== undefined ? (
            <p className="text-lg">{`This week ${money(view.week_cost)}`}</p>
          ) : null}
          {view.balance !== undefined ? (
            <p className="text-lg font-semibold">{`Balance ${money(view.balance)}`}</p>
          ) : view.accumulated_cost !== undefined ? (
            <p className="text-lg font-semibold">
              {`Accumulated ${money(view.accumulated_cost)}`}
            </p>
          ) : null}
        </div>
      ) : null}

      {neighbourEntries.length > 0 ? (
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface-raised px-4 py-3">
          <h3 className="text-sm uppercase tracking-wide text-ink-muted">
            Your neighbours
          </h3>
          <ul className="flex flex-col gap-1">
            {neighbourEntries.map((role) => (
              <li key={role} className="text-base">
                {`${ROLE_LABEL[role]}: ${view.neighbours?.[role]?.inventory ?? 0} on hand, ${
                  view.neighbours?.[role]?.backlog ?? 0
                } owed`}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {view.chain ? (
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface-raised px-4 py-3">
          <h3 className="text-sm uppercase tracking-wide text-ink-muted">
            The whole chain
          </h3>
          <ul className="flex flex-col gap-1">
            {ROLE_ORDER.map((role) => (
              <li key={role} className="text-base">
                {`${ROLE_LABEL[role]}: ${view.chain?.[role]?.inventory ?? 0} on hand, ${
                  view.chain?.[role]?.backlog ?? 0
                } owed`}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {view.leaderboard ? (
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface-raised px-4 py-3">
          <h3 className="text-sm uppercase tracking-wide text-ink-muted">Leaderboard</h3>
          <ol className="flex flex-col gap-1">
            {view.leaderboard.map((entry) => (
              <li key={entry.role} className="text-base">
                {`${ROLE_LABEL[entry.role]}: ${money(entry.accumulated_cost)}`}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {view.customer_demand_series ? (
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface-raised px-4 py-3">
          <h3 className="text-sm uppercase tracking-wide text-ink-muted">
            True customer demand
          </h3>
          <p className="numeric text-base">{view.customer_demand_series.join(', ')}</p>
          <p className="text-sm text-ink-muted">
            What the public actually bought, week by week, up to now.
          </p>
        </div>
      ) : null}
    </section>
  )
}

export default DecisionPanel
