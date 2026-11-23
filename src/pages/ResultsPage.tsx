import { useEffect, useState, type ReactElement } from 'react'
import { Link, useParams } from 'react-router-dom'
import http from '../api/http'
import BullwhipChart from '../components/results/BullwhipChart'
import CumulativeCostChart from '../components/results/CumulativeCostChart'
import NetInventoryChart from '../components/results/NetInventoryChart'
import ChainCostBar from '../components/results/ChainCostBar'
import CostSummary, { formatMoney } from '../components/results/CostSummary'
import DebriefNotes from '../components/results/DebriefNotes'
import ExportControls from '../components/results/ExportControls'
import GuestClaimPrompt from '../components/results/GuestClaimPrompt'
import RoleStatsTable from '../components/results/RoleStatsTable'
import {
  resultsViewFromResponse,
  type ResultsResponse,
  type ResultsView,
} from '../components/charts/chartSetup'
import { ROLE_LABEL } from '../components/lobby/roleCopy'
import LoadingSpinner from '../components/shared/LoadingSpinner'
import { isHostForRoom } from '../utils/storage'
import type { RouteDescriptor } from '../routes/registry'

/* ─── Fetching ─── */

/** Short, because three attempts happen while somebody watches a blank panel. */
const RETRY_DELAY_MS = 150
const RETRIES = 2
const UNAVAILABLE = "Results aren't available yet."

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** A fetch result, tagged with the URL it answers for. */
interface FetchOutcome {
  code: string
  /** `null` when every attempt failed. */
  view: ResultsView | null
}

function isNotFound(err: unknown): boolean {
  const response = (err as { response?: { status?: unknown } } | null | undefined)?.response
  return response?.status === 404
}

/* ─── Print ─── */

/**
 * The print rules key off `data-print` and nothing else.
 *
 * jsdom evaluates no stylesheet, so the print layout has to be expressed in
 * markup a test can read: every region on this page carries
 * `data-print="keep"` or `data-print="omit"`, and what gets printed is
 * decided by that attribute alone. What is left is the chart, its week table
 * and the ratio table — the one-page handout.
 */
const PRINT_CSS = `
@page { margin: 12mm; }
@media print {
  [data-print="omit"] { display: none !important; }
  [data-print="keep"] { break-inside: avoid; page-break-inside: avoid; }
}
`

/* ─── The screen ─── */

function SessionFacts({ view }: { view: ResultsView }): ReactElement | null {
  if (view.started_at === undefined || view.finished_at === undefined) return null

  const started = new Date(view.started_at)
  const finished = new Date(view.finished_at)

  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-1 text-sm text-ink-muted">
      <div className="flex gap-2">
        <dt>Played</dt>
        <dd>
          {started.toLocaleDateString()} {started.toLocaleTimeString()} —{' '}
          {finished.toLocaleTimeString()}
        </dd>
      </div>
      <div className="flex gap-2">
        <dt>Weeks</dt>
        <dd className="numeric">
          {view.weeks_played}
          {view.duration_weeks === undefined ? '' : ` of ${view.duration_weeks}`}
          {view.ended_early ? ' (ended early)' : ''}
        </dd>
      </div>
      {view.preset_name ? (
        <div className="flex gap-2">
          <dt>Scenario</dt>
          <dd>{view.preset_name}</dd>
        </div>
      ) : null}
    </dl>
  )
}

/** A cumulative-cost cell. A missing week prints nothing; it never prints a zero. */
function CostSoFar({
  value,
  symbol,
}: {
  value: number | undefined
  symbol: string
}): ReactElement | null {
  if (value === undefined) return null
  return <>{formatMoney(symbol, value)}</>
}

/**
 * The per-week series, which only the persisted payload carries.
 *
 * Absent entirely on the live path rather than zeroed, and
 * omitted from the handout so the chart and the ratio table still fit on one
 * page.
 */
