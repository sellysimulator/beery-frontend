import type { ReactElement } from 'react'
import { Line } from 'react-chartjs-2'
import ErrorBoundary from '../shared/ErrorBoundary'
import { DEMAND_CURVE_LABEL, buildDemandCurveConfig } from './demandCurveConfig'

export interface DemandCurveProps {
  /** `host_state.demand_series` — the FULL series, future weeks included. */
  demandSeries: number[]
  /** 1-indexed, as every week is. */
  currentWeek: number
  /** Projector styling: larger type, thicker rules (§2.4, §3.5). */
  presenting?: boolean
}

/** The word a row of the hidden table carries when it is the open week. */
const CURRENT_WEEK_CELL = 'Current week'

/**
 * The same series, read out as a table (§2.1a).
 *
 * Visually hidden, and the only place the plotted numbers exist as text: a
 * canvas is opaque to a screen reader and to a test alike. One row per week of
 * the **full** series, with the week number, the demand value and whether that
 * week is the current one.
 */
function DemandTable({
  demandSeries,
  currentWeek,
}: {
  demandSeries: number[]
  currentWeek: number
}): ReactElement {
  return (
    <table className="sr-only">
      <caption>
        True customer demand for every week of the game, including the weeks not yet
        played
      </caption>
      <thead>
        <tr>
          <th scope="col">Week</th>
          <th scope="col">{DEMAND_CURVE_LABEL}</th>
          <th scope="col">Now</th>
        </tr>
      </thead>
      <tbody>
        {demandSeries.map((value, index) => {
          const week = index + 1
          const current = week === currentWeek
          return (
            <tr key={week} data-week={week} data-current={current ? 'true' : 'false'}>
              <th scope="row">{week}</th>
              <td>{value}</td>
              <td>{current ? CURRENT_WEEK_CELL : ''}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/**
 * True customer demand across the whole game, with the current week marked
 * (§2.1).
 *
 * The host is the only person who gets the future of this series, which is why
 * `host_state` is never broadcast to a room — and it is the host's cue for when
 * the step is about to land, which is the difference between running a session
 * and watching one.
 *
 * The configuration is `buildDemandCurveConfig(...)` and nothing else: this
 * component passes it straight through and adds nothing to it (§2.1a). The
 * canvas is wrapped in an error boundary because a chart that cannot get a
 * drawing context must not take the console down with it; the same figures are
 * in the table either way.
 */
export function DemandCurve({
  demandSeries,
  currentWeek,
  presenting = false,
}: DemandCurveProps): ReactElement {
  const config = buildDemandCurveConfig(demandSeries, currentWeek)

  return (
    <section
      aria-label="Customer demand"
      data-field="demand_series"
      className={
        presenting
          ? 'flex flex-col gap-3'
          : 'flex flex-col gap-2 rounded-lg border border-border bg-surface-raised px-5 py-4'
      }
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={presenting ? 'text-[2rem] font-bold' : 'text-xl font-semibold'}>
          Customer demand
        </h2>
        {presenting ? null : (
          <p className="text-sm text-ink-muted">
            The whole series, including the weeks still to come. Only you can see this.
          </p>
        )}
      </div>

      {demandSeries.length === 0 ? (
        <p className={presenting ? 'text-[2rem]' : 'text-ink-muted'}>
          The server has not sent a demand series for this room yet.
        </p>
      ) : (
        <ErrorBoundary
          fallback={
            <p className="text-sm text-ink-muted">
              The chart could not be drawn here. The same week-by-week figures are in the
              table that follows it.
            </p>
          }
        >
          <div className={presenting ? 'h-[32vh] w-full' : 'h-56'}>
            <Line data={config.data} options={config.options} />
          </div>
        </ErrorBoundary>
      )}

      <DemandTable demandSeries={demandSeries} currentWeek={currentWeek} />
    </section>
  )
}

export default DemandCurve
