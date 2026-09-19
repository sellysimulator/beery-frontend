import type { ReactElement, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import Tooltip from '../shared/Tooltip'
import type { UserStatsResponse } from '../../api/users'

export interface StatsSummaryProps {
  stats: UserStatsResponse
}

/**
 * Why an average ratio can be missing.
 *
 * Section 21's sentence is about one game — "Customer demand never varied" —
 * and does not fit an average across several, so the dash treatment is reused
 * and the sentence is not (§2.1).
 */
export const NULL_BULLWHIP_AVG_EXPLANATION =
  "None of your games had customer demand that varied, so there's nothing to amplify."

/** The placeholder for a figure the server sent as `null`. Never `0`, never `0.00`. */
const MISSING = '—'

/** A rate, at two decimals. Nothing here derives a figure; the server sent it. */
function rate(value: number): string {
  return value.toFixed(2)
}

function Figure({
  label,
  explanation,
  children,
}: {
  label: string
  explanation: string
  children: ReactNode
}): ReactElement {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface-raised px-5 py-4">
      <h3 className="text-sm font-semibold text-ink-muted">{label}</h3>
      <p className="numeric text-figure text-ink">{children}</p>
      <p className="text-sm text-ink-muted">{explanation}</p>
    </div>
  )
}

/**
 * The five figures from `GET /users/me/stats`, each with the one line that
 * makes it mean something.
 *
 * "Average bullwhip ratio" is meaningless to somebody who has played once, so
 * every figure carries its explanation rather than only the ones that look
 * obscure — a legend nobody reads is the same as no legend.
 *
 * Nothing is computed here. Every number is a server field, printed as it
 * arrived.
 */
export function StatsSummary({ stats }: StatsSummaryProps): ReactElement {
  const noGames = stats.games_played === 0

  return (
    <section aria-labelledby="profile-stats" className="flex flex-col gap-4">
      <h2 id="profile-stats" className="text-2xl font-semibold">
        What you have played
      </h2>

      {noGames ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised px-5 py-4">
          <p className="text-lg font-semibold">You haven&apos;t finished a game yet.</p>
          <p className="text-sm text-ink-muted">
            Your statistics fill in as soon as one finishes.{' '}
            <Link to="/home" className="text-brand-strong underline">
              Host or join a game
            </Link>
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Figure label="Games played" explanation="Games you finished.">
          {stats.games_played}
        </Figure>

        <Figure label="Weeks played" explanation="Simulated weeks across all of them.">
          {stats.weeks_played}
        </Figure>

        <Figure
          label="Average cost per week"
          explanation="Your total cost divided by the weeks you played. Lower is better."
        >
          {rate(stats.avg_cost_per_week)}
        </Figure>

        <Figure
          label="Average bullwhip ratio"
          explanation="How much you amplified customer demand, averaged across games. Closer to 1 is better."
        >
          {stats.bullwhip_avg === null ? (
            <Tooltip text={NULL_BULLWHIP_AVG_EXPLANATION}>
              <span>{MISSING}</span>
            </Tooltip>
          ) : (
            rate(stats.bullwhip_avg)
          )}
        </Figure>

        <Figure label="Best game" explanation="Your lowest cost per week.">
          {stats.best_game_id === null ? (
            MISSING
          ) : (
            /* By id, never by room code: a room code can belong to several
               games (`13 §2.2`), so the link has to name the game. */
            <Link
              to={`/profile/games/${stats.best_game_id}`}
              className="text-brand-strong underline"
            >
              Open it
            </Link>
          )}
        </Figure>
      </div>
    </section>
  )
}

export default StatsSummary
