import type { ReactElement } from 'react'

/**
 * Which pipeline is being shown. The two read identically — a list of slots
 * and a total — but they are different things and the copy says so, so that a
 * player never has to work out whether "4 next week" is beer coming to them or
 * an order still crawling towards their supplier.
 */
export type PipelineKind = 'shipments' | 'orders'

export interface SupplyLineProps {
  kind: PipelineKind
  /** Front first: slot 0 lands next week. */
  slots: number[]
  /** The server's total. Never a sum of `slots` computed here. */
  total: number
  /**
   * `your_state.show_supply_line_prominently`. When false the breakdown is not
   * rendered at all — not hidden, absent. The host turned it off to make the
   * game harder, and helpfully compensating defeats that (§2.2).
   */
  prominent: boolean
}

/** When the slot at `index` lands, in words. Never a computed week number. */
function whenLabel(index: number): string {
  if (index === 0) return 'next week'
  if (index === 1) return 'the week after'
  return `in ${index + 1} weeks`
}

const COPY: Record<PipelineKind, { title: string; verb: string; totalLabel: string; empty: string }> =
  {
    shipments: {
      title: 'Incoming shipments',
      verb: 'arriving',
      totalLabel: 'Total on the way to you',
      empty: 'Nothing is on its way to you. Anything you order now takes weeks to arrive.',
    },
    orders: {
      title: "Orders you've placed",
      verb: 'reaching your supplier',
      totalLabel: 'Total still travelling upstream',
      empty: 'No orders of yours are still travelling upstream.',
    },
  }

/**
 * The supply line, slot by slot, plus the total.
 *
 * `beer-game-spec.md` section 9.1 calls underweighting this the single most
 * common losing mistake, and `beer-game-manual.md` Part 2 *Advice* says the
 * same in the player's own words. So when the host leaves it prominent it is
 * large, expanded and above the decision input; when the host turns it off, it
 * collapses to a bare total.
 *
 * It computes nothing: `total` is the server's figure, and the slots are the
 * server's list in the server's order.
 */
export function SupplyLine({ kind, slots, total, prominent }: SupplyLineProps): ReactElement {
  const copy = COPY[kind]
  const tone =
    kind === 'shipments'
      ? 'border-supply-line bg-supply-line-soft'
      : 'border-border bg-surface-sunken'

  return (
    <section
      className={`flex flex-col gap-2 rounded-lg border px-4 py-3 ${tone}`}
      aria-label={copy.title}
    >
      <h3 className={prominent ? 'text-lg font-semibold' : 'text-sm font-semibold'}>
        {copy.title}
      </h3>

      {prominent ? (
        slots.length === 0 ? (
          <p className="text-sm text-ink-muted">{copy.empty}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {slots.map((quantity, index) => (
              <li
                key={`${copy.title}-${index}`}
                className={index === 0 ? 'text-xl' : 'text-lg text-ink-muted'}
              >
                {`${quantity} units ${copy.verb} ${whenLabel(index)}`}
              </li>
            ))}
          </ul>
        )
      ) : null}

      <p className={prominent ? 'text-base font-semibold' : 'text-lg font-semibold'}>
        {`${copy.totalLabel}: ${total} units`}
      </p>

      {prominent && kind === 'shipments' ? (
        <p className="text-sm text-ink-muted">
          Pay close attention to this. It is the number most people ignore, and ignoring
          it is how you lose.
        </p>
      ) : null}
    </section>
  )
}

export default SupplyLine
