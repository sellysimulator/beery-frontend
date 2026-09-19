import { useEffect, useRef, type ReactElement } from 'react'
import type { HostRoleView, Role } from '../../types/game'
import ChainDiagram from './ChainDiagram'
import DemandCurve from './DemandCurve'
import SubmissionTracker, { type SubmissionEntry } from './SubmissionTracker'

export interface PresentationModeProps {
  /** `host_state.week`. */
  week: number
  /** `host_state.duration_weeks`. */
  durationWeeks: number
  /** `host_state.roles`. */
  roles: Record<Role, HostRoleView>
  /** `host_state.demand_series` — the full series. */
  demandSeries: number[]
  /** One entry per role, in `ROLE_ORDER`. Names and tick state only. */
  entries: SubmissionEntry[]
  onExit: () => void
}

/**
 * The projector view (§2.4).
 *
 * **The mode is state; full screen is a side effect of entering it** (§3.4a).
 * jsdom implements no Fullscreen API and a browser refuses the request outside
 * a user gesture, so a presentation mode that *depends* on it is one that
 * cannot be entered — and cannot be tested. Entering renders this view and
 * *then* asks for full screen if the method exists, ignoring a rejection; the
 * root's `data-presenting="true"` is both the plain-CSS fallback's hook and
 * what a test reads. Escape exits either way, because in the fallback path
 * nothing will ever fire `fullscreenchange`.
 *
 * It shows **no cost and no order quantity**, anywhere. The whole room is
 * looking at this screen, and the players in it must not learn what their
 * neighbours ordered (§2.4, FM 1 and 2). What it does show is the chain
 * filling and draining while it happens, which is where the bullwhip effect
 * becomes visible *during* the game rather than in the debrief.
 *
 * It opens no socket of its own and keeps no second copy of state: every
 * figure is the same `store.hostState` the console beneath it is rendering
 * (§3.4, FM 8).
 */
export function PresentationMode({
  week,
  durationWeeks,
  roles,
  demandSeries,
  entries,
  onExit,
}: PresentationModeProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    const request = root?.requestFullscreen
    if (root && typeof request === 'function') {
      // A rejected request is not a failure of the mode: the CSS fallback has
      // already covered the screen by the time this runs.
      void Promise.resolve(request.call(root)).catch(() => undefined)
    }

    return () => {
      if (typeof document.exitFullscreen === 'function' && document.fullscreenElement) {
        void document.exitFullscreen().catch(() => undefined)
      }
    }
  }, [])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onExit()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onExit])

  return (
    <div
      ref={rootRef}
      data-presenting="true"
      aria-label="Presentation mode"
      className="fixed inset-0 z-40 flex flex-col gap-6 overflow-auto bg-surface px-10 py-8 text-[2rem] text-ink"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-4">
        <p className="text-[3.5rem] font-bold leading-none">
          Week <span className="numeric">{week}</span> of{' '}
          <span className="numeric">{durationWeeks}</span>
        </p>
        <button
          type="button"
          onClick={onExit}
          className="rounded-md border-2 border-border-strong px-5 py-2 text-[1.5rem] font-semibold hover:border-brand hover:text-brand"
        >
          Exit presentation (Esc)
        </button>
      </header>

      <ChainDiagram roles={roles} presenting />

      <div className="grid gap-6 lg:grid-cols-2">
        <DemandCurve demandSeries={demandSeries} currentWeek={week} presenting />
        <SubmissionTracker entries={entries} presenting />
      </div>
    </div>
  )
}

export default PresentationMode
