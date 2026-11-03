import type { CSSProperties, ReactElement } from 'react'
import { Beer, StickyNote } from 'lucide-react'
import { ROLE_ORDER, type Role } from '../../types/game'
import { ROLE_LABEL } from '../lobby/roleCopy'

/**
 * Role colours from `index.css`. The pastel is the fill and the matching -ink
 * hue is the text, because a pastel on bone is around 1.5:1.
 */
const ROLE_CHIP_CLASS: Record<Role, string> = {
  RETAILER: 'border-role-retailer bg-role-retailer-soft text-role-retailer',
  WHOLESALER: 'border-role-wholesaler bg-role-wholesaler-soft text-role-wholesaler',
  DISTRIBUTOR: 'border-role-distributor bg-role-distributor-soft text-role-distributor',
  FACTORY: 'border-role-factory bg-role-factory-soft text-role-factory',
}

/*
 * Seconds between neighbouring lanes' start times. Orders start at the
 * customer and ripple upstream; beer starts at the factory and ripples back,
 * so the eye reads each wave as one thing moving along the chain rather than
 * four icons blinking at once.
 */
const LANE_STAGGER_S = 0.6

export interface ChainFlowProps {
  role: Role
}

/**
 * The chain as one diagram: orders (sticky notes) travel upstream, left to
 * right, and beer travels downstream, right to left, along the same links.
 *
 * Purely illustrative — it animates no game figure, so nothing here derives
 * from the store (architecture rule 1). The two links that touch the player
 * are drawn at full strength because those are the only neighbours they deal
 * with. The animation is decoration: the chips carry the chain as a list, the
 * legend carries the direction as text, and `prefers-reduced-motion` parks the
 * icons mid-lane instead of moving them (`index.css`).
 */
export function ChainFlow({ role }: ChainFlowProps): ReactElement {
  const myIndex = ROLE_ORDER.indexOf(role)

  return (
    <div className="flex flex-col gap-3">
      {/* Wraps rather than scrolls, like the host's ChainDiagram: each lane
          rides after its stop, so a row break leaves the arrow of motion
          pointing off the end of the row towards the next stop. */}
      <ol
        className="flex flex-wrap items-center gap-y-2"
        aria-label="The supply chain, from the customer upstream to the factory"
      >
        <li className="flex flex-1 items-center">
          <span className="shrink-0 rounded-md border border-border-strong bg-surface-sunken px-3 py-1 text-sm text-ink-muted">
            Customer
          </span>
          {/* Lane 0 links the customer and the Retailer. */}
          <FlowLane index={0} dimmed={myIndex !== 0} />
        </li>
        {ROLE_ORDER.map((chainRole, index) => {
          const last = index === ROLE_ORDER.length - 1
          return (
            <li key={chainRole} className={`flex items-center ${last ? '' : 'flex-1'}`}>
              <span
                aria-current={chainRole === role ? 'true' : undefined}
                className={`shrink-0 rounded-md border px-3 py-1 text-sm ${ROLE_CHIP_CLASS[chainRole]} ${
                  chainRole === role ? 'font-semibold ring-2 ring-brand-strong' : 'opacity-80'
                }`}
              >
                {chainRole === role ? `${ROLE_LABEL[chainRole]} (you)` : ROLE_LABEL[chainRole]}
              </span>
              {/* Lane `index + 1` links this role to the one upstream of it;
                  the player touches the lanes either side of their own stop. */}
              {last ? null : (
                <FlowLane
                  index={index + 1}
                  dimmed={index + 1 !== myIndex && index + 1 !== myIndex + 1}
                />
              )}
            </li>
          )
        })}
      </ol>

      <FlowLegend />
      <p className="text-sm text-ink-subtle">You only deal with your immediate neighbours.</p>
    </div>
  )
}

