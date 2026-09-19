import { useMemo, useState, type ReactElement } from 'react'
import { Line } from 'react-chartjs-2'
import {
  DEMAND_SERIES_LABEL,
  buildBullwhipConfig,
  orderSeriesLabel,
  type ResultsView,
} from '../charts/chartSetup'
import { ROLE_LABEL } from '../lobby/roleCopy'
import ErrorBoundary from '../shared/ErrorBoundary'
import type { Role } from '../../types/game'

export interface BullwhipChartProps {
  view: ResultsView
}

/** The demand series' key in the toggle set; the other four are roles. */
const DEMAND = 'DEMAND'

type SeriesKey = Role | typeof DEMAND

/**
 * The same five series, read out as a table (section 2.2a).
 *
 * Visually hidden, and the only place the plotted numbers exist as text: a
 * canvas is opaque to a screen reader and to a test alike. It shows the
 * series the chart is currently drawing, so switching one off in the legend
 * takes it out of both.
 */
function WeekTable({ view }: { view: ResultsView }): ReactElement {
  const weeks = Array.from({ length: view.weeks_played }, (_, index) => index)
  const showDemand = view.demand_series.length > 0

  return (
    <table className="sr-only">
      <caption>True customer demand and every role&apos;s orders, week by week</caption>
      <thead>
        <tr>
          <th scope="col">Week</th>
          {showDemand ? <th scope="col">{DEMAND_SERIES_LABEL}</th> : null}
          {view.per_role.map((role) => (
            <th key={role.role} scope="col">
              {orderSeriesLabel(role.role)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((index) => (
          <tr key={index}>
            <th scope="row">{index + 1}</th>
            {showDemand ? <td>{view.demand_series[index]}</td> : null}
            {view.per_role.map((role) => (
              <td key={role.role}>{role.orders[index]}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * The reveal (section 2.2, `[THE POINT]`).
 *
 * True customer demand barely moves; the four order streams look like an
 * earthquake. That contrast is the lesson, so the five series share one Y
 * axis that starts at zero, and demand is drawn on top.
 *
 * The configuration is `buildBullwhipConfig(...)` and nothing else — this
 * component passes it straight through and adds nothing to it (section
 * 2.2a). Switching a series off in the legend takes it out of the **view**
 * the builder is handed, rather than editing the configuration the builder
 * returned, which is what keeps that pass-through honest.
 *
 * The legend is real DOM rather than the canvas legend Chart.js paints,
 * because bringing the chain in one stage at a time is the single most
 * useful control in the debrief and it has to work with a keyboard, with a
 * screen reader, and on a machine where the canvas never got a context.
 */
export function BullwhipChart({ view }: BullwhipChartProps): ReactElement {
  const [hidden, setHidden] = useState<readonly SeriesKey[]>([])

  const visible = useMemo<ResultsView>(() => {
    if (hidden.length === 0) return view
    return {
      ...view,
      demand_series: hidden.includes(DEMAND) ? [] : view.demand_series,
      per_role: view.per_role.filter((role) => !hidden.includes(role.role)),
    }
  }, [view, hidden])

  const config = buildBullwhipConfig(visible)

  function toggle(key: SeriesKey): void {
    setHidden((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key],
    )
  }

  function legendButton(key: SeriesKey, label: string, swatch: string): ReactElement {
    const shown = !hidden.includes(key)
    return (
      <button
        key={key}
        type="button"
        role="switch"
        aria-checked={shown}
        data-series={key}
        onClick={() => toggle(key)}
        className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-semibold transition ${
          shown
            ? 'border-border-strong bg-surface-raised text-ink'
            : 'border-border bg-surface-sunken text-ink-subtle line-through'
        }`}
      >
        <span aria-hidden="true" className={`h-1 w-6 rounded-full ${swatch}`} />
        {label}
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        data-print="omit"
        role="group"
        aria-label="Show or hide a series"
        className="flex flex-wrap items-center gap-2"
      >
        {legendButton(DEMAND, DEMAND_SERIES_LABEL, 'bg-ink')}
        {view.per_role.map((role) =>
          legendButton(role.role, `${ROLE_LABEL[role.role]} orders`, SWATCH[role.role]),
        )}
      </div>

      <ErrorBoundary
        fallback={
          <p className="text-sm text-ink-muted">
            The chart could not be drawn here. The same week-by-week figures are in the
            table that follows it.
          </p>
        }
      >
        <div className="h-[28rem]">
          <Line data={config.data} options={config.options} />
        </div>
      </ErrorBoundary>

      <p className="text-sm text-ink-muted">
        Switch a series off to bring the chain in one stage at a time — Retailer first,
        then upstream.
      </p>

      <WeekTable view={visible} />
    </div>
  )
}

/** The legend swatches, in the role hues from `src/index.css`. */
const SWATCH: Record<Role, string> = {
  RETAILER: 'bg-role-retailer',
  WHOLESALER: 'bg-role-wholesaler',
  DISTRIBUTOR: 'bg-role-distributor',
  FACTORY: 'bg-role-factory',
}

export default BullwhipChart
