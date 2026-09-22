import {
  Suspense,
  lazy,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactElement,
} from 'react'
import { submitOrder } from '../api/games'
import { useGameStore } from '../store/gameStore'
import WaitingNotice from '../components/lobby/WaitingNotice'
import Board2D, { type BoardViewProps } from '../components/game/views/Board2D'
import BoardViewToggle from '../components/game/views/BoardViewToggle'
import { useBoardViewChoice } from '../components/game/views/boardViewChoice'
import SceneLoading from '../components/game/views/board3d/SceneLoading'
import ErrorBoundary from '../components/shared/ErrorBoundary'

/**
 * The copy for the server's `TOO_MANY_SUBMISSIONS` refusal (§2.4). The server
 * caps resubmissions at 20; the player keeps the order they already have.
 */
const TOO_MANY_SUBMISSIONS_MESSAGE =
  "You've changed this order too many times. Your last order stands."

/** The one `error` code this screen maps to copy of its own. */
const TOO_MANY_SUBMISSIONS_CODE = 'TOO_MANY_SUBMISSIONS'

/** How long the post-transition highlight lasts. A class of four is waiting. */
const WEEK_HIGHLIGHT_MS = 400

/**
 * The 3D board, loaded only when somebody asks for it (24 §2.1).
 *
 * `lazy()`, never a static import. A static one would put three.js in the entry
 * graph for every player who never opens it — Tequila's defect, and the same
 * reason `shellScreens.ts` exists for the other three heavy screens.
 */
const Board3D = lazy(() => import('../components/game/views/Board3D'))

/**
 * The view seam (**D15**), now used. State flows through the store and into
 * whichever board is registered here, and nothing below the view layer changed
 * when the second entry arrived: section 24's `Board3D` implements the same
 * `BoardViewProps` and drops in at the same place.
 *
 * The record is typed `ComponentType<BoardViewProps>` rather than a plain
 * function, because `lazy()` returns a `LazyExoticComponent` and the narrower
 * type will not hold it. `BoardViewProps` itself is untouched (24 §1.2).
 */
const BOARD_VIEWS: Record<string, ComponentType<BoardViewProps>> = {
  '2D': Board2D,
  '3D': Board3D,
}

/**
 * The screen a player spends the whole game on.
 *
 * Section 17's `GameRoom.tsx` shell resolves it by path and name and renders
 * it once the room is `RUNNING`, `PAUSED` or `FINISHED` (**D19**). It takes no
 * props and reads the store directly, as every delegated screen does, and it
 * exports no `route`: it is not a page, and the registry's glob over
 * `src/pages/*.tsx` must not pick it up.
 *
 * No game state lives in component state. Everything on the screen is rebuilt
 * from `your_state` on every render, which is what makes a refresh — and the
 * full resync that follows it — indistinguishable from never having left
 * (§3.3). The three `useState` calls below hold interaction state only: which
 * week the player has reopened, what they last sent, and whether to flash the
 * recap for 400 ms.
 *
 * It registers no socket listener of its own. The one server error it has copy
 * for reaches it through `store.lastError`, which section 16's `error` handler
 * writes: the store is the single reader of the wire (`00-conventions.md §4`,
 * §2.4).
 */
