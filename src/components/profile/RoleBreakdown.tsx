import type { ReactElement } from 'react'
import { ROLE_ORDER, type Role } from '../../types/game'
import { ROLE_LABEL } from '../lobby/roleCopy'
import type { UserStatsResponse } from '../../api/users'

export interface RoleBreakdownProps {
  stats: UserStatsResponse
}

type CountField =
  | 'games_as_retailer'
  | 'games_as_wholesaler'
  | 'games_as_distributor'
  | 'games_as_factory'

/** The four counts, keyed the way `UserStatsResponse` carries them. */
const COUNT_FIELD: Record<Role, CountField> = {
  RETAILER: 'games_as_retailer',
  WHOLESALER: 'games_as_wholesaler',
  DISTRIBUTOR: 'games_as_distributor',
  FACTORY: 'games_as_factory',
}

/** Written out, because Tailwind reads class names as literals. */
const SWATCH: Record<Role, string> = {
  RETAILER: 'bg-role-retailer-soft',
  WHOLESALER: 'bg-role-wholesaler-soft',
  DISTRIBUTOR: 'bg-role-distributor-soft',
  FACTORY: 'bg-role-factory-soft',
}

/**
 * Games played in each of the four seats, downstream to upstream.
 *
 * A player who has only ever been the Retailer has seen a different game from
 * one who has played the Factory — the Retailer is the only seat that sees
 * real customer demand, and the Factory is the only one with a production
 * delay. This is what tells them so, and what nudges them into the seat they
 * have never taken.
 */
export function RoleBreakdown({ stats }: RoleBreakdownProps): ReactElement {
  return (
    <section aria-labelledby="profile-roles" className="flex flex-col gap-4">
      <h2 id="profile-roles" className="text-2xl font-semibold">
        Seats you have played
      </h2>
      <p className="text-ink-muted">
        Every seat sees a different game. Only the Retailer sees real customer demand, and
        only the Factory has to wait for what it brews.
      </p>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {ROLE_ORDER.map((role) => (
          <div
            key={role}
            className="flex flex-col gap-1 rounded-lg border border-border bg-surface-raised px-5 py-4"
          >
            <dt className="flex items-center gap-2 text-sm font-semibold text-ink-muted">
              <span
                aria-hidden="true"
                className={`inline-block h-3 w-3 rounded-full ${SWATCH[role]}`}
              />
              {ROLE_LABEL[role]}
            </dt>
            <dd className="numeric text-figure text-ink">{stats[COUNT_FIELD[role]]}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export default RoleBreakdown
