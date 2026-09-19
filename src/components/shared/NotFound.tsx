import type { ReactElement } from 'react'
import { Link } from 'react-router-dom'

/**
 * The fallback for `*`. Also what every path renders while `src/pages/` is
 * empty, which is the state section 16 ships in.
 */
export function NotFound(): ReactElement {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="numeric text-figure text-brand">404</p>
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="max-w-md text-ink-muted">
        There is nothing at this address. If you followed an invite link, check the room code
        with whoever is hosting.
      </p>
      <Link
        to="/"
        className="rounded-md border border-border-strong px-4 py-2 text-sm hover:border-brand hover:text-brand"
      >
        Back to the start
      </Link>
    </div>
  )
}

export default NotFound
