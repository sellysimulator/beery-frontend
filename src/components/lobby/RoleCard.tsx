import type { ReactElement } from 'react'
import type { Role } from '../../types/game'
import { ROLE_DESCRIPTION, ROLE_LABEL } from './roleCopy'

export interface RoleCardProps {
  role: Role
  /** The display name of whoever holds this role, or null when it is free. */
  holder: string | null
  /** Whether the holder is the viewer. */
  isMine: boolean
  /** The message from a refused claim, shown against this card. */
  error: string | null
  onClaim: (role: Role) => void
}

/**
 * One claimable seat in `PLAYER_CHOOSES` mode.
 *
 * A click emits `claim_role` and changes nothing locally. Claims are atomic
 * server-side (`beer-game-spec.md` section 5) and two people reaching for the
 * same seat is the normal case, not the edge case — so the card waits for the
 * next `lobby_update` to settle the truth, and shows the refusal inline if the
 * answer was no. Showing the seat as taken optimistically means showing a
 * player a role they do not have.
 */
export function RoleCard({ role, holder, isMine, error, onClaim }: RoleCardProps): ReactElement {
  const taken = holder !== null
  const errorId = error ? `role-error-${role}` : undefined

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => onClaim(role)}
        disabled={taken}
        aria-describedby={errorId}
        className={`flex h-full flex-col gap-2 rounded-lg border px-4 py-4 text-left transition ${
          isMine
            ? 'border-brand bg-brand-soft'
            : taken
              ? 'border-border bg-surface-sunken text-ink-subtle'
              : 'border-border-strong bg-surface-raised hover:border-brand'
        }`}
      >
        <span className="text-lg font-semibold">{ROLE_LABEL[role]}</span>
        <span className="text-sm text-ink-muted">{ROLE_DESCRIPTION[role]}</span>
        <span className="mt-auto pt-2 text-sm">
          {isMine ? 'You have this seat.' : taken ? `Taken by ${holder}` : 'Free — take this seat'}
        </span>
      </button>

      {error ? (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export default RoleCard
