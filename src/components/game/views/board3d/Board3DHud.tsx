/* eslint-disable react-refresh/only-export-components --
   The HUD's fixed copy lives beside the HUD that renders it. `PROMPT_COPY` is
   the keyboard vocabulary this overlay teaches and `TOUCH_PROMPT_COPY` the
   touch one, and 24 §6.2 puts them in this file on purpose: a second copy of
   "Esc to close" in a legend and in a test fixture is a copy that drifts. */
import type { ReactElement } from 'react'
import type { PlayerView } from '../../../../types/game'
import useMediaQuery from '../../../shared/useMediaQuery'
import { RECEIPT_LABEL } from '../../RoleBanner'
import { PANEL_TITLE } from './Board3DPanels'
import ModelAttribution from './ModelAttribution'
import MovePad, { type MovePadProps } from './MovePad'
import { COARSE_POINTER_QUERY } from './playerMotion'
import type { InteractTarget, InteractTargetId } from './sceneModel'

/**
 * The fixed copy of the overlay — the controls the player has, in the words the
 * prompts use.
 *
 * The per-state desk prompt is **not** here: 24 §5.2 makes it a pure function of
 * the props in `sceneModel.ts`, and the HUD only renders the string the model
 * already produced. What lives here is the vocabulary that never varies with
 * game state, which is exactly the part a legend and a test both need to name.
 */
export const PROMPT_COPY: Record<'move' | 'look' | 'interact' | 'close', string> = {
  move: 'W A S D or the arrow keys — walk',
  look: 'Drag with the mouse — look around',
  interact: 'E at the desk, the ledger wall or the team board — open it',
  close: 'Esc — close the panel you just opened',
}

/**
 * The same four lines for a finger (24 §5.7). Shown instead of `PROMPT_COPY`
 * on a coarse pointer, because "W A S D" on a phone is a legend for a keyboard
 * that is not there. Short on purpose: on a 375 px screen the legend shares
 * its row with the 2D/3D toggle and wraps into whatever is left.
 */
export const TOUCH_PROMPT_COPY: Record<'move' | 'look' | 'interact' | 'close', string> = {
  move: 'Pad — walk and turn',
  look: 'Drag — look around',
  interact: 'Open — at a station',
  close: 'Close — shut a panel',
}

function legendLines(copy: Record<'move' | 'look' | 'interact' | 'close', string>): string[] {
  return [copy.move, copy.look, copy.interact, copy.close]
}

/** The label of the tappable interact button: the action, then the station by
 *  the panel's own title, so the button and the panel it opens agree. */
export function interactLabel(id: InteractTargetId): string {
  return `Open · ${PANEL_TITLE[id]}`
}

/**
 * The bottom gutter every fixed control on this board sits above: 1rem, or the
 * device's safe-area inset where that is larger (a home indicator, a rounded
 * corner). The 2D/3D toggle uses the same expression, so the pad, the legend
 * and the toggle share one baseline. The side and top gutters follow the same
 * rule — `max(1rem, env(safe-area-inset-<edge>))` — and a control stacked
 * under the week strip adds its offset to that expression, so a landscape
 * notch never covers a corner (game_stack.md, safe area).
 */
const BOTTOM_GUTTER = 'bottom-[max(1rem,env(safe-area-inset-bottom))]'

export interface Board3DHudProps {
  /** `store.myState`, for the role's receipt wording and the arrival figure. */
  view: PlayerView
  week: number
  durationWeeks: number
  /**
   * The interact target in range, as the model describes it, or null when
   * nothing is within `INTERACT_DISTANCE`. Its `prompt` is already worded by
   * `sceneModel.ts` (§5.2); its `enabled` decides whether the Open button is
   * offered (§5.7) — false while paused, exactly when `E` is inert.
   */
  nearTarget: InteractTarget | null
  /**
   * Open the station the player is standing at — the very function `Board3D`
   * binds to `E`, so a tap and a keypress cannot open different things
   * (24 §5.7).
   */
  onInteract(id: InteractTargetId): void
  /**
   * The on-screen pad's press/release pair, or null while a panel is open.
   * The pad renders only on a coarse pointer (§5.7); with a panel open there
   * is nothing to walk to and the frame loop is idle, so it gets out of the
   * panel's way rather than sitting under it.
   */
  pad: MovePadProps | null
  /** A server refusal to surface, or null (§5.6). */
  notice: string | null
  /** True for the 400 ms after a week turned over (§5.5). */
  weekChanged: boolean
}

