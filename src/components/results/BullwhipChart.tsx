import { useMemo, useState, type ReactElement } from 'react'
import { Line } from 'react-chartjs-2'
import {
  DEMAND_SERIES_LABEL,
  buildBullwhipConfig,
  orderSeriesDash,
  orderSeriesLabel,
  type ResultsView,
} from '../charts/chartSetup'
import { DEMAND_COLOUR, roleStyle } from '../charts/chartTheme'
import Legend, { type LegendItem } from '../charts/Legend'
import ErrorBoundary from '../shared/ErrorBoundary'
import { ROLE_ORDER, type Role } from '../../types/game'
import BullwhipRatioBars from './BullwhipRatioBars'

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
 *
 * Every series has its own switch, and each one adds or removes **that
 * series only**. This replaced a cumulative stepper whose "+ Factory" button
 * showed all four stages at once, which is not what a button named after one
 * stage reads as doing. The one control that touches every series is the
 * Show all / Clear selection toggle beside them; the debrief's "bring the
 * chain in" is Clear selection, then the switches one at a time.
 *
 * The role switched on last is drawn at full strength and the others fade,
 * so the stage just added is the one the room looks at. Show all, Clear
 * selection, or switching that role off again drops the emphasis.
 */
export function BullwhipChart({ view }: BullwhipChartProps): ReactElement {
  const [hidden, setHidden] = useState<readonly SeriesKey[]>([])
  const [newest, setNewest] = useState<Role | null>(null)

  const visible = useMemo<ResultsView>(() => {
    if (hidden.length === 0) return view
    return {
      ...view,
      demand_series: hidden.includes(DEMAND) ? [] : view.demand_series,
      per_role: view.per_role.filter((role) => !hidden.includes(role.role)),
    }
  }, [view, hidden])

  const shownRoles = ROLE_ORDER.filter((role) => !hidden.includes(role))
  // One role on its own has nothing to stand out from.
  const emphasis = newest !== null && shownRoles.length > 1 ? newest : null
  const config = buildBullwhipConfig(visible, { emphasis })

  const allKeys: readonly SeriesKey[] = [DEMAND, ...view.per_role.map((role) => role.role)]
  const allShown = allKeys.every((key) => !hidden.includes(key))
  const nothingShown = allKeys.every((key) => hidden.includes(key))

  function toggle(key: SeriesKey): void {
    const turningOn = hidden.includes(key)
    setHidden((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key],
    )
    if (key === DEMAND) return
    if (turningOn) setNewest(key)
    else if (newest === key) setNewest(null)
  }

  function toggleAll(): void {
    setNewest(null)
    setHidden(allShown ? allKeys : [])
  }

  const legendItems: LegendItem[] = [
    {
      key: DEMAND,
      label: DEMAND_SERIES_LABEL,
      swatch: { kind: 'line', color: DEMAND_COLOUR, width: 4 },
    },
    ...view.per_role.map((role) => ({
      key: role.role,
      label: orderSeriesLabel(role.role),
      swatch: {
        kind: 'line' as const,
        color: roleStyle(role.role).colour,
        dash: orderSeriesDash(role.role),
      },
    })),
  ]

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Legend
          items={legendItems}
          hidden={new Set<string>(hidden)}
          onToggle={(key) => toggle(key as SeriesKey)}
          ariaLabel="Choose the series to show"
        />
        <button
          type="button"
          data-print="omit"
          onClick={toggleAll}
          className="rounded-md border border-brand px-3 py-1.5 text-sm font-semibold text-brand-strong transition hover:bg-brand-soft"
        >
          {allShown ? 'Clear selection' : 'Show all'}
        </button>
      </div>

      {nothingShown ? (
        <p role="status" className="text-sm text-ink-muted">
          Nothing is selected. Switch a series on to draw it.
        </p>
      ) : null}

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
        To bring the chain in one stage at a time, clear the selection, then switch
        on customer demand and each stage in turn — Retailer first, then upstream.
      </p>

      <WeekTable view={visible} />

      <div data-print="omit">
        <BullwhipRatioBars view={view} shown={shownRoles} />
      </div>
    </div>
  )
}

export default BullwhipChart
