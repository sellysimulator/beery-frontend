/* eslint-disable react-refresh/only-export-components --
   The HUD's fixed copy lives beside the HUD that renders it. `PROMPT_COPY` is
   the keyboard vocabulary this overlay teaches, and 24 §6.2 puts it in this
   file on purpose: a second copy of "Esc to close" in a legend and in a test
   fixture is a copy that drifts. */
import type { ReactElement } from 'react'
import type { PlayerView } from '../../../../types/game'
import { RECEIPT_LABEL } from '../../RoleBanner'
import ModelAttribution from './ModelAttribution'

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

const LEGEND_LINES: readonly string[] = [
  PROMPT_COPY.move,
  PROMPT_COPY.look,
  PROMPT_COPY.interact,
  PROMPT_COPY.close,
]

export interface Board3DHudProps {
  /** `store.myState`, for the role's receipt wording and the arrival figure. */
  view: PlayerView
  week: number
  durationWeeks: number
  /**
   * The interact prompt for whatever is in range, already worded by
   * `sceneModel.ts` (§5.2), or null when nothing is within
   * `INTERACT_DISTANCE`.
   */
  prompt: string | null
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
 * The overlay is `pointer-events-none` as a whole, with the two things a player
 * actually clicks — the legend and the credits — opting back in. Anything else
 * would eat the drag-look the camera depends on, and the player would be left
 * with a scene that simply does not turn.
 */
export function Board3DHud({
  view,
  week,
  durationWeeks,
  prompt,
  notice,
  weekChanged,
}: Board3DHudProps): ReactElement {
  const settlement = view.settlement

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
      <div role="status" aria-live="polite" className="absolute inset-x-0 top-4 flex justify-center px-4">
        {notice === null ? null : (
          <p className="max-w-md rounded-md border border-danger bg-danger-soft px-4 py-2 text-center text-danger">
            {notice}
          </p>
        )}
      </div>

      {/* The week strip. `numeric` keeps the figures from jittering as they
          update, the same way every other week counter in the app does. */}
      <div className="absolute left-4 top-4 rounded-md border border-border bg-surface-raised/90 px-3 py-2 text-sm">
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
        className="absolute left-4 top-16 text-sm text-ink-muted"
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
          up with two. */}
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

      <div className="pointer-events-auto absolute bottom-4 left-4 max-w-xs rounded-md border border-border bg-surface-raised/90 px-3 py-2 text-xs text-ink-muted">
        <ul className="flex flex-col gap-1">
          {LEGEND_LINES.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>

      <div className="pointer-events-auto absolute bottom-4 right-4 max-w-xs">
        <ModelAttribution />
      </div>
    </div>
  )
}

export default Board3DHud
