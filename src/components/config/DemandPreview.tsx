import { useMemo, type ReactElement } from 'react'
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import { BRAND_SOFT_COLOUR, DEMAND_COLOUR } from '../charts/chartTheme'
import { EXAMPLE_DRAW_NOTE, PREVIEW_LOADING } from './copy'
import type { ConfigPreviewState } from './useConfigPreview'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler)

/**
 * Whether a 2D canvas context can actually be acquired.
 *
 * Chart.js draws into a canvas and observes its box; neither exists under
 * jsdom, where `getContext` yields null and `ResizeObserver` is undefined, and
 * a chart mounted there takes the whole panel down with it. The check is made
 * once and the SVG below stands in when it fails — which is also what a host
 * on a browser with canvas disabled gets, instead of a blank box.
 */
let canvasSupport: boolean | null = null

function supportsCanvas(): boolean {
  if (canvasSupport !== null) return canvasSupport
  try {
    canvasSupport =
      typeof document !== 'undefined' &&
      typeof ResizeObserver !== 'undefined' &&
      document.createElement('canvas').getContext('2d') !== null
  } catch {
    canvasSupport = false
  }
  return canvasSupport
}

/** A theme token's current value, with the token's own default as a fallback. */
function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function Sparkline({ series }: { series: number[] }): ReactElement {
  const width = 600
  const height = 180
  const top = Math.max(1, ...series)
  const step = series.length > 1 ? width / (series.length - 1) : width

  const points = series
    .map((value, index) => `${index * step},${height - (value / top) * (height - 8) - 4}`)
    .join(' ')

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Customer demand across ${series.length} weeks`}
      className="h-full w-full"
      preserveAspectRatio="none"
    >
      <polyline
        points={points}
        fill="none"
        stroke="var(--color-demand)"
        strokeWidth={3}
        strokeLinejoin="round"
      />
    </svg>
  )
}

export interface DemandPreviewProps {
  /** The server's preview of the draft (`useConfigPreview`). */
  state: ConfigPreviewState
}

/**
 * The customer demand a host is about to run, drawn for every week of the game.
 *
 * Every number on it is the server's (`POST /rooms/preview`, 2026-11-03): the
 * series is what the engine's own generator produced for the draft, so the
 * preview and the game cannot disagree, and this component does no demand
 * arithmetic at all. While the server is working it says so instead of
 * drawing anything; when the server refuses the draft it shows the server's
 * reason. For `STOCHASTIC` with no seed yet the server flags the series as an
 * example draw, and the caption says so rather than quietly showing numbers
 * nobody will see (`18 section 2`).
 *
 * The series it drew is also published as `data-series` on this element, as
 * comma-separated integers, and only once the server has answered. A canvas is
 * not assertable under jsdom, so the numbers, not the pixels, are the frozen
 * surface (`18 section 2.6`).
 */
export function DemandPreview({ state }: DemandPreviewProps): ReactElement {
  const series = state.preview?.demand_series ?? null

  const chartData = useMemo(
    () => ({
      labels: (series ?? []).map((_unused, index) => String(index + 1)),
      datasets: [
        {
          label: 'Customer demand',
          data: series ?? [],
          borderColor: cssVar('--color-demand', DEMAND_COLOUR),
          backgroundColor: cssVar('--color-brand-soft', BRAND_SOFT_COLOUR),
          borderWidth: 3,
          pointRadius: 0,
          tension: 0,
          fill: true,
        },
      ],
    }),
    [series],
  )

  let body: ReactElement
  if (state.error !== null) {
    body = (
      <p role="alert" className="text-sm text-danger">
        {state.error}
      </p>
    )
  } else if (series === null) {
    body = <p className="text-sm text-ink-muted">{PREVIEW_LOADING}</p>
  } else if (series.length === 0) {
    body = <p className="text-sm text-ink-muted">Nothing to draw yet.</p>
  } else if (supportsCanvas()) {
    body = (
      <Line
        data={chartData}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { title: { display: true, text: 'Week' } },
            y: { beginAtZero: true, title: { display: true, text: 'Units' } },
          },
        }}
      />
    )
  } else {
    body = <Sparkline series={series} />
  }

  let caption = ''
  if (state.preview !== null) {
    caption = state.preview.demand_is_example
      ? EXAMPLE_DRAW_NOTE
      : `Weeks 1 to ${state.preview.demand_series.length} of customer demand, exactly as the game will run them.`
  }

  return (
    <figure
      data-testid="demand-preview"
      data-series={series === null ? undefined : series.join(',')}
      aria-busy={state.loading || undefined}
      className="m-0 flex flex-col gap-2 rounded-lg border border-border bg-surface px-4 py-4"
    >
      <div className="h-48 w-full">{body}</div>
      {caption ? <figcaption className="text-sm text-ink-muted">{caption}</figcaption> : null}
    </figure>
  )
}

export default DemandPreview
