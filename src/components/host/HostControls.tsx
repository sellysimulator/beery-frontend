import { useCallback, useEffect, useId, useRef, useState, type ReactElement } from 'react'
import {
  endGameEarly,
  forceCloseWeek,
  pauseGame,
  resumeGame,
  substituteBot,
} from '../../api/games'
import { ROLE_ORDER, type Role } from '../../types/game'
import { getHostSecret } from '../../utils/storage'
import { ROLE_LABEL } from '../lobby/roleCopy'

/**
 * The secret, read at the moment the control is pressed rather than captured
 * at mount.
 *
 * Under **D18** a host who reopened their tab has no secret when the console
 * first renders: the server re-authorises them against the identity the
 * handshake already carries and answers with `host_claimed`, which section
 * 16's handler writes into `sessionStorage`. A value captured at mount would
 * still be the `null` from before that reply.
 *
 * The console never withholds a *control* because the secret is absent — that
 * decision is the server's and section 17 has already made it (§3.3, **D18**).
 * What it withholds is the **emit**: `null` here means nothing goes on the
 * wire. An empty-string secret is not authority, and a client that sends one
 * teaches the server to have an opinion about empty secrets (§5, FM 6).
 */
function storedSecret(roomCode: string): string | null {
  return getHostSecret(roomCode)
}

/** "Distributor and Factory", in `ROLE_ORDER`. */
function roleList(roles: Role[]): string {
  const names = ROLE_ORDER.filter((role) => roles.includes(role)).map(
    (role) => ROLE_LABEL[role],
  )
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * "Close the week" sounds harmless and is not, so the warning names the
 * specific roles that will be recorded as ordering nothing (§2.2, FM 4).
 */
function forceCloseWarning(awaitingRoles: Role[]): string {
  const verb = awaitingRoles.length === 1 ? "hasn't" : "haven't"
  return `${roleList(awaitingRoles)} ${verb} decided. Closing now records an order of 0 for them. This can't be undone.`
}

function substituteWarning(playerName: string): string {
  return `${playerName} will be replaced by an automated player for the rest of the game. They'll keep their seat in the results, but they won't decide again. This can't be undone.`
}

function endGameWarning(week: number): string {
  return `The game ends at week ${week}. You'll get full results for the weeks played.`
}

interface ConfirmDialogProps {
  title: string
  body: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

/**
 * The confirmation for a destructive control — **rendered DOM, never
 * `window.confirm`** (§2.2).
 *
 * Three criteria read this warning's text and one asserts that nothing is
 * emitted until it is accepted, and a native dialog is unreadable from a test.
 * It is also unstyleable on a projector, which matters when the sentence that
 * has to be read out loud to a room is the one explaining what is about to
 * become irreversible.
 *
 * Focus moves in on open and returns to the trigger on close, and Escape
 * cancels. Cancelling emits nothing.
 */
function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): ReactElement {
  const titleId = useId()
  const bodyId = useId()
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previous = document.activeElement
    confirmRef.current?.focus()

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onCancel()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [onCancel])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="flex w-full max-w-lg flex-col gap-4 rounded-lg border border-border-strong bg-surface-raised px-6 py-5 shadow-lg"
      >
        <h2 id={titleId} className="text-xl font-semibold">
          {title}
        </h2>
        <p id={bodyId} className="text-base text-ink">
          {body}
        </p>
        <div className="flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border-strong px-4 py-2 text-sm font-semibold hover:border-brand hover:text-brand"
          >
            Cancel
          </button>
          <button
            type="button"
            ref={confirmRef}
            onClick={onConfirm}
            className="rounded-md border border-danger bg-danger-soft px-4 py-2 text-sm font-semibold text-danger hover:border-ink"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export interface SubstituteBotButtonProps {
  roomCode: string
  role: Role
  /** The person who loses the seat, named in the warning (§2.2). */
  playerName: string
  /** `RUNNING` or `PAUSED`, and the role is not already a bot (§2.2). */
  disabled: boolean
}

/**
 * *Swap in a bot*, the one host control that lives on a role's own card
 * (§2.1).
 *
 * It is irreversible in v1 — there is no "give it back" (`12 §3.6`) — so it
 * confirms first, and the warning names the player rather than the role, since
 * the host is about to do something to a person in the room.
 */
export function SubstituteBotButton({
  roomCode,
  role,
  playerName,
  disabled,
}: SubstituteBotButtonProps): ReactElement {
  const [confirming, setConfirming] = useState(false)
  const cancel = useCallback(() => setConfirming(false), [])

  function confirm(): void {
    setConfirming(false)
    const hostSecret = storedSecret(roomCode)
    if (hostSecret === null) return
    substituteBot({ room_id: roomCode, host_secret: hostSecret, role })
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setConfirming(true)}
        className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-semibold hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:border-border disabled:text-ink-subtle"
      >
        Swap in a bot
      </button>
      {confirming ? (
        <ConfirmDialog
          title="Swap in a bot?"
          body={substituteWarning(playerName)}
          confirmLabel="Swap in a bot"
          onConfirm={confirm}
          onCancel={cancel}
        />
      ) : null}
    </>
  )
}

