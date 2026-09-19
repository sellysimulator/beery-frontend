import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { Link, useParams } from 'react-router-dom'
import http from '../api/http'
import BullwhipChart from '../components/results/BullwhipChart'
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
  type RoleResultView,
} from '../components/charts/chartSetup'
import { ROLE_LABEL } from '../components/lobby/roleCopy'
import LoadingSpinner from '../components/shared/LoadingSpinner'
import { useGameStore } from '../store/gameStore'
import { ROLE_ORDER, type GameFinishedPayload, type Participant } from '../types/game'
import { isHostForRoom } from '../utils/storage'
import type { RouteDescriptor } from '../routes/registry'

/* ─── Normalisation: two sources, one view model (section 2.0, FROZEN) ─── */

/**
 * The live path — `game_finished` plus the store, available the instant the
 * game ends and before persistence has necessarily completed.
 *
 * The three per-week series and the four session facts are **absent** here,
 * and they stay absent: a zero, a dash or a re-derivation from `orders` would
 * each be a client-computed figure the server never sent (sections 2.0, 3.2).
 */
function viewFromFinished(
  roomCode: string,
  finished: GameFinishedPayload,
  participants: Participant[],
  currencySymbol: string,
): ResultsView {
  const perRole: RoleResultView[] = ROLE_ORDER.flatMap((role) => {
    const stats = finished.stats.per_role[role]
    if (!stats) return []
    const participant = participants.find((candidate) => candidate.role === role)
    return [
      {
        role,
        display_name: participant?.display_name ?? '',
        is_bot: participant?.is_bot ?? false,
        total_cost: stats.total_cost,
        peak_inventory: stats.peak_inventory,
        peak_backlog: stats.peak_backlog,
        weeks_in_backlog: stats.weeks_in_backlog,
        order_variance: stats.order_variance,
        bullwhip_ratio: stats.bullwhip_ratio,
        fill_rate: stats.fill_rate,
        average_order: stats.average_order,
        // `inventory`, `backlog` and `cumulative_cost` are simply not here.
        orders: finished.orders_by_role[role] ?? [],
      },
    ]
  })

  return {
    room_code: roomCode,
    weeks_played: finished.weeks_played,
    demand_series: finished.demand_series,
    chain_total_cost: finished.stats.chain_total_cost,
    demand_variance: finished.stats.demand_variance,
    currency_symbol: currencySymbol,
    per_role: perRole,
    // The session facts are the second block the live path does not have.
  }
}

/* ─── Fetching (section 3.1) ─── */

/** Short, because three attempts happen while somebody watches a blank panel. */
const RETRY_DELAY_MS = 150
const RETRIES = 2
const UNAVAILABLE = "Results aren't available yet."

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** A fetch result, tagged with the room code it answers for. */
interface FetchOutcome {
  code: string
  /** `null` when every attempt failed. */
  view: ResultsView | null
}

function isNotFound(err: unknown): boolean {
  const response = (err as { response?: { status?: unknown } } | null | undefined)?.response
  return response?.status === 404
}

/* ─── Print (section 3.3, FROZEN) ─── */

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
 * Absent entirely on the live path rather than zeroed (section 2.0), and
 * omitted from the handout so the chart and the ratio table still fit on one
 * page (section 3.3).
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
 * field, printed as it arrived (section 3.2).
 */
export function ResultsPage(): ReactElement {
  const { roomCode = '' } = useParams<{ roomCode: string }>()

  const finished = useGameStore((state) => state.finished)
  const storeRoomCode = useGameStore((state) => state.roomCode)
  const participants = useGameStore((state) => state.participants)
  const myState = useGameStore((state) => state.myState)
  const hostState = useGameStore((state) => state.hostState)

  /**
   * The live view, and only when the store's payload belongs to the room in
   * the URL — a finished game left in the store is not an answer for a
   * different room code.
   */
  const liveView = useMemo<ResultsView | null>(() => {
    if (!finished || storeRoomCode !== roomCode || roomCode === '') return null
    const currency =
      myState?.currency_symbol ?? hostState?.currency_symbol ?? '$'
    return viewFromFinished(roomCode, finished, participants, currency)
  }, [finished, storeRoomCode, roomCode, participants, myState, hostState])

  /**
   * The fetch result, tagged with the room it answers for. Tagging is what
   * keeps a previous room's payload from flashing up while the next one
   * loads, without resetting state from inside the effect.
   */
  const [outcome, setOutcome] = useState<FetchOutcome | null>(null)

  useEffect(() => {
    // The store already holds this room's finished payload: no fetch (§3.1).
    if (liveView || roomCode === '') return

    let cancelled = false

    void (async () => {
      for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
        if (attempt > 0) await delay(RETRY_DELAY_MS * attempt)
        if (cancelled) return
        try {
          const response = await http.get<ResultsResponse>(`/games/${roomCode}/results`)
          if (!cancelled) setOutcome({ code: roomCode, view: resultsViewFromResponse(response.data) })
          return
        } catch (err) {
          // Persistence is non-blocking (`12 §3.8`), so a 404 right after the
          // game ends means "not written yet", not "no such game".
          if (!isNotFound(err)) break
        }
      }
      if (!cancelled) setOutcome({ code: roomCode, view: null })
    })()

    return () => {
      cancelled = true
    }
  }, [liveView, roomCode])

  const current = outcome && outcome.code === roomCode ? outcome : null
  const failed = current !== null && current.view === null
  const view = liveView ?? current?.view ?? null
  const [revealed, setRevealed] = useState(() => !isHostForRoom(roomCode))

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
            onToggle={() => setRevealed((current) => !current)}
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

        <WeekByWeek view={view} />

        <DebriefNotes roomCode={roomCode} />

        <section data-print="omit" aria-label="What next" className="flex flex-col gap-4">
          <ExportControls roomCode={roomCode} />
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
  path: '/results/:roomCode',
  guard: 'public',
  element: <ResultsPage />,
}

export default ResultsPage
