import type { ReactElement } from 'react'

export interface BotSeatNoticeProps {
  /** Emits `reclaim_seat`. The server finds the seat from the connection. */
  onReclaim(): void
}

/**
 * What a player sees when the host has swapped a bot into their seat
 * (2026-11-03).
 *
 * The bot keeps playing until the player takes the seat back; taking it is a
 * choice, never automatic, because a laptop waking up in a bag reconnects too.
 * Fixed above everything, the pause overlay included: the usual path is a
 * player who dropped, a room that paused, and a host who swapped a bot in, so
 * the room is often paused when the player comes back, and the seat can be
 * taken back while it is.
 */
export function BotSeatNotice({ onReclaim }: BotSeatNoticeProps): ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-4"
    >
      <div className="flex max-w-xl flex-col gap-3 rounded-lg border-2 border-warning bg-surface-raised px-5 py-4 shadow-lg sm:flex-row sm:items-center">
        <div className="flex flex-col gap-1">
          <p className="font-semibold">The host handed your role to a bot</p>
          <p className="text-sm text-ink-muted">
            It is ordering for you. Take your role back whenever you are ready; an order it
            already placed this week stands until you change it.
          </p>
        </div>
        <button
          type="button"
          onClick={onReclaim}
          className="shrink-0 rounded-md border-2 border-warning px-4 py-2 font-semibold text-warning hover:border-ink hover:text-ink"
        >
          Take back my role
        </button>
      </div>
    </div>
  )
}

export default BotSeatNotice
