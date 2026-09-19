import type { ReactElement } from 'react'
import { ROLE_ORDER, type Role } from '../../types/game'
import { ROLE_LABEL } from '../lobby/roleCopy'

export interface WaitingForOthersProps {
  myRole: Role
  /** The roles that have NOT submitted yet, from the store. Names only. */
  awaitingRoles: Role[]
  /** A server refusal to show in the locked state, or null. */
  notice: string | null
  /** False while the game is paused or over: the order cannot be changed. */
  canChange: boolean
  onChangeOrder(): void
}

/**
 * The locked state (`beer-game-spec.md` sections 9.2 and 9.4).
 *
 * The tick-list is built from `store.awaitingRoles`, which the socket
 * handlers fill from the server's `awaiting_roles`. It carries role names and
 * a submitted / still-deciding state, and it carries **no quantity, for any
 * role, ever** — the `order_submitted` event behind it does not even contain
 * one (`12-socket-play.md` section 2).
 *
 * A player may change their order until the window closes, so this state
 * offers a way back to the form rather than being a dead end (§2.4).
 */
export function WaitingForOthers({
  myRole,
  awaitingRoles,
  notice,
  canChange,
  onChangeOrder,
}: WaitingForOthersProps): ReactElement {
  const stillDeciding = ROLE_ORDER.filter((role) => awaitingRoles.includes(role))
  const waitingLine =
    stillDeciding.length === 0
      ? 'Everyone has decided. The week is closing.'
      : `Waiting for the ${stillDeciding
          .map((role) => ROLE_LABEL[role])
          .join(', ')} to submit.`

  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised px-5 py-4"
      aria-label="Waiting for the other players"
    >
      <h2 className="text-xl font-semibold">
        Order submitted — waiting for the other players
      </h2>
      <p className="text-ink-muted" aria-live="polite">
        {waitingLine}
      </p>

      <ul className="flex flex-col gap-1">
        {ROLE_ORDER.map((role) => {
          const submitted = !awaitingRoles.includes(role)
          return (
            <li
              key={role}
              className={`flex items-center gap-2 rounded-md px-3 py-2 ${
                submitted ? 'bg-success-soft text-success' : 'bg-surface-sunken text-ink-muted'
              }`}
            >
              <span aria-hidden="true">{submitted ? '✓' : '⋯'}</span>
              <span>
                {`${ROLE_LABEL[role]}${role === myRole ? ' (you)' : ''}: ${
                  submitted ? 'submitted' : 'still deciding'
                }`}
              </span>
            </li>
          )
        })}
      </ul>

      <p className="text-sm text-ink-subtle">
        Everyone&apos;s order stays hidden until the week closes.
      </p>

      {notice ? (
        <p role="status" className="text-sm text-danger">
          {notice}
        </p>
      ) : null}

      <div>
        <button
          type="button"
          onClick={onChangeOrder}
          disabled={!canChange}
          className="rounded-md border border-border-strong px-4 py-2 text-sm hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
        >
          Change my order
        </button>
      </div>
    </section>
  )
}

export default WaitingForOthers
