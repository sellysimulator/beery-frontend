import type { ReactElement } from 'react'
import type { Role } from '../../types/game'

export interface SubmissionEntry {
  role: Role
  /** The person in the seat, or the role's own label when nobody holds it. */
  name: string
  /** `host_state.roles[role].has_submitted` — never the quantity. */
  submitted: boolean
}

export interface SubmissionTrackerProps {
  /** One entry per role, in `ROLE_ORDER`. */
  entries: SubmissionEntry[]
  /** Projector styling: larger type, thicker rules (§2.4, §3.5). */
  presenting?: boolean
}

/**
 * Four names, ticked as they decide (§2.4).
 *
 * **Names and tick state, and nothing else.** This is the one component on the
 * projector that is about the people in the room, and the room can read it:
 * putting a quantity here would tell every player what their neighbour just
 * ordered, which is the game (§2.4, AC 17, FM 1).
 *
 * A tick is never the only signal either — the state is spelled out in words
 * beside it, because a green dot at the back of a lecture hall is a guess.
 */
export function SubmissionTracker({
  entries,
  presenting = false,
}: SubmissionTrackerProps): ReactElement {
  return (
    <section
      aria-label="Who has decided"
      className={
        presenting
          ? 'flex flex-col gap-3'
          : 'flex flex-col gap-2 rounded-lg border border-border bg-surface-raised px-5 py-4'
      }
    >
      <h2 className={presenting ? 'text-[2rem] font-bold' : 'text-xl font-semibold'}>
        This week
      </h2>
      <ul className="flex flex-wrap gap-3">
        {entries.map((entry) => (
          <li
            key={entry.role}
            data-role={entry.role}
            data-submitted={entry.submitted ? 'true' : 'false'}
            className={`flex flex-1 items-center gap-3 rounded-lg border px-4 ${
              presenting ? 'py-4' : 'py-2'
            } ${
              entry.submitted
                ? 'border-success bg-success-soft text-success'
                : 'border-border bg-surface-sunken text-ink-muted'
            }`}
          >
            <span aria-hidden="true" className={presenting ? 'text-[2.5rem]' : 'text-lg'}>
              {entry.submitted ? '✓' : '…'}
            </span>
            <span className="flex flex-col">
              <span className={presenting ? 'text-[2rem] font-bold' : 'font-semibold'}>
                {entry.name}
              </span>
              <span className={presenting ? 'text-[1.5rem]' : 'text-sm'}>
                {entry.submitted ? 'Decided' : 'Still deciding'}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default SubmissionTracker