export function GameRoomPlaying(): ReactElement {
  // Runtime-mutable now, so a hook rather than the module constant this used to
  // be: the player chooses their board mid-game and the choice persists per
  // browser (24 §2.2). An unknown key still falls through to `Board2D`, exactly
  // as `19 §2.8` required of the seam before it had a second entry.
  const [boardChoice, setBoardChoice] = useBoardViewChoice()
  const Board = BOARD_VIEWS[boardChoice] ?? Board2D

  const roomCode = useGameStore((state) => state.roomCode)
  const myState = useGameStore((state) => state.myState)
  const week = useGameStore((state) => state.week)
  const durationWeeks = useGameStore((state) => state.durationWeeks)
  const awaitingRoles = useGameStore((state) => state.awaitingRoles)
  const hasSubmitted = useGameStore((state) => state.hasSubmitted)
  const paused = useGameStore((state) => state.paused)
  const pausedReason = useGameStore((state) => state.pausedReason)
  const roomState = useGameStore((state) => state.roomState)
  const lastError = useGameStore((state) => state.lastError)
  const clearLastError = useGameStore((state) => state.clearLastError)

  /** The week whose submitted order the player has reopened for editing. */
  const [reopenedWeek, setReopenedWeek] = useState<number | null>(null)
  /** What this tab last sent, so *Change my order* can pre-fill it. */
  const [lastSubmission, setLastSubmission] = useState<{
    week: number
    order: number
  } | null>(null)
  const [weekChanged, setWeekChanged] = useState(false)
  const previousWeek = useRef<number | null>(null)

  // A week turning over has to be visible, or a player misses that anything
  // happened. Brief, and nothing but a highlight: the content itself is
  // already rebuilt from the new `your_state` (§3.2).
  useEffect(() => {
    if (week === null) return
    const previous = previousWeek.current
    previousWeek.current = week
    if (previous === null || previous === week) return

    // A refusal belongs to the week it was refused in. Cleared on the turn of
    // the week, and not on a remount, which must render identically (FM 11).
    clearLastError()
    setWeekChanged(true)
    const timer = setTimeout(() => setWeekChanged(false), WEEK_HIGHLIGHT_MS)
    return () => clearTimeout(timer)
  }, [week, clearLastError])

  if (!myState || week === null || durationWeeks === null) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <WaitingNotice
          title="Waiting for the server to send your position"
          detail="The game has started. Your inventory, your supply line and this week's order are on their way."
        />
      </div>
    )
  }

  const gameOver = roomState === 'FINISHED' || myState.phase === 'FINISHED'
  // The server has refused a resubmission: the order the player already has
  // stands, so the screen goes back to — and stays in — the locked state
  // (§2.4, AC 17). Derived, not copied into component state, so it survives a
  // remount exactly as the store does.
  const refusedResubmission = lastError?.code === TOO_MANY_SUBMISSIONS_CODE
  const isChangingOrder = reopenedWeek === week && !refusedResubmission
  const locked = hasSubmitted && !isChangingOrder
  const notice = refusedResubmission ? TOO_MANY_SUBMISSIONS_MESSAGE : null

  function handleSubmitOrder(order: number): void {
    // Paused or finished, the server refuses the order anyway; not emitting
    // is the client half of the same rule (§2.7, FM 10).
    if (!roomCode || week === null || paused || gameOver) return

    setLastSubmission({ week, order })
    setReopenedWeek(null)
    clearLastError()
    // Exactly `{room_id, week, order}`. No total, no alias, no claim of
    // authority — `week` is the guard the server's STALE_WEEK check compares
    // against (`12-socket-play.md` section 2).
    submitOrder({ room_id: roomCode, week, order })
  }

  function handleChangeOrder(): void {
    if (week === null) return
    // Acting on the refusal dismisses it, the way a screen dismisses
    // `joinError` once it has been shown (`16 §3`).
    clearLastError()
    setReopenedWeek(week)
  }

  function handleKeepOrder(): void {
    setReopenedWeek(null)
  }

  const boardProps: BoardViewProps = {
    view: myState,
    week,
    durationWeeks,
    paused,
    pausedReason,
    locked,
    isChangingOrder,
    gameOver,
    awaitingRoles,
    initialOrder: isChangingOrder
      ? (lastSubmission?.week === week ? lastSubmission.order : myState.last_order) ?? null
      : null,
    notice,
    // "Your last order stands": once the server has capped the
    // resubmissions, there is nothing left to change this week (§2.4).
    canChangeOrder: !paused && !gameOver && !refusedResubmission,
    weekChanged,
    onSubmitOrder: handleSubmitOrder,
    onChangeOrder: handleChangeOrder,
    onKeepOrder: handleKeepOrder,
  }

  return (
    <>
      {/*
        `<Suspense>` because `Board3D` is a lazy chunk: on the toggle it is
        fetched mid-game, on classroom wi-fi, with three people waiting
        (24 risk 2). The fallback is a card, not a spinner on black.

        This is the **outer** of the two boundaries 24 §7.4 asks for — the one
        around the lazy import. `SceneLoading` is the fallback the spec names
        for it (§6.2), and it is the only one of the two that can hold DOM: the
        second boundary is inside the `<Canvas>`, where every element is
        resolved against the THREE namespace and a `<div>` would throw.

        `SceneLoading` imports nothing but React, so naming it here does not
        pull three.js into the entry graph — AC 4 still holds.

        The boundary is keyed on the choice so that toggling back resets it.
        It catches what `Board3D`'s own boundary cannot: the lazy import
        itself failing. A tab left open across a redeploy asks for a chunk
        hash that no longer exists, the SPA rewrite answers with index.html,
        and without this the throw reaches the app-wide boundary and the
        player loses the whole game screen mid-week. The 2D board takes the
        same props, so it is the fallback.
      */}
      <ErrorBoundary key={boardChoice} fallback={<Board2D {...boardProps} />}>
        <Suspense fallback={<SceneLoading />}>
          <Board {...boardProps} />
        </Suspense>
      </ErrorBoundary>

      {/*
        A SIBLING of the board, never a prop of it (24 §2.1). That is what keeps
        `Board2D.tsx` unedited and `BoardViewProps` un-widened while both boards
        get the toggle for free.
      */}
      <BoardViewToggle choice={boardChoice} onChange={setBoardChoice} />
    </>
  )
}

export default GameRoomPlaying
