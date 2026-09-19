import { useEffect, useState, type ReactElement } from 'react'
import { Link } from 'react-router-dom'
import { getMyGame } from '../../api/users'
import { errorMessage } from '../../api/http'
import {
  resultsViewFromResponse,
  type ResultsResponse,
  type ResultsView,
} from '../charts/chartSetup'
import CostSummary from '../results/CostSummary'
import BullwhipChart from '../results/BullwhipChart'
import ChainCostBar from '../results/ChainCostBar'
import RoleStatsTable from '../results/RoleStatsTable'
import LoadingSpinner from '../shared/LoadingSpinner'

export interface MatchDetailProps {
  /** The `:gameId` path parameter, exactly as the router delivered it. */
  gameId: string | undefined
}

/**
 * The copy for a game that is not the caller's.
 *
 * `GET /users/me/games/{id}` answers 404 — never 403 — for a game the caller
 * did not play, precisely so that it is not a game-existence oracle
 * (`15 §3.6`). Saying "you don't have permission" here would confirm the game
 * exists and hand back exactly what the status code was chosen to withhold.
 */
export const NOT_IN_HISTORY = "That game isn't in your history."

function isNotFound(err: unknown): boolean {
  const response = (err as { response?: { status?: unknown } } | null | undefined)?.response
  return response?.status === 404
}

/** `/profile/games/banana` is not a game id, and needs no round trip to say so. */
function parseGameId(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

/**
 * A fetch result, tagged with the game id it answers for.
 *
 * Tagging is what keeps the previous game's results from flashing up while
 * the next one loads, without resetting state from inside the effect — which
 * is a cascading render, and which React's own lint rule refuses.
 */
type Outcome =
  | { kind: 'view'; id: number; view: ResultsView }
  | { kind: 'error'; id: number; message: string }

function Message({ text }: { text: string }): ReactElement {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
      <h1 className="text-2xl font-semibold">{text}</h1>
      <Link
        to="/profile"
        className="rounded-md border border-border-strong px-4 py-2 text-sm hover:border-brand hover:text-brand"
      >
        Back to your profile
      </Link>
    </div>
  )
}

/**
 * One of the caller's own games, reopened in full.
 *
 * It renders through section 21's components and section 21's normaliser, and
 * owns nothing of its own beyond the fetch: `GET /users/me/games/{id}` returns
 * the identical `ResultsResponse` that `GET /games/{code}/results` does, and a
 * second mapping — or a second renderer — of one contract drifts from the
 * first the moment either changes (§2.4).
 *
 * This route exists for the case the public one cannot serve: a room code that
 * has been reused, so `/results/{code}` is ambiguous about which game it means.
 */
export function MatchDetail({ gameId }: MatchDetailProps): ReactElement {
  const id = parseGameId(gameId)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [revealed, setRevealed] = useState(true)

  useEffect(() => {
    if (id === null) return

    let cancelled = false

    void (async () => {
      try {
        const payload: ResultsResponse = await getMyGame(id)
        if (!cancelled) setOutcome({ kind: 'view', id, view: resultsViewFromResponse(payload) })
      } catch (err) {
        if (cancelled) return
        setOutcome({
          kind: 'error',
          id,
          message: isNotFound(err)
            ? NOT_IN_HISTORY
            : errorMessage(err, 'That game could not be loaded.'),
        })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [id])

  // `/profile/games/banana` never reaches the network, and says the same
  // thing a game belonging to somebody else does.
  if (id === null) return <Message text={NOT_IN_HISTORY} />

  const current = outcome && outcome.id === id ? outcome : null

  if (current === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingSpinner label="Loading the game" size="lg" />
      </div>
    )
  }

  if (current.kind === 'error') return <Message text={current.message} />

  const view = current.view

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-10">
      <header className="flex flex-col gap-2">
        <Link to="/profile" className="text-sm text-ink-muted hover:text-brand">
          Back to your profile
        </Link>
        <h1 className="text-3xl font-semibold">
          Room <span className="numeric tracking-widest uppercase">{view.room_code}</span>
        </h1>
        <p className="text-ink-muted">
          <span className="numeric">{view.weeks_played}</span> weeks
          {view.ended_early ? ' (ended early)' : ''}
          {view.finished_at ? ` · ${new Date(view.finished_at).toLocaleDateString()}` : ''}
          {view.preset_name ? ` · ${view.preset_name}` : ''}
        </p>
      </header>

      <section aria-label="Final cost per role and for the chain" className="flex flex-col gap-4">
        <CostSummary
          view={view}
          revealed={revealed}
          onToggle={() => setRevealed((current) => !current)}
        />
        <ChainCostBar view={view} revealed={revealed} />
      </section>

      <section aria-label="True customer demand against every order stream">
        <BullwhipChart view={view} />
      </section>

      <section aria-label="Bullwhip ratio per role">
        <RoleStatsTable view={view} />
      </section>
    </div>
  )
}

export default MatchDetail