export interface FlowLaneProps {
  /** Which link this is, 0 = Customer–Retailer. Sets the ripple delay. */
  index: number
  /** Draw at half strength — a link the viewer does not deal with. */
  dimmed?: boolean
  /** Projector sizing: bigger icons, thicker tracks. */
  large?: boolean
  /**
   * Counts to print on the link: beer on the way and orders in flight. Only
   * the host console passes it; the player's `ChainFlow` never does.
   */
  inTransit?: { beer: number; orders: number }
}

/**
 * One link of the chain: an orders track on top, a beer track below. Shared
 * with the host's `ChainDiagram`, which puts it between its live role cards,
 * so both screens tell the same story in the same picture.
 */
export function FlowLane({
  index,
  dimmed = false,
  large = false,
  inTransit,
}: FlowLaneProps): ReactElement {
  const lanes = ROLE_ORDER.length
  const orderDelay: CSSProperties = { animationDelay: `${index * LANE_STAGGER_S}s` }
  const beerDelay: CSSProperties = {
    animationDelay: `${(lanes - 1 - index) * LANE_STAGGER_S}s`,
  }
  // The icon's own class sets its size and its vertical centring on the rule;
  // `chain-flow-large` swaps the 1rem end stop for 2rem (`index.css`).
  const icon = large
    ? 'chain-flow-large absolute -top-[17px] size-8'
    : 'absolute -top-[9px] size-4'
  const rule = large ? 'border-t-4' : 'border-t-2'

  const decoration = (
    <div
      aria-hidden="true"
      className={`relative mx-1 flex flex-1 flex-col justify-center ${
        large ? 'h-24 min-w-24 gap-10' : 'h-12 min-w-16 gap-4'
      } ${dimmed ? 'opacity-50' : ''}`}
    >
      <div className={`relative ${rule} border-dashed border-order`}>
        <StickyNote className={`chain-flow-upstream ${icon} text-order`} style={orderDelay} />
      </div>
      <div className={`relative ${rule} border-dashed border-supply-line`}>
        <Beer className={`chain-flow-downstream ${icon} text-supply-line`} style={beerDelay} />
      </div>
    </div>
  )
  if (!inTransit) return decoration

  // The chips are readable figures, so they sit outside the lane's aria-hidden
  // decoration; the wrapper keeps the lane's flex share in the card row.
  const chip =
    'numeric rounded-full border bg-surface px-2 py-0.5 text-xs font-semibold whitespace-nowrap'
  return (
    <div className="flex flex-1 flex-col items-stretch justify-center">
      {decoration}
      <div className="flex flex-wrap items-center justify-center gap-1">
        <span
          data-chip="orders"
          aria-label={`Orders in flight: ${inTransit.orders}`}
          className={`${chip} border-order text-order`}
        >
          {inTransit.orders}
        </span>
        <span
          data-chip="beer"
          aria-label={`Beer on the way: ${inTransit.beer}`}
          className={`${chip} border-supply-line text-supply-line`}
        >
          {inTransit.beer}
        </span>
      </div>
    </div>
  )
}

export interface FlowLegendProps {
  large?: boolean
}

/**
 * The key to `FlowLane`'s icons. The animation is decoration; this is where
 * the direction of each flow is actually stated, in words.
 */
export function FlowLegend({ large = false }: FlowLegendProps): ReactElement {
  const icon = large ? 'size-8' : 'size-4'
  return (
    <ul
      className={`flex flex-wrap gap-x-6 gap-y-1 text-ink-muted ${
        large ? 'text-[1.5rem]' : 'text-sm'
      }`}
    >
      <li className="flex items-center gap-2">
        <StickyNote aria-hidden="true" className={`${icon} shrink-0 text-order`} />
        <span>Orders travel up the chain, towards the factory &#8594;</span>
      </li>
      <li className="flex items-center gap-2">
        <Beer aria-hidden="true" className={`${icon} shrink-0 text-supply-line`} />
        <span>&#8592; Beer travels back down, towards the customer</span>
      </li>
    </ul>
  )
}

export default ChainFlow
