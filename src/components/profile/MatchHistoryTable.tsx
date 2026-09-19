import type { MouseEvent, ReactElement } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Tooltip from '../shared/Tooltip'
import { NULL_RATIO_EXPLANATION } from '../results/RoleStatsTable'
import { ROLE_LABEL } from '../lobby/roleCopy'
import type { MatchSummary } from '../../api/users'

export interface MatchHistoryTableProps {
  /** One page of history, newest first. Rendered in the order it arrived. */
  matches: MatchSummary[]
  total: number
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  loading?: boolean
}

/** The placeholder for a ratio the server sent as `null` (**D12**). */
const MISSING = '—'

function figure(value: number): string {
  return value.toFixed(2)
}

/** A finished-at timestamp is an ISO 8601 string on the wire. */
function playedOn(isoTimestamp: string): string {
  const when = new Date(isoTimestamp)
  return Number.isNaN(when.getTime()) ? isoTimestamp : when.toLocaleDateString()
}

function Ratio({ value }: { value: number | null }): ReactElement {
  if (value === null) {
    return (
      <Tooltip text={NULL_RATIO_EXPLANATION}>
        <span>{MISSING}</span>
      </Tooltip>
    )
  }
  return <>{figure(value)}</>
}

function MatchRow({ match }: { match: MatchSummary }): ReactElement {
  const navigate = useNavigate()
  const destination = `/results/${match.room_code}`

  /**
   * The whole row is the target, and the room code is a real link inside it
   * so the row is reachable by keyboard and openable in a new tab. The link's
   * own handler has already called `preventDefault` by the time the click
   * bubbles here, which is what keeps one click from navigating twice.
   */
  function open(event: MouseEvent<HTMLTableRowElement>): void {
    if (event.defaultPrevented) return
    void navigate(destination)
  }

  return (
    <tr onClick={open} className="cursor-pointer border-t border-border hover:bg-surface-sunken">
      <td className="px-3 py-2">{playedOn(match.finished_at)}</td>
      <th scope="row" className="px-3 py-2 text-left font-normal">
        <Link
          to={destination}
          className="numeric tracking-widest text-brand-strong uppercase underline"
        >
          {match.room_code}
        </Link>
      </th>
      <td className="px-3 py-2">{ROLE_LABEL[match.role]}</td>
      <td className="numeric px-3 py-2">{match.weeks_played}</td>
      <td className="numeric px-3 py-2">{figure(match.total_cost)}</td>
      <td className="numeric px-3 py-2">
        <Ratio value={match.bullwhip_ratio} />
      </td>
      <td className="numeric px-3 py-2">{figure(match.chain_total_cost)}</td>
      <td className="px-3 py-2">{match.preset_name ?? MISSING}</td>
    </tr>
  )
}

/**
 * The caller's match history, one page at a time.
 *
 * A row opens `/results/:roomCode` — the same public results screen section
 * 21 builds, so the application has exactly one results renderer.
 *
 * The table never fetches. It is handed a page and a callback, which is what
 * keeps the page's two-request budget (§3.3) a property of the page rather
 * than something a column could quietly undo by looking up a game per row.
 */
export function MatchHistoryTable({
  matches,
  total,
  page,
  pageSize,
  onPageChange,
  loading = false,
}: MatchHistoryTableProps): ReactElement {
  const lastPage = Math.max(1, Math.ceil(total / pageSize))
  const empty = matches.length === 0

  return (
    <section aria-labelledby="profile-history" className="flex flex-col gap-4">
      <h2 id="profile-history" className="text-2xl font-semibold">
        Your games
      </h2>

      <div className="overflow-x-auto" aria-busy={loading}>
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Games you have finished, newest first</caption>
          <thead>
            <tr className="bg-surface-sunken">
              <th scope="col" className="px-3 py-2">
                Date
              </th>
              <th scope="col" className="px-3 py-2">
                Room
              </th>
              <th scope="col" className="px-3 py-2">
                Role
              </th>
              <th scope="col" className="px-3 py-2">
                Weeks
              </th>
              <th scope="col" className="px-3 py-2">
                Your cost
              </th>
              <th scope="col" className="px-3 py-2">
                Bullwhip
              </th>
              <th scope="col" className="px-3 py-2">
                Chain total
              </th>
              <th scope="col" className="px-3 py-2">
                Preset
              </th>
            </tr>
          </thead>
          <tbody>
            {matches.map((match) => (
              <MatchRow key={match.game_id} match={match} />
            ))}
          </tbody>
        </table>
      </div>

      {empty ? (
        <p className="rounded-lg border border-border bg-surface-raised px-5 py-4 text-sm text-ink-muted">
          {page > 1 ? (
            <>
              No more results.{' '}
              <button
                type="button"
                onClick={() => onPageChange(1)}
                className="text-brand-strong underline"
              >
                Back to the first page
              </button>
            </>
          ) : (
            'No games to show yet.'
          )}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
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
          className="rounded-md border border-border-strong px-3 py-2 transition hover:border-brand hover:text-brand disabled:border-border disabled:text-ink-subtle"
        >
          Next
        </button>
        <span className="text-ink-muted">
          <span className="numeric">{total}</span> {total === 1 ? 'game' : 'games'}
        </span>
      </div>
    </section>
  )
}

export default MatchHistoryTable
