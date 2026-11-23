import type { ReactElement } from 'react'
import { useGameStore } from '../../store/gameStore'

/**
 * A small banner across the top of the player and host screens while the
 * socket is down after having connected once (`store.reconnecting`, written by
 * `socketHandlers.ts`). It blocks nothing: Socket.IO keeps retrying on its
 * own, and the screen comes back by itself once the rejoin's resync lands.
 * The decision form will not confirm an order while the socket is not
 * connected (`store.connected`, `DecisionForm`).
 */
export function ReconnectingNotice(): ReactElement | null {
  const reconnecting = useGameStore((state) => state.reconnecting)
  if (!reconnecting) return null
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed top-[max(0.75rem,env(safe-area-inset-top))] left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-info/60 bg-surface-raised px-4 py-2 text-sm text-ink shadow-lg"
    >
      <span
        aria-hidden="true"
        className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-brand"
      />
      Connection lost. Reconnecting…
    </div>
  )
}

export default ReconnectingNotice
