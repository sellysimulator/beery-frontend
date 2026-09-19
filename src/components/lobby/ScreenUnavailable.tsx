import type { ReactElement } from 'react'
import { Link } from 'react-router-dom'

/**
 * What a shell renders while the screen it delegates to does not exist yet
 * (**D19**): section 19's playing screen, or section 20's host console.
 *
 * This is a build-order state, not a user-facing failure mode — it can only
 * appear between the day section 17 lands and the day 19 and 20 do. It exists
 * so that the shells, the routes and their tests are buildable in between,
 * rather than the whole frontend being blocked on the last screen written.
 */
export function ScreenUnavailable(): ReactElement {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold">This screen is not available yet.</h1>
      <p className="max-w-md text-ink-muted">
        The room is running, but this part of the app has not been built into this version.
      </p>
      <Link
        to="/home"
        className="rounded-md border border-border-strong px-4 py-2 text-sm hover:border-brand hover:text-brand"
      >
        Back to your games
      </Link>
    </div>
  )
}

export default ScreenUnavailable
