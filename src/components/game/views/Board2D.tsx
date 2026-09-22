import type { ReactElement } from 'react'
import type { PlayerView, Role } from '../../../types/game'
import DecisionForm from '../DecisionForm'
import DecisionPanel from '../DecisionPanel'
import GameOverPanel from '../GameOverPanel'
import OwnHistoryChart from '../OwnHistoryChart'
import PausedOverlay from '../PausedOverlay'
import RoleBanner from '../RoleBanner'
import SettlementRecap from '../SettlementRecap'
import WaitingForOthers from '../WaitingForOthers'

/**
 * Everything a board view needs, and nothing it has to work out for itself.
 *
 * This is the seam **D15** keeps: a phase-2 `Board3D` implements the same
 * props and drops in at the same place, without a line of state flow moving.
 * Every field here is either a store value or a callback owned by the screen
 * above — the view computes nothing (§2.8).
 */
export interface BoardViewProps {
  /** `store.myState` — the whole player view, as the server sent it. */
  view: PlayerView
  week: number
  durationWeeks: number
  paused: boolean
  pausedReason: string | null
  /** The decision is submitted and not reopened: show the locked state. */
  locked: boolean
  /** The locked state was reopened by *Change my order*. */
  isChangingOrder: boolean
  /** The game has finished; no order can be placed. */
  gameOver: boolean
  awaitingRoles: Role[]
  /** Pre-fill for a reopened order, or null for a fresh week. */
  initialOrder: number | null
  /** A server refusal to surface, or null. */
  notice: string | null
  /** False when the order cannot be changed: paused, over, or capped. */
  canChangeOrder: boolean
  /** A brief highlight on what changed when a week turned over (§3.2). */
  weekChanged: boolean
  onSubmitOrder(order: number): void
  onChangeOrder(): void
  onKeepOrder(): void
}

/**
 * The 2D board: the three regions of §2, always in the same place, on every
 * week.
 *
 * The order of the DOM is deliberate. The settlement recap comes first so a
 * player reads what happened before deciding, and the decision panel — with
 * the supply line in it — precedes the decision input, because underweighting
 * the supply line is the single most common losing mistake in the game
 * (`beer-game-spec.md` section 9.1, FM 2). On a phone the two columns stack in
 * that same order.
 */
export function Board2D({
  view,
  week,
  durationWeeks,
  paused,
  pausedReason,
  locked,
  isChangingOrder,
  gameOver,
  awaitingRoles,
  initialOrder,
  notice,
  canChangeOrder,
  weekChanged,
  onSubmitOrder,
  onChangeOrder,
  onKeepOrder,
}: BoardViewProps): ReactElement {
  return (
    <div className="min-h-screen px-4 py-6 pb-24 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <RoleBanner role={view.role} week={week} durationWeeks={durationWeeks} />

        <div className="grid gap-6 lg:grid-cols-2">
          <SettlementRecap view={view} highlight={weekChanged} />

          <div className="flex flex-col gap-6">
            <DecisionPanel view={view} />

            {gameOver ? (
              // Lifted to a shared component by 24 §6.3 so the 3D board's order-desk
              // panel renders these exact words rather than a second copy of them.
              <GameOverPanel />
            ) : locked ? (
              <WaitingForOthers
                myRole={view.role}
                awaitingRoles={awaitingRoles}
                notice={notice}
                canChange={canChangeOrder}
                onChangeOrder={onChangeOrder}
              />
            ) : (
              <DecisionForm
                // A new week, or a reopened order, starts a fresh input.
                key={`${week}-${isChangingOrder ? 'change' : 'new'}`}
                view={view}
                week={week}
                disabled={paused}
                initialOrder={initialOrder}
                isChange={isChangingOrder}
                notice={notice}
                onSubmit={onSubmitOrder}
                onCancel={onKeepOrder}
              />
            )}
          </div>
        </div>

        <OwnHistoryChart history={view.own_history} />
      </div>

      {paused ? <PausedOverlay reason={pausedReason} /> : null}
    </div>
  )
}

export default Board2D