/**
 * The DOM overlay: everything in this board that is text (24 §6.2).
 *
 * The rule the whole file follows is that **words are DOM and never in-scene**.
 * A sign painted on a wall is only readable if the player happens to be facing
 * it, which is fine for a warehouse sign and unacceptable for a refusal or a
 * week change. So the notice strip, the prompt and the week announcement are
 * ordinary HTML pinned over the canvas, where a screen reader can reach them
 * and where facing the wrong way cannot hide them (§5.6, AC 16).
 *
 * The overlay is `pointer-events-none` as a whole, with the things a player
 * actually presses — the legend, the credits, the Open button and the movement
 * pad — opting back in. Anything else would eat the drag-look the camera
 * depends on, and the player would be left with a scene that simply does not
 * turn.
 *
 * ## At phone width (24 §5.7)
 *
 * Below `sm` the corners are shared, so each one is spoken for. Top-left: the
 * week strip. Top-right: the week-change announcement (it moves under the
 * week strip from `sm` up). Centre-top, below the week strip: the notice.
 * Bottom-left: the pad stacked above the legend, one column, so a legend that
 * wraps pushes the pad up instead of under it. Bottom-right: the 2D/3D toggle
 * (`GameRoomPlaying`'s, `z-50`) with the credits stacked above it. The legend
 * is capped to the width the toggle leaves, so the two never meet at 375 px.
 */
