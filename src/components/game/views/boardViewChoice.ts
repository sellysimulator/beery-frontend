import { useCallback, useState } from 'react'
import { getBoardView, setBoardView, type BoardViewChoice } from '../../../utils/storage'

/**
 * Which board this browser draws, and how that is decided (24 §2.2).
 *
 * The resolution order is:
 *
 *     localStorage 'board_view'  →  import.meta.env.VITE_BOARD_VIEW  →  '2D'
 *
 * `resolveBoardView` is pure — storage value and env value in, choice out — so
 * the whole matrix is testable without mounting a component, which matters
 * because the thing being decided is which of two very different render paths
 * a player gets.
 *
 * Splitting the pure resolution from the hook is also what keeps the seam
 * **D15** froze honest: `GameRoomPlaying` asks this module a question and looks
 * the answer up in `BOARD_VIEWS`. It never branches on '3D' itself.
 */

/** The fallback when nothing has chosen: the board that has always been here. */
const DEFAULT_CHOICE: BoardViewChoice = '2D'

function asChoice(value: string | null | undefined): BoardViewChoice | null {
  return value === '2D' || value === '3D' ? value : null
}

/**
 * The board to draw, given what storage holds and what the build was configured
 * with.
 *
 * A value that is neither `'2D'` nor `'3D'` — in storage OR in the env — is
 * treated as **unset**, not as an error, and falls through (24 §2.2). That is
 * not leniency for its own sake: the resolution order already has an answer for
 * "no preference", so a throw here would only turn a stale key into a broken
 * game screen. An unknown env value falling through to `Board2D` is what
 * `19 §2.8` already required of the seam before this section existed.
 */
export function resolveBoardView(
  stored: string | null | undefined,
  env: string | null | undefined,
): BoardViewChoice {
  return asChoice(stored) ?? asChoice(env) ?? DEFAULT_CHOICE
}

/**
 * The live choice, plus the setter the toggle calls.
 *
 * State, not a module constant, because the choice is now runtime-mutable
 * (24 §2.1). It is read from storage once, on mount: a second tab that flips
 * the toggle is not something this screen tries to follow mid-game, and
 * `localStorage` is here so that the *next* load in that tab agrees, not so
 * that two tabs stay in lockstep.
 *
 * The setter writes through to storage before it moves the state, so a player
 * whose browser then loses its WebGL context — and gets sent back to 2D by the
 * boundary of 24 §7.6 — is reasoning about a storage value that was always the
 * one on screen.
 */
export function useBoardViewChoice(): [BoardViewChoice, (choice: BoardViewChoice) => void] {
  const [choice, setChoice] = useState<BoardViewChoice>(() =>
    resolveBoardView(getBoardView(), import.meta.env.VITE_BOARD_VIEW),
  )

  const choose = useCallback((next: BoardViewChoice): void => {
    setBoardView(next)
    setChoice(next)
  }, [])

  return [choice, choose]
}