export interface HostControlsProps {
  roomCode: string
  /** `store.paused`. The game never resumes itself (**D7**). */
  paused: boolean
  /** `host_state.awaiting_roles` — who has not decided this week. */
  awaitingRoles: Role[]
  /** `host_state.week`, named in the end-of-game warning. */
  week: number
  /** Presentation mode is local state; nothing goes on the wire (§3.4a). */
  onPresent: () => void
}

/** Which destructive control is waiting on its confirmation. */
type Pending = 'force_close' | 'end_game'

/**
 * The controls that let a host run a session in a room full of people (§2.2).
 *
 * Every one of them carries the stored `host_secret`, because authority is a
 * capability and never an account (**D3**) and never a client-side boolean —
 * and when this tab holds no secret yet, the control still renders but emits
 * nothing at all rather than sending an empty one (§5, FM 6). Two of them are
 * destructive and state their consequence in plain words before anything is
 * emitted.
 *
 * *Pause* and *Resume* are both rendered, one of them always disabled, so the
 * host can see at a glance which state the room is in — and because **D7**
 * makes *Resume* the only exit from a pause, it must never be somewhere the
 * host has to go looking for it.
 */
export function HostControls({
  roomCode,
  paused,
  awaitingRoles,
  week,
  onPresent,
}: HostControlsProps): ReactElement {
  const [pending, setPending] = useState<Pending | null>(null)
  const cancel = useCallback(() => setPending(null), [])

  function confirmForceClose(): void {
    setPending(null)
    const hostSecret = storedSecret(roomCode)
    if (hostSecret === null) return
    forceCloseWeek({ room_id: roomCode, host_secret: hostSecret })
  }

  function confirmEndGame(): void {
    setPending(null)
    const hostSecret = storedSecret(roomCode)
    if (hostSecret === null) return
    endGameEarly({ room_id: roomCode, host_secret: hostSecret })
  }

  function handlePause(): void {
    const hostSecret = storedSecret(roomCode)
    if (hostSecret === null) return
    pauseGame({ room_id: roomCode, host_secret: hostSecret })
  }

  function handleResume(): void {
    const hostSecret = storedSecret(roomCode)
    if (hostSecret === null) return
    resumeGame({ room_id: roomCode, host_secret: hostSecret })
  }

  const buttonClass =
    'rounded-md border border-border-strong px-4 py-2 text-sm font-semibold hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:border-border disabled:text-ink-subtle disabled:hover:text-ink-subtle'

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={onPresent} className={buttonClass}>
        Present
      </button>

      <button
        type="button"
        disabled={paused}
        onClick={handlePause}
        className={buttonClass}
      >
        Pause
      </button>

      <button
        type="button"
        disabled={!paused}
        onClick={handleResume}
        className={buttonClass}
      >
        Resume
      </button>

      <button
        type="button"
        disabled={paused || awaitingRoles.length === 0}
        onClick={() => setPending('force_close')}
        className={buttonClass}
      >
        Close this week now
      </button>

      <button
        type="button"
        onClick={() => setPending('end_game')}
        className="rounded-md border border-danger px-4 py-2 text-sm font-semibold text-danger hover:bg-danger-soft"
      >
        End the game now
      </button>

      {pending === 'force_close' ? (
        <ConfirmDialog
          title="Close this week now?"
          body={forceCloseWarning(awaitingRoles)}
          confirmLabel="Close this week now"
          onConfirm={confirmForceClose}
          onCancel={cancel}
        />
      ) : null}

      {pending === 'end_game' ? (
        <ConfirmDialog
          title="End the game now?"
          body={endGameWarning(week)}
          confirmLabel="End the game now"
          onConfirm={confirmEndGame}
          onCancel={cancel}
        />
      ) : null}
    </div>
  )
}

export default HostControls
