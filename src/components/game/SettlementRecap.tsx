/* eslint-disable react-refresh/only-export-components --
   `formatMoney` is the recap's own rendering rule and the decision panel needs
   the identical one. D19 leaves section 19 no shared module, and two copies of
   a money formatter is how two parts of one screen start disagreeing. */
import type { ReactElement } from 'react'
import type { PlayerView } from '../../types/game'
import { DEMAND_SOURCE_LABEL, RECEIPT_LABEL } from './RoleBanner'

/**
 * The only money rule on this screen: the server's figure, the configured
 * symbol, two decimals. A negative balance reads `-$5.00`, not `$-5.00`.
 *
 * Nothing here multiplies, adds or derives — every figure passed in traces to
 * a `your_state` field (`00-conventions.md` section 4).
 */
export function formatMoney(symbol: string, value: number): string {
  const magnitude = Math.abs(value).toFixed(2)
  return value < 0 ? `-${symbol}${magnitude}` : `${symbol}${magnitude}`
}

export interface SettlementRecapProps {
  view: PlayerView
  /** A brief post-transition highlight, under 400 ms (§3.2). */
  highlight?: boolean
}

/**
 * "What just happened", as a step-by-step ledger rather than a single number
 * (`beer-game-spec.md` section 9.3).
 *
 * It is a semantic table with row headers so a screen reader reads it as a
 * ledger (§3.4), and every line is read straight out of
 * `your_state.settlement`. The units and the rate in a cost line are text; the
 * money beside them is the server's figure. A component that multiplied the
 * two would be right until the day the server rounded differently, and then
 * wrong in a way nobody could explain  [HARD-WON].
 */
export function SettlementRecap({ view, highlight = false }: SettlementRecapProps): ReactElement {
  const settlement = view.settlement
  const symbol = view.currency_symbol
  const money = (value: number): string => formatMoney(symbol, value)

  if (!settlement) {
    return (
      <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised px-5 py-4">
        <h2 className="text-xl font-semibold">Nothing has settled yet</h2>
        <p className="text-ink-muted">
          This is where each week's recap appears: what arrived, what your customer asked
          for, how much you shipped, and what it cost you. It is the only feedback you
          get, so read it.
        </p>
      </section>
    )
  }

  // The doc's display pair: opening inventory, then opening inventory plus
  // what arrived (§2.5). Both numbers come from the settlement.
  const afterArrival = settlement.opening_inventory + settlement.arrived
  const showRunningTotal =
    view.balance !== undefined || view.accumulated_cost !== undefined

  return (
    <section
      className={`flex flex-col gap-3 rounded-lg border bg-surface-raised px-5 py-4 transition-shadow duration-300 ${
        highlight ? 'border-brand ring-2 ring-brand' : 'border-border'
      }`}
    >
      <table className="w-full text-left">
        <caption className="pb-2 text-left text-xl font-semibold">
          {`Week ${settlement.week} settlement`}
        </caption>
        <tbody className="text-lg">
          <tr>
            <th scope="row" className="py-1 pr-4 font-normal">
              {RECEIPT_LABEL[settlement.role]}
            </th>
            <td className="numeric py-1 pr-4 text-right">{`+${settlement.arrived}`}</td>
            <td className="py-1 text-ink-muted">
              {`inventory ${settlement.opening_inventory} → ${afterArrival}`}
            </td>
          </tr>

          <tr>
            <th scope="row" className="py-1 pr-4 font-normal">
              {`${DEMAND_SOURCE_LABEL[settlement.role]} ordered`}
            </th>
            <td className="numeric py-1 pr-4 text-right">{settlement.incoming_order}</td>
            <td className="py-1 text-ink-muted">
              {settlement.opening_backlog > 0
                ? `plus ${settlement.opening_backlog} owed from before, ${settlement.obligation} to ship in all`
                : ''}
            </td>
          </tr>

          <tr>
            <th scope="row" className="py-1 pr-4 font-normal">
              You shipped
            </th>
            <td className="numeric py-1 pr-4 text-right">{settlement.shipped}</td>
            <td className="py-1 text-ink-muted">
              {`inventory ${afterArrival} → ${settlement.closing_inventory}`}
            </td>
          </tr>

          <tr>
            <th scope="row" className="py-1 pr-4 font-normal">
              Unfulfilled
            </th>
            <td className="numeric py-1 pr-4 text-right">{settlement.unfulfilled}</td>
            <td className="py-1 text-ink-muted">
              {settlement.unfulfilled === 0
                ? `backlog stays ${settlement.closing_backlog}`
                : `backlog now ${settlement.closing_backlog}`}
            </td>
          </tr>

          <tr>
            <th scope="row" className="py-1 pr-4 font-normal">
              Holding cost
            </th>
            <td className="py-1 pr-4 text-ink-muted">
              {`${settlement.closing_inventory} units × ${money(
                view.holding_cost_per_unit_week,
              )}`}
            </td>
            <td className="numeric py-1 text-right">{money(settlement.holding_cost)}</td>
          </tr>

          <tr>
            <th scope="row" className="py-1 pr-4 font-normal">
              Backlog cost
            </th>
            <td className="py-1 pr-4 text-ink-muted">
              {`${settlement.closing_backlog} units × ${money(
                view.backlog_cost_per_unit_week,
              )}`}
            </td>
            <td className="numeric py-1 text-right">{money(settlement.backlog_cost)}</td>
          </tr>

          <tr className="border-t border-border-strong">
            <th scope="row" className="py-1 pr-4 font-semibold">
              Week cost
            </th>
            <td className="py-1 pr-4" />
            <td className="numeric py-1 text-right font-semibold">
              {money(settlement.carrying_cost)}
            </td>
          </tr>

          {/* The running total is the one line `show_running_cost_to_players`
              gates. With the flag off the server sends neither `balance` nor
              `accumulated_cost`, and this row is absent entirely (§2.5). */}
          {showRunningTotal ? (
            <tr>
              <th scope="row" className="py-1 pr-4 font-semibold">
                {view.balance !== undefined ? 'Balance' : 'Total so far'}
              </th>
              <td className="py-1 pr-4" />
              <td className="numeric py-1 text-right font-semibold">
                {money(view.balance ?? view.accumulated_cost ?? 0)}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </section>
  )
}

export default SettlementRecap
