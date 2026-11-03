import type { ReactElement } from 'react'
import type { Participant, Role } from '../../types/game'
import { ROLE_ORDER } from '../../types/game'
import { Select, type SelectOption } from '../shared/Select'
import { ROLE_LABEL } from './roleCopy'

/** The empty choice in the seat picker. A role value is never `''`. */
const NO_ROLE = ''

/**
 * The seat picker's options for one participant.
 *
 * A role somebody else holds is listed but disabled, with the holder's name:
 * the server refuses to hand a held seat to a second person (`11 §3.5`), and
 * a picker that offered it anyway would turn that refusal into an error the
 * host had no way to see coming. Unseating the holder first frees it.
 */
function seatOptions(
  participant: Participant,
  participants: Participant[],
): SelectOption<Role | typeof NO_ROLE>[] {
  const holders = new Map<Role, Participant>()
  for (const other of participants) {
    if (other.role) holders.set(other.role, other)
  }
  return [
    { value: NO_ROLE, label: 'No role' },
    ...ROLE_ORDER.map((role) => {
      const holder = holders.get(role)
      const taken = holder !== undefined && holder.alias !== participant.alias
      return {
        value: role,
        label: ROLE_LABEL[role],
        disabled: taken,
        detail: taken ? `Taken by ${holder.display_name}` : undefined,
      }
    }),
  ]
}

export interface ParticipantListProps {
  participants: Participant[]
  /** The viewer's own alias, so their row can be marked. */
  myAlias: string | null
  /**
   * Host only. When given, each row gets a role selector that emits
   * `assign_role`; the emit itself stays with the host lobby.
   */
  onAssign?: (alias: string, role: Role | null) => void
  assignDisabled?: boolean
}

/**
 * Who is in the room.
 *
 * Two things here are requirements rather than decoration. Bots carry a
 * visible **Bot** badge wherever they appear (`beer-game-spec.md` section 8.5):
 * a human who believed they were playing three humans draws a different
 * conclusion from the debrief. And the connection state is a word, not only a
 * coloured dot, because colour alone is not a signal everyone receives.
 */
export function ParticipantList({
  participants,
  myAlias,
  onAssign,
  assignDisabled = false,
}: ParticipantListProps): ReactElement {
  if (participants.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-ink-muted">
        Nobody has joined yet. Share the invite link and people will appear here as they
        arrive.
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {participants.map((participant) => (
        <li
          key={participant.alias}
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-surface-raised px-4 py-3"
        >
          <span className="font-medium">
            {participant.display_name}
            {participant.alias === myAlias ? (
              <span className="ml-2 text-sm font-normal text-ink-muted">(you)</span>
            ) : null}
          </span>

          {participant.is_host ? (
            <span className="rounded border border-border-strong px-2 py-0.5 text-xs uppercase tracking-wide text-ink-muted">
              Host
            </span>
          ) : null}

          {participant.is_bot ? (
            <span className="rounded border border-accent px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-accent">
              Bot
            </span>
          ) : null}

          <span className="text-sm text-ink-muted">
            {participant.role ? ROLE_LABEL[participant.role] : 'No role yet'}
          </span>

          <span className="ml-auto flex items-center gap-2 text-sm">
            <span
              aria-hidden="true"
              className={`h-2.5 w-2.5 rounded-full ${
                participant.connected ? 'bg-success' : 'bg-danger'
              }`}
            />
            <span className={participant.connected ? 'text-ink-muted' : 'text-danger'}>
              {participant.connected ? 'Connected' : 'Disconnected'}
            </span>
          </span>

          {onAssign ? (
            <div className="flex w-full items-center gap-2 text-sm text-ink-muted sm:w-auto">
              <span aria-hidden="true">Seat</span>
              <Select<Role | typeof NO_ROLE>
                size="sm"
                className="min-w-36"
                value={participant.role ?? NO_ROLE}
                options={seatOptions(participant, participants)}
                disabled={assignDisabled || participant.is_host}
                onChange={(value) =>
                  onAssign(participant.alias, value === NO_ROLE ? null : value)
                }
                aria-label={`Assign role for ${participant.display_name}`}
              />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

export default ParticipantList
