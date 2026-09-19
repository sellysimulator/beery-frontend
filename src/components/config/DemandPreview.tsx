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
import type { DemandConfig } from '../../types/game'
import { EXAMPLE_DRAW_NOTE } from './copy'
import { demandSeries, isExampleDraw, seriesAttribute } from './demandSeries'

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
  demand: DemandConfig
  durationWeeks: number
}

/**
 * The customer demand a host is about to run, drawn for every week of the game.
 *
 * It is computed client-side and is **display only** — the series that is
 * played is generated server-side at start. For `STOCHASTIC` the seed decides,
 * so the preview is explicitly labelled an example draw rather than quietly
 * showing numbers nobody will see (`18 section 2`).
 *
 * The series it drew is also published as `data-series` on this element, as
 * comma-separated integers. A canvas is not assertable under jsdom, and the
 * one property worth asserting about a preview is that it agrees with the game
 * that gets played — so the numbers, not the pixels, are the frozen surface
 * (`18 section 2.6`).
 */
export function DemandPreview({ demand, durationWeeks }: DemandPreviewProps): ReactElement {
  const series = useMemo(() => demandSeries(demand, durationWeeks), [demand, durationWeeks])

  const chartData = useMemo(
    () => ({
      labels: series.map((_unused, index) => String(index + 1)),
      datasets: [
        {
          label: 'Customer demand',
          data: series,
          borderColor: cssVar('--color-demand', '#3f3a30'),
          backgroundColor: cssVar('--color-brand-soft', '#fdefc9'),
          borderWidth: 3,
          pointRadius: 0,
          tension: 0,
          fill: true,
        },
      ],
    }),
    [series],
  )

  return (
    <figure
      data-testid="demand-preview"
      data-series={seriesAttribute(series)}
      className="m-0 flex flex-col gap-2 rounded-lg border border-border bg-surface px-4 py-4"
    >
      <div className="h-48 w-full">
        {series.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing to draw yet.</p>
        ) : supportsCanvas() ? (
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
        ) : (
          <Sparkline series={series} />
        )}
      </div>

      <figcaption className="text-sm text-ink-muted">
        {isExampleDraw(demand)
          ? EXAMPLE_DRAW_NOTE
          : `Weeks 1 to ${series.length} of customer demand, exactly as the game will run them.`}
      </figcaption>
    </figure>
  )
}

export default DemandPreview
