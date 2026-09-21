import type { ReactElement } from 'react'
import LoadingSpinner from './LoadingSpinner'

export interface ScreenLoadingProps {
  /** What is being fetched, in the player's words. */
  label: string
}

/**
 * The `Suspense` fallback for a screen that is being fetched.
 *
 * The heavy screens — the host console, the playing screen, the configuration
 * panel — are loaded on first use rather than shipped in the initial bundle,
 * so there is a gap between deciding to show one and having its code. On a
 * warm cache that gap is a frame; on a cold one it is a network request.
 *
 * It names what it is waiting for, like every other wait in this app
 * (`beer-game-spec.md` §9.4), because "Loading" alone reads as a broken page.
 * It fills the viewport so that the screen it stands in for does not appear to
 * collapse the layout while it arrives.
 */
export function ScreenLoading({ label }: ScreenLoadingProps): ReactElement {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <LoadingSpinner size="lg" label={label} />
    </div>
  )
}

export default ScreenLoading
