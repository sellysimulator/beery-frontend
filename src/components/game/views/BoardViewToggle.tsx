import type { ReactElement } from 'react'
import type { BoardViewChoice } from '../../../utils/storage'
import useMediaQuery from '../../shared/useMediaQuery'

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

/** 24 §7.6.2: 3D is still offered under reduced motion, but not silently. */
const REDUCED_MOTION_WARNING =
  'The 3D warehouse moves the camera as you walk. You have asked for reduced motion.'

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
 * It is enabled on every pointer. Until 2026-11-16 a coarse pointer got it
 * `disabled` with *"The 3D warehouse needs a keyboard and a mouse."*; the
 * warehouse now has touch controls — drag to look, an on-screen pad to walk
 * and turn, and an Open button at each station (24 §5.7) — so a phone or a
 * tablet is offered 3D like anything else.
 *
 * The bottom and right offsets are `max(1rem, safe-area-inset-<edge>)` rather
 * than a flat `bottom-4 right-4`, so on a phone with a home indicator or a
 * landscape notch the button is not under it; the 3D HUD stacks its own
 * bottom corners on the same baseline. `min-h-11`
 * keeps it a 44 px touch target.
 */
export function BoardViewToggle({ choice, onChange }: BoardViewToggleProps): ReactElement {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

  // Only the offer of 3D carries the reduced-motion warning; going back to 2D
  // is the thing that warning is recommending.
  const warnReducedMotion = reducedMotion && choice === '2D'
  const next: BoardViewChoice = choice === '2D' ? '3D' : '2D'

  return (
    <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-50 flex max-w-xs flex-col items-end gap-1 text-right">
      <button
        type="button"
        onClick={() => onChange(next)}
        className="min-h-11 rounded-lg border border-border bg-surface-raised px-4 py-2 text-sm font-medium text-ink shadow-sm hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        {LABEL[choice]}
      </button>

      {warnReducedMotion ? (
        <p className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-ink-muted">
          {REDUCED_MOTION_WARNING}
        </p>
      ) : null}
    </div>
  )
}

export default BoardViewToggle
