import type { ReactElement } from 'react'
import { Link } from 'react-router-dom'
import { useGameStore } from '../../store/gameStore'
import { resultsPath } from '../../utils/resultsPath'

/**
 * "The game is over" — the one place the end-of-game copy lives.
 *
 * This was inline in `Board2D.tsx` until the 3D board needed the same words in
 * its order-desk panel (24 §5.3). Two boards rendering two copies of the same
 * paragraph is two places for the debrief framing to drift, so 24 §6.3 lifts it
 * here and has both boards render it. The lift is mechanical: the markup and the
 * strings are `Board2D`'s, unchanged, so there is no behaviour delta and
 * `GameRoomFlow.test.tsx` still passes unmodified.
 *
 * The copy is doing teaching work, which is why it is worth protecting: the
 * closing sentence names the gap between what customers wanted and what the
 * chain ordered, which is the bullwhip the host is about to walk everyone
 * through (`beer-game-spec.md` section 9.5, `21 §2.2`).
 *
 * The link opens the same results screen the host sees. It reads the room and
 * the persisted game id from the store rather than taking props, so neither
 * board has to thread them through.
 */
export function GameOverPanel(): ReactElement {
  const roomCode = useGameStore((state) => state.roomCode)
  const gamePublicId = useGameStore((state) => state.gamePublicId)

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised px-5 py-4">
      <h2 className="text-xl font-semibold">The game is over</h2>
      <p className="text-ink-muted">
        No more orders. Your host will take everyone through the results — and the gap
        between what customers wanted and what the chain ordered is the whole point of
        the debrief.
      </p>
      {roomCode ? (
        <Link
          to={resultsPath(roomCode, gamePublicId)}
          className="self-start rounded-md border border-brand bg-brand-soft px-4 py-2 text-sm font-semibold text-brand-strong hover:border-ink"
        >
          See the results
        </Link>
      ) : null}
    </section>
  )
}

export default GameOverPanel