export function Board3DHud({
  view,
  week,
  durationWeeks,
  nearTarget,
  onInteract,
  notice,
  weekChanged,
  pad,
}: Board3DHudProps): ReactElement {
  const settlement = view.settlement
  const coarsePointer = useMediaQuery(COARSE_POINTER_QUERY)
  const prompt = nearTarget?.prompt ?? null
  // Only an enabled target is offered: while paused the prompt still reads
  // and E is inert, and a button that does nothing is worse than none (§5.2).
  const openable = nearTarget !== null && nearTarget.enabled ? nearTarget.id : null
  const legend = legendLines(coarsePointer ? TOUCH_PROMPT_COPY : PROMPT_COPY)

  // §5.5's third signal. The other two are in the scene — the ledger frame and
  // the front lane — and neither of them exists for a screen reader, so this
  // sentence is the whole week change for a player who is not looking at it.
  // The truthiness guard, not a `=== null`: `PlayerView.settlement` is typed
  // non-nullable, and `SettlementRecap` guards it the same way for the same
  // reason — a week that arrives without one should go quiet, not throw.
  const announcement = !weekChanged
    ? ''
    : settlement
      ? `Week ${week}. ${RECEIPT_LABEL[view.role]} ${settlement.arrived}.`
      : `Week ${week}.`

  return (
    <div className="pointer-events-none fixed inset-0 z-20">
      {/* The notice strip: centre-top, in the danger hue, for as long as the
          prop is non-null (§5.6). The live region is mounted whether or not
          there is a notice, because a `role="status"` that appears at the same
          moment as its text is a region a screen reader may never announce. */}
      <div
        role="status"
        aria-live="polite"
        className="absolute inset-x-0 top-[calc(max(1rem,env(safe-area-inset-top))_+_3rem)] flex justify-center px-4 sm:top-[max(1rem,env(safe-area-inset-top))]"
      >
        {notice === null ? null : (
          <p className="max-w-md rounded-md border border-danger bg-danger-soft px-4 py-2 text-center text-danger">
            {notice}
          </p>
        )}
      </div>

      {/* The week strip. `numeric` keeps the figures from jittering as they
          update, the same way every other week counter in the app does. */}
      <div className="absolute left-[max(1rem,env(safe-area-inset-left))] top-[max(1rem,env(safe-area-inset-top))] rounded-md border border-border bg-surface-raised/90 px-3 py-2 text-sm">
        <span className="numeric">
          Week {week} of {durationWeeks}
        </span>
        <span className="sr-only">, {view.role}</span>
      </div>

      {/* The week-change announcement of §5.5. Present always, filled for the
          400 ms `weekChanged` is true, and empty otherwise. */}
      <div
        role="status"
        aria-live="polite"
        className="absolute right-[max(1rem,env(safe-area-inset-right))] top-[max(1rem,env(safe-area-inset-top))] max-w-[calc(100vw-12rem)] text-sm text-ink-muted sm:left-[max(1rem,env(safe-area-inset-left))] sm:right-auto sm:top-[calc(max(1rem,env(safe-area-inset-top))_+_3rem)] sm:max-w-none"
      >
        {announcement === '' ? null : (
          <p className="rounded-md border border-brand bg-brand-soft px-3 py-2 text-ink">
            {announcement}
          </p>
        )}
      </div>

      {/* The crosshair. Purely an aiming aid for the proximity prompt, so it is
          hidden from the accessibility tree — there is nothing to say about a
          dot. */}
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-ink-inverse bg-ink/60"
      />

      {/* The interact prompt, above the crosshair. 24 §5.2 gives this board no
          clickable meshes at all: proximity plus a keypress is one interaction
          model, and a second one made of raycast hit-tests is how Tequila ended
          up with two. The Open button below the crosshair is not a second
          model: it appears on the same proximity and calls the same function
          `E` does (§5.7). */}
      <div
        role="status"
        aria-live="polite"
        className="absolute left-1/2 top-[calc(50%-3rem)] flex -translate-x-1/2 justify-center px-4"
      >
        {prompt === null ? null : (
          <p className="max-w-sm rounded-md border border-border-strong bg-surface-raised/95 px-3 py-2 text-center text-sm">
            {prompt}
          </p>
        )}
      </div>

      {/* The tappable twin of `E` (§5.7). Offered only on a coarse pointer —
          a keyboard player has `E` and the prompt above already says so — and
          only while the target in range is enabled. It is a real `<button>`,
          and its name says which panel it opens. */}
      {!coarsePointer || openable === null ? null : (
        <div className="absolute left-1/2 top-[calc(50%+1.25rem)] flex -translate-x-1/2 justify-center px-4">
          <button
            type="button"
            onClick={() => onInteract(openable)}
            className="pointer-events-auto min-h-11 whitespace-nowrap rounded-md bg-brand px-4 py-2 text-sm font-semibold text-ink-inverse shadow-sm transition hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            {interactLabel(openable)}
          </button>
        </div>
      )}

      {/* Bottom-left: the pad above the legend, one column (§5.7). The legend
          is capped to the room the 2D/3D toggle leaves on a phone and to
          `max-w-xs` from `sm` up, where it reads as it always has. */}
      <div className={`absolute left-[max(1rem,env(safe-area-inset-left))] flex flex-col items-start gap-2 ${BOTTOM_GUTTER}`}>
        {coarsePointer && pad !== null ? (
          <div className="pointer-events-auto">
            <MovePad onPress={pad.onPress} onRelease={pad.onRelease} />
          </div>
        ) : null}

        <div className="pointer-events-auto max-w-[calc(100vw-15rem)] rounded-md border border-border bg-surface-raised/90 px-3 py-2 text-xs text-ink-muted sm:max-w-xs">
          <ul className="flex flex-col gap-1">
            {legend.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </div>

      {/* Above the 2D/3D toggle, not under it: the toggle is `z-50` and sits on
          this same corner, so the credits start one toggle-height up. Capped in
          height so an opened disclosure scrolls instead of running off the top
          of a phone held sideways. */}
      <div className="pointer-events-auto absolute bottom-[calc(max(1rem,env(safe-area-inset-bottom))_+_3.5rem)] right-[max(1rem,env(safe-area-inset-right))] max-h-[50dvh] max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-xs">
        <ModelAttribution />
      </div>
    </div>
  )
}

export default Board3DHud