function WeekByWeek({ view }: { view: ResultsView }): ReactElement | null {
  const withSeries = view.per_role.filter(
    (role) => role.inventory && role.backlog && role.cumulative_cost,
  )
  if (withSeries.length === 0) return null

  const weeks = Array.from({ length: view.weeks_played }, (_, index) => index)

  return (
    <section
      data-print="omit"
      aria-labelledby="results-weeks"
      className="flex flex-col gap-3"
    >
      <h2 id="results-weeks" className="text-2xl font-semibold">
        Week by week
      </h2>
      {withSeries.map((role) => (
        <details
          key={role.role}
          className="rounded-lg border border-border bg-surface-raised px-5 py-3"
        >
          <summary className="cursor-pointer font-semibold">{ROLE_LABEL[role.role]}</summary>
          <div className="overflow-x-auto">
            <table className="mt-3 w-full text-left text-sm">
              <thead>
                <tr className="bg-surface-sunken">
                  <th scope="col" className="px-3 py-2">
                    Week
                  </th>
                  <th scope="col" className="px-3 py-2">
                    On hand
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Backlog
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Cost so far
                  </th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((index) => (
                  <tr key={index} className="border-t border-border">
                    <th scope="row" className="px-3 py-2 font-normal">
                      {index + 1}
                    </th>
                    <td className="numeric px-3 py-2">{role.inventory?.[index]}</td>
                    <td className="numeric px-3 py-2">{role.backlog?.[index]}</td>
                    <td className="numeric px-3 py-2">
                      <CostSoFar value={role.cumulative_cost?.[index]} symbol={view.currency_symbol} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </section>
  )
}

/**
 * The screen the whole application exists for.
 *
 * The regions run in the order of the debrief script
 * (`beer-game-manual.md` Part 1 Step 7): what it cost, the chart, how much
 * each stage amplified, the detail, and then what to do next. That order is
 * the specification, not a layout preference.
 *
 * Nothing here is computed. Every ratio, variance, peak and total is a server
 * field, printed as it arrived (spec §9.8).
 */
export function ResultsPage(): ReactElement {
  // One route: `/results/:publicId` (D22). The page shows only what
  // `GET /games/id/{public_id}/results` answers -- never the live store, a
  // room code or anything in browser storage -- so the same link shows the
  // same game to anyone, for as long as the record exists.
  const { publicId = '' } = useParams<{ publicId: string }>()
  const fetchUrl = `/games/id/${publicId}/results`

  /**
   * The fetch result, tagged with the id it answers for. Tagging is what
   * keeps a previous game's payload from flashing up while the next one
   * loads, without resetting state from inside the effect.
   */
  const [outcome, setOutcome] = useState<FetchOutcome | null>(null)

  useEffect(() => {
    if (publicId === '') return

    let cancelled = false

    void (async () => {
      for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
        if (attempt > 0) await delay(RETRY_DELAY_MS * attempt)
        if (cancelled) return
        try {
          const response = await http.get<ResultsResponse>(fetchUrl)
          if (!cancelled) setOutcome({ code: publicId, view: resultsViewFromResponse(response.data) })
          return
        } catch (err) {
          // A 404 is retried briefly, then answered as unavailable; any
          // other failure is answered at once.
          if (!isNotFound(err)) break
        }
      }
      if (!cancelled) setOutcome({ code: publicId, view: null })
    })()

    return () => {
      cancelled = true
    }
  }, [publicId, fetchUrl])

  const current = outcome && outcome.code === publicId ? outcome : null
  const failed = publicId === '' || (current !== null && current.view === null)
  const view = current?.view ?? null
  const roomCode = view?.room_code ?? ''
  // Costs start hidden only in the tab that hosted this room (the one
  // projecting, spec §9.8). That is a presentation choice made once the
  // payload names the room; it never decides whether the results show.
  const [revealedChoice, setRevealedChoice] = useState<boolean | null>(null)
  const revealed = revealedChoice ?? !(roomCode !== '' && isHostForRoom(roomCode))

  if (!view) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        {failed ? (
          <>
            <h1 className="text-2xl font-semibold">{UNAVAILABLE}</h1>
            <p className="max-w-md text-ink-muted">
              A game&apos;s record is written when it finishes. If this one has only just
              ended, try again in a moment.
            </p>
            <Link
              to="/home"
              className="rounded-md border border-border-strong px-4 py-2 text-sm hover:border-brand hover:text-brand"
            >
              Back to your games
            </Link>
          </>
        ) : (
          <LoadingSpinner label="Loading the results" size="lg" />
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen px-6 py-10">
      <style>{PRINT_CSS}</style>
      <div className="mx-auto flex max-w-6xl flex-col gap-10">
        <header data-print="keep" className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold">Results</h1>
          <p className="text-ink-muted">
            Room <span className="numeric tracking-widest uppercase">{view.room_code}</span>
          </p>
          <SessionFacts view={view} />
        </header>

        <section
          data-print="keep"
          aria-labelledby="results-cost"
          className="flex flex-col gap-4"
        >
          <h2 id="results-cost" className="text-2xl font-semibold">
            Final cost per role and for the chain
          </h2>
          <CostSummary
            view={view}
            revealed={revealed}
            onToggle={() => setRevealedChoice(!revealed)}
          />
          <ChainCostBar view={view} revealed={revealed} />
        </section>

        <section
          data-print="keep"
          aria-labelledby="results-chart"
          className="flex flex-col gap-3"
        >
          <h2 id="results-chart" className="text-2xl font-semibold">
            True customer demand against every order stream
          </h2>
          <BullwhipChart view={view} />
        </section>

        <CumulativeCostChart view={view} revealed={revealed} />

        <section
          data-print="keep"
          aria-labelledby="results-ratios"
          className="flex flex-col gap-3"
        >
          <h2 id="results-ratios" className="text-2xl font-semibold">
            Bullwhip ratio per role
          </h2>
          <p className="text-ink-muted">
            How much each stage amplified the variation, and the per-role detail behind
            it.
          </p>
          <RoleStatsTable view={view} />
        </section>

        <NetInventoryChart view={view} />

        <WeekByWeek view={view} />

        <DebriefNotes roomCode={roomCode} />

        <section data-print="omit" aria-label="What next" className="flex flex-col gap-4">
          <ExportControls roomCode={roomCode} publicId={view.public_id} />
          <GuestClaimPrompt roomCode={roomCode} />
          <div
            data-print="omit"
            className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised px-5 py-4"
          >
            <h2 className="text-lg font-semibold">Play again</h2>
            <p className="text-sm text-ink-muted">
              You&apos;ll need to set up the game again — nothing from this room carries
              over.
            </p>
            <div>
              <Link
                to="/home"
                className="inline-block rounded-md border border-border-strong px-4 py-2 font-semibold transition hover:border-brand hover:text-brand"
              >
                Play again
              </Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const route: RouteDescriptor = {
  path: '/results/:publicId',
  guard: 'public',
  element: <ResultsPage />,
}

export default ResultsPage
