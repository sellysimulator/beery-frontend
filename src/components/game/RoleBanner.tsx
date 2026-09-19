/* eslint-disable react-refresh/only-export-components --
   The chain vocabulary lives beside the component that draws the chain. D19
   gives section 19 no shared module of its own, and a second copy of "who the
   Distributor buys from" in three files is a copy that drifts. */
import type { ReactElement } from 'react'
import { ROLE_ORDER, type Role } from '../../types/game'
import { ROLE_LABEL } from '../lobby/roleCopy'

/**
 * Who each role buys from, as the sentence "you buy from …" wants it.
 *
 * `null` for the Factory: it buys from nobody — it brews
 * (`beer-game-manual.md` Part 2 *The chain*).
 */
export const UPSTREAM_LABEL: Record<Role, string | null> = {
  RETAILER: 'the Wholesaler',
  WHOLESALER: 'the Distributor',
  DISTRIBUTOR: 'the Factory',
  FACTORY: null,
}

/** Who each role sells to, as the sentence "you sell to …" wants it. */
export const DOWNSTREAM_LABEL: Record<Role, string> = {
  RETAILER: 'the customer',
  WHOLESALER: 'the Retailer',
  DISTRIBUTOR: 'the Wholesaler',
  FACTORY: 'the Distributor',
}

/** Who places the incoming order, for the recap's "{X} ordered" row. */
export const DEMAND_SOURCE_LABEL: Record<Role, string> = {
  RETAILER: 'Customer',
  WHOLESALER: 'Retailer',
  DISTRIBUTOR: 'Wholesaler',
  FACTORY: 'Distributor',
}

/**
 * The recap's arrival row header. It names the player's actual upstream
 * neighbour, and for the Factory the goods are its own output, so the line
 * reads "Finished production" (§2.5, AC 19).
 */
export const RECEIPT_LABEL: Record<Role, string> = {
  RETAILER: 'Received from Wholesaler',
  WHOLESALER: 'Received from Distributor',
  DISTRIBUTOR: 'Received from Factory',
  FACTORY: 'Finished production',
}

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

export interface RoleBannerProps {
  role: Role
  week: number
  durationWeeks: number
}

/**
 * The top region of the playing screen: who you are, where you sit in the
 * chain, who you buy from, who you sell to, and which week it is
 * (`beer-game-spec.md` section 9.1).
 *
 * There is no timer and there is nowhere for one to go: v1 is untimed
 * (**D6**), and a decision window closes when every role has submitted or the
 * host force-closes it.
 */
export function RoleBanner({ role, week, durationWeeks }: RoleBannerProps): ReactElement {
  const supplier = UPSTREAM_LABEL[role]
  const buyLine =
    supplier === null
      ? 'You brew your own supply — nobody upstream of you'
      : `You buy from ${supplier}`

  return (
    <header className="flex flex-col gap-4 rounded-lg border border-border bg-surface-raised px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-sm uppercase tracking-wide text-ink-muted">Your role</p>
          <h1 className="text-3xl font-semibold">{ROLE_LABEL[role]}</h1>
          <p className="text-lg text-ink-muted">
            {`${buyLine} · You sell to ${DOWNSTREAM_LABEL[role]}`}
          </p>
        </div>
        <p className="numeric text-figure text-brand-strong">
          {`Week ${week} of ${durationWeeks}`}
        </p>
      </div>

      <ol
        className="flex flex-wrap items-center gap-2"
        aria-label="The supply chain, from the customer upstream to the factory"
      >
        <li className="rounded-md border border-border-strong bg-surface-sunken px-3 py-1 text-sm text-ink-muted">
          Customer
        </li>
        {ROLE_ORDER.map((chainRole) => (
          <li key={chainRole} className="flex items-center gap-2">
            <span aria-hidden="true" className="text-ink-subtle">
              &#8594;
            </span>
            <span
              aria-current={chainRole === role ? 'true' : undefined}
              className={`rounded-md border px-3 py-1 text-sm ${ROLE_CHIP_CLASS[chainRole]} ${
                chainRole === role ? 'font-semibold ring-2 ring-brand-strong' : 'opacity-80'
              }`}
            >
              {chainRole === role
                ? `${ROLE_LABEL[chainRole]} (you)`
                : ROLE_LABEL[chainRole]}
            </span>
          </li>
        ))}
      </ol>
      <p className="text-sm text-ink-subtle">
        Orders travel up the chain. Beer travels back down. You only deal with your
        immediate neighbours.
      </p>
    </header>
  )
}

export default RoleBanner
