import type { ReactElement } from 'react'
import { Link } from 'react-router-dom'
import type { HostedGameSummary } from '../../api/users'
import { resultsPath } from '../../utils/resultsPath'

export interface HostedGamesListProps {
  /** One page of hosted games, newest first. Rendered in the order it arrived. */
  games: HostedGameSummary[]
  total: number
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  loading?: boolean
}

/** A finished-at timestamp is an ISO 8601 string on the wire. */
function finishedOn(isoTimestamp: string): string {
  const when = new Date(isoTimestamp)
  return Number.isNaN(when.getTime()) ? isoTimestamp : when.toLocaleDateString()
}

/**
 * "Games you hosted": the games this account hosted while signed in
 * (`GET /users/me/hosted-games`, **D23**).
 *
 * Deliberately separate from the match history and the statistics, which
 * count only the seats the user played: hosting is not playing, so nothing
 * here carries a cost or a ratio of the user's own. Each entry opens the open
 * results page by the game's `public_id` (D22) — the same page everyone in
 * the room has, so the list grants nothing a link would not.
 *
 * Like `MatchHistoryTable`, it never fetches: it is handed a page and a
 * callback.
 */
export function HostedGamesList({
  games,
  total,
  page,
  pageSize,
  onPageChange,
  loading = false,
}: HostedGamesListProps): ReactElement {
  const lastPage = Math.max(1, Math.ceil(total / pageSize))
  const empty = games.length === 0

  return (
    <section aria-labelledby="profile-hosted" className="flex flex-col gap-4">
      <h2 id="profile-hosted" className="text-2xl font-semibold">
        Games you hosted
      </h2>
      <p className="text-sm text-ink-muted">
        Games you ran as the host while signed in. They don't count in your statistics or
        your games above: the host doesn't play.
      </p>

      {games.length > 0 ? (
        <div className="overflow-x-auto" aria-busy={loading}>
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Games you hosted, newest first</caption>
            <thead>
              <tr className="bg-surface-sunken">
                <th scope="col" className="px-3 py-2">
                  Date
                </th>
                <th scope="col" className="px-3 py-2">
                  Room
                </th>
                <th scope="col" className="px-3 py-2">
                  Seats
                </th>
                <th scope="col" className="px-3 py-2">
                  Finished
                </th>
              </tr>
            </thead>
            <tbody>
              {games.map((game) => (
                <tr key={game.public_id} className="border-t border-border">
                  <td className="px-3 py-2">{finishedOn(game.finished_at)}</td>
                  <th scope="row" className="px-3 py-2 text-left font-normal">
                    <Link
                      to={resultsPath(game.public_id)}
                      aria-label={`Results of room ${game.room_code}`}
                      className="numeric tracking-widest text-brand-strong uppercase underline"
                    >
                      {game.room_code}
                    </Link>
                  </th>
                  <td className="numeric px-3 py-2">{game.player_count}</td>
                  <td className="px-3 py-2">{game.ended_early ? 'Ended early' : 'Played to the end'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {empty && !loading ? (
        <p className="rounded-lg border border-border bg-surface-raised px-5 py-4 text-sm text-ink-muted">
          {page > 1 ? (
            <>
              No more games.{' '}
              <button
                type="button"
                onClick={() => onPageChange(1)}
                className="text-brand-strong underline"
              >
                Back to the first page
              </button>
            </>
          ) : (
            "You haven't hosted a game while signed in yet."
          )}
        </p>
      ) : null}

      {total > pageSize || page > 1 ? (
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            aria-label="Previous page of hosted games"
            className="rounded-md border border-border-strong px-3 py-2 transition hover:border-brand hover:text-brand disabled:border-border disabled:text-ink-subtle"
          >
            Previous
          </button>
          <span className="text-ink-muted">
            Page <span className="numeric">{page}</span> of{' '}
            <span className="numeric">{lastPage}</span>
          </span>
          <button
            type="button"
            disabled={page >= lastPage}
            onClick={() => onPageChange(page + 1)}
            aria-label="Next page of hosted games"
            className="rounded-md border border-border-strong px-3 py-2 transition hover:border-brand hover:text-brand disabled:border-border disabled:text-ink-subtle"
          >
            Next
          </button>
        </div>
      ) : null}
    </section>
  )
}

export default HostedGamesList
