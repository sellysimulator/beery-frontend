import type { ReactElement } from 'react'

export interface PausedOverlayProps {
  /** `store.pausedReason` — the server's own words, rendered verbatim. */
  reason: string | null
}

/**
 * What covers the screen while the game is paused (`beer-game-spec.md`
 * section 9.4, §2.7).
 *
 * Every wait says what is being waited for: the server sends the reason —
 * "The host has paused the game." or "Waiting for the Distributor to
 * reconnect." — and this renders it rather than guessing. The decision form
 * beneath is disabled, and a submission would be refused by the server anyway
 * (`12-socket-play.md` section 3.1), so the overlay is the explanation, not
 * the enforcement.
 */
export function PausedOverlay({ reason }: PausedOverlayProps): ReactElement {
  return (
    <div
      role="status"
      aria-live="assertive"
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 px-6"
    >
      <div className="flex max-w-md flex-col gap-3 rounded-lg border border-border-strong bg-surface-raised px-6 py-6 text-center">
        <h2 className="text-2xl font-semibold">The game is paused</h2>
        <p className="text-lg">{reason ?? 'The host has paused the game.'}</p>
        <p className="text-sm text-ink-muted">
          Nothing is lost. Your week is held exactly where it is, and the screen comes
          back by itself when the host resumes.
        </p>
      </div>
    </div>
  )
}

export default PausedOverlay
