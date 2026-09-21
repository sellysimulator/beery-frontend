import { useEffect, useState, type ReactElement } from 'react'
import { leave } from '../../api/games'
import { useGameStore } from '../../store/gameStore'

/**
 * How long to wait for `leave_ack` before handing the button back.
 *
 * The emit itself cannot fail visibly — Socket.IO buffers it while the
 * connection is down and flushes it on reconnect — so without this the player
 * is left staring at a disabled "Leaving…" with no way forward, which is the
 * failure mode this control exists to remove, not to reproduce.
 */
const ACK_TIMEOUT_MS = 6000

export interface LeaveControlProps {
  roomCode: string
}

/**
 * The player's way out of a lobby.
 *
 * The server frees the seat and re-broadcasts `lobby_update` to the room, so
 * leaving is a real state change other people see — not a client-side
 * navigation. That is why it asks first: a misclick that silently hands your
 * seat to the next person to claim it is worse than one extra click.
 *
 * It is offered ONLY before the game starts. The server refuses `leave` once
 * the room is running (`11 §3.3`) and answers with `join_error`, so the
 * refusal path is still handled here — a stale tab can reach the button a
 * moment after the host presses start.
 *
 * Nothing here navigates. The ack arrives on the socket, `socketHandlers`
 * turns it into `leftRoom`, and the shell redirects — one reader of the wire
 * (`16 §3`).
 */
export function LeaveControl({ roomCode }: LeaveControlProps): ReactElement {
  const joinError = useGameStore((state) => state.joinError)
  const clearJoinError = useGameStore((state) => state.clearJoinError)

  const [stage, setStage] = useState<'idle' | 'confirming' | 'requested'>('idle')
  const [timedOut, setTimedOut] = useState(false)

  /**
   * Derived rather than stored. A refusal arrives as `joinError`, and the wait
   * has to end when it does — but ending it from an effect would be a setState
   * cascade over a value that is already a pure function of what the store
   * holds. `joinError` was cleared on the way out, so anything present here
   * belongs to this attempt.
   */
  const waiting = stage === 'requested' && joinError === null

  useEffect(() => {
    if (!waiting) return
    const timer = setTimeout(() => {
      setStage('idle')
      setTimedOut(true)
    }, ACK_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [waiting])

  function handleLeave(): void {
    clearJoinError()
    setTimedOut(false)
    setStage('requested')
    leave({ room_id: roomCode })
  }

  if (stage === 'confirming') {
    return (
      <section className="flex flex-col gap-3 rounded-lg border border-danger bg-surface-raised px-5 py-4">
        <p className="font-semibold">Leave room {roomCode}?</p>
        <p className="text-sm text-ink-muted">
          Your seat is freed straight away and anyone else in the room can take it. You can
          rejoin with the same link while the host is still setting up.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleLeave}
            className="rounded-md bg-danger px-4 py-2 font-semibold text-ink-inverse transition hover:opacity-90"
          >
            Yes, leave the room
          </button>
          <button
            type="button"
            onClick={() => setStage('idle')}
            className="rounded-md border border-border-strong px-4 py-2 transition hover:border-brand hover:text-brand"
          >
            Stay
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setStage('confirming')}
        disabled={waiting}
        className="self-start rounded-md border border-border-strong px-4 py-2 text-sm transition hover:border-danger hover:text-danger disabled:border-border disabled:text-ink-subtle"
      >
        {waiting ? 'Leaving…' : 'Leave room'}
      </button>
      {timedOut ? (
        <p role="alert" className="text-sm text-danger">
          The server has not confirmed yet. Check your connection and try again — your seat is
          still yours until it does.
        </p>
      ) : null}
    </section>
  )
}

export default LeaveControl
