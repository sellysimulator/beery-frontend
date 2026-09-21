import type { ReactElement } from 'react'
import { useBackendStatus } from '../../contexts/BackendStatusContext'

/** How long the progress bar takes to fill, in seconds. */
const EXPECTED_WAKE_SECONDS = 60
/** Before this, a "Try again now" button reads as "something is wrong". */
const RETRY_OFFER_AFTER_SECONDS = 10

/**
 * The message changes as the wait goes on. A screen that says the same thing
 * at 5 seconds and at 50 gives a player no way to tell a cold start from a
 * hang, and the second thing they do is reload — which restarts the wait.
 */
function messageFor(elapsed: number): { title: string; detail: string } {
  if (elapsed < 15) {
    return {
      title: 'Waking up the server',
      detail:
        'The server sleeps when nobody is playing and takes 30 to 60 seconds to come back. This page continues on its own as soon as it answers.',
    }
  }
  if (elapsed < 40) {
    return {
      title: 'Waking up the server — still starting',
      detail:
        'Thanks for waiting. A cold start on the free tier runs to about 50 seconds. Nothing is broken and nothing needs reloading.',
    }
  }
  return {
    title: 'Waking up the server — almost there',
    detail:
      'This is taking longer than usual. The page still continues on its own the moment the server answers.',
  }
}

/**
 * Shown over any route that needs the backend while the health probe is still
 * failing. A free-tier host cold-starts in 30-60 seconds, and without this the
 * wait is indistinguishable from a broken app.
 *
 * It covers the viewport rather than sitting in the layout, so a route that is
 * half-mounted behind it never shows through as a broken-looking page.
 */
export function BackendWakeUp(): ReactElement {
  const { status, elapsed, retry } = useBackendStatus()
  const { title, detail } = messageFor(elapsed)
  // Animated ellipsis, driven by the same second counter as everything else.
  const dots = '.'.repeat(elapsed % 4)

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex items-center justify-center bg-surface/95 px-4 backdrop-blur-sm"
    >
      <div className="flex w-full max-w-sm flex-col items-center gap-6 rounded-2xl border border-border bg-surface-raised p-8 text-center shadow-xl">
        {/* Server icon, with a ring that pulses for as long as the wait lasts. */}
        <div className="relative flex items-center justify-center">
          <span
            aria-hidden="true"
            className="absolute inline-flex h-20 w-20 animate-ping rounded-full bg-brand/20"
          />
          <span className="relative flex h-16 w-16 items-center justify-center rounded-full border border-brand/40 bg-brand-soft">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-8 w-8 text-brand-strong"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"
              />
            </svg>
          </span>
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-semibold text-ink">
            {title}
            {/* Fixed width so the heading does not jump as the dots cycle. */}
            <span aria-hidden="true" className="inline-block w-6 text-left text-brand-strong">
              {dots}
            </span>
          </h1>
          <p className="text-sm leading-relaxed text-ink-muted">{detail}</p>
        </div>

        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-brand"
            />
            <span className="text-xs tabular-nums text-ink-subtle">{elapsed}s elapsed</span>
          </div>

          {/* Fills over the expected cold start, and stops short of full: it
              reports how long the wait has run, not a real completion. */}
          <div className="h-1 w-48 overflow-hidden rounded-full bg-surface-sunken">
            <div
              aria-hidden="true"
              className="h-full rounded-full bg-brand transition-all duration-1000 ease-linear"
              style={{ width: `${Math.min((elapsed / EXPECTED_WAKE_SECONDS) * 100, 95)}%` }}
            />
          </div>
        </div>

        {status === 'down' && elapsed >= RETRY_OFFER_AFTER_SECONDS ? (
          <button
            type="button"
            onClick={retry}
            className="text-xs text-brand-strong underline underline-offset-2 hover:text-brand"
          >
            Try again now
          </button>
        ) : null}
      </div>
    </div>
  )
}

export default BackendWakeUp
