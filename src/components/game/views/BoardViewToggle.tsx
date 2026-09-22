import { useCallback, useSyncExternalStore, type ReactElement } from 'react'
import type { BoardViewChoice } from '../../../utils/storage'

/**
 * The 2D/3D switch (24 §2.4).
 *
 * It is a SIBLING of the board, never a prop of it. That is the load-bearing
 * decision of 24 §2.1: `Board2D.tsx` is not edited at all, `BoardViewProps`
 * does not grow a field, and both boards get the toggle for free. A toggle
 * threaded through the props would have been a change to the contract **D15**
 * froze, in service of a control that belongs to neither board.
 */

/** The copy, exactly as 24 §2.4 gives it. The label names the destination. */
const LABEL: Record<BoardViewChoice, string> = {
  '2D': 'Switch to the 3D warehouse',
  '3D': 'Switch to the 2D board',
}

/** 24 §2.4 / §7.6.1. Stated, because an unexplained dead button is worse. */
const COARSE_POINTER_REASON = 'The 3D warehouse needs a keyboard and a mouse.'

/** 24 §7.6.2: 3D is still offered under reduced motion, but not silently. */
const REDUCED_MOTION_WARNING =
  'The 3D warehouse moves the camera as you walk. You have asked for reduced motion.'

/**
 * Follows a media query, subscribing rather than polling.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`: the query is an
 * external store and React has a hook for exactly that, which also keeps the
 * first render truthful instead of painting a wrong answer and correcting it.
 *
 * `matchMedia` is guarded because jsdom only grows one when `setup.ts` fills it
 * in, and a component that throws in a test harness is a component nobody can
 * assert anything about.
 */
function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void): (() => void) => {
      if (typeof window.matchMedia !== 'function') return () => {}
      const list = window.matchMedia(query)
      list.addEventListener('change', onStoreChange)
      return () => list.removeEventListener('change', onStoreChange)
    },
    [query],
  )

  const getSnapshot = useCallback((): boolean => {
    if (typeof window.matchMedia !== 'function') return false
    return window.matchMedia(query).matches
  }, [query])

  return useSyncExternalStore(subscribe, getSnapshot)
}

export interface BoardViewToggleProps {
  /** The board currently on screen, which decides what the label offers. */
  choice: BoardViewChoice
  onChange(choice: BoardViewChoice): void
}

/**
 * One real `<button>`, fixed at the bottom right.
 *
 * `z-50` is above `PausedOverlay`'s `z-40` **on purpose**: a paused game is
 * exactly when somebody wants to get out of a scene that is making them queasy,
 * and a control the overlay covers is a control they cannot reach at the one
 * moment they most want it (24 §2.4, risk 7). `Board2D` already reserves
 * `pb-24` at the bottom of the page, so nothing below is occluded.
 *
 * No `aria-pressed`. This is a mode switch with a changing label, not an ARIA
 * toggle button: the label already says what pressing it will do, and
 * `aria-pressed` on top of that announces a state the copy contradicts.
 *
 * On a coarse pointer the button renders `disabled` with the reason in text —
 * **never absent** (24 §7.6.1). WASD plus drag-look has no touch equivalent
 * worth shipping (24 §1.2), but an absent control is one nobody can ask about,
 * and a player on a tablet beside a classmate on a laptop needs to be told why
 * their screen is different rather than left to guess.
 */
export function BoardViewToggle({ choice, onChange }: BoardViewToggleProps): ReactElement {
  const coarsePointer = useMediaQuery('(pointer: coarse)')
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

  // Only the offer of 3D carries the reduced-motion warning; going back to 2D
  // is the thing that warning is recommending.
  const warnReducedMotion = reducedMotion && !coarsePointer && choice === '2D'
  const next: BoardViewChoice = choice === '2D' ? '3D' : '2D'

  return (
    <div className="fixed bottom-4 right-4 z-50 flex max-w-xs flex-col items-end gap-1 text-right">
      <button
        type="button"
        disabled={coarsePointer}
        aria-describedby={coarsePointer ? 'board-view-toggle-reason' : undefined}
        onClick={() => onChange(next)}
        className="rounded-lg border border-border bg-surface-raised px-4 py-2 text-sm font-medium text-ink shadow-sm hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:text-ink-subtle disabled:hover:bg-surface-raised"
      >
        {LABEL[choice]}
      </button>

      {coarsePointer ? (
        <p
          id="board-view-toggle-reason"
          className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-ink-muted"
        >
          {COARSE_POINTER_REASON}
        </p>
      ) : null}

      {warnReducedMotion ? (
        <p className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-ink-muted">
          {REDUCED_MOTION_WARNING}
        </p>
      ) : null}
    </div>
  )
}

export default BoardViewToggle
