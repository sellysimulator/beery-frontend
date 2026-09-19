import type { ReactElement } from 'react'
import { useBackendStatus } from '../../contexts/BackendStatusContext'
import LoadingSpinner from './LoadingSpinner'

/**
 * Shown over any route that needs the backend while the health probe is still
 * failing. A free-tier host cold-starts in 30-60 seconds, and without this the
 * wait is indistinguishable from a broken app.
 */
export function BackendWakeUp(): ReactElement {
  const { status, retry } = useBackendStatus()

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      {/* The spinner keeps its generic label so "Waking up the server" — the
          string §3 fixes for this component — appears exactly once. */}
      <LoadingSpinner size="lg" />

      <div className="max-w-md space-y-2">
        <h1 className="text-2xl font-semibold">Waking up the server</h1>
        <p className="text-ink-muted">
          The server sleeps when nobody is playing and takes 30 to 60 seconds to come back.
          This page continues on its own as soon as it answers.
        </p>
      </div>

      {status === 'down' ? (
        <button
          type="button"
          onClick={retry}
          className="rounded-md border border-border-strong px-4 py-2 text-sm hover:border-brand hover:text-brand"
        >
          Try again now
        </button>
      ) : null}
    </div>
  )
}

export default BackendWakeUp
