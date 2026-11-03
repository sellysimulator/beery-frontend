/**
 * The profile trend's one pure builder.
 *
 * Like `buildBullwhipConfig`, it returns exactly what the component renders,
 * so the order of the dots and the role each belongs to can be asserted on an
 * object instead of on a canvas jsdom cannot draw. It lives in a `.ts` file
 * because a `.tsx` exporting a non-component trips
 * `react-refresh/only-export-components`.
 */
import type { ChartConfiguration, ChartDataset, Plugin } from 'chart.js'
import type { MatchSummary } from '../../api/users'
import { ROLE_ORDER, type Role } from '../../types/game'
import { AXIS_COLOUR, GRID_COLOUR, roleStyle } from '../charts/chartTheme'
import { ROLE_LABEL } from '../lobby/roleCopy'

/** A game with a ratio a log axis can place. */
export interface TrendGame {
  finished_at: string
  role: Role
  /** Always a positive number. */
  ratio: number
}

export interface BullwhipTrendSelection {
  /** Oldest first. */
  games: TrendGame[]
  /** `bullwhip_ratio` was `null`: demand did not vary (**D12**). */
  noRatio: number
  /** `bullwhip_ratio` was `0`, which no logarithmic axis can place. */
  zeroRatio: number
}

/**
 * The games that can be drawn, oldest first.
 *
 * The list arrives newest first, so the order is taken from `finished_at`
 * rather than from the array. Dates are compared as instants, not strings, so
 * a differing UTC offset cannot reorder them. The sort is stable, so two games
 * finished at the same instant keep their list order.
 */
export function selectTrendGames(matches: readonly MatchSummary[]): BullwhipTrendSelection {
  const games: TrendGame[] = []
  let noRatio = 0
  let zeroRatio = 0
  for (const match of matches) {
    const ratio = match.bullwhip_ratio
    if (ratio === null) noRatio += 1
    else if (ratio === 0) zeroRatio += 1
    else if (ratio > 0) games.push({ finished_at: match.finished_at, role: match.role, ratio })
  }
  games.sort((a, b) => Date.parse(a.finished_at) - Date.parse(b.finished_at))
  return { games, noRatio, zeroRatio }
}

/** The 1x line: no amplification at all, the level the dots are read against. */
const unityRule: Plugin<'line'> = {
  id: 'bullwhipUnityRule',
  afterDatasetsDraw(chart) {
    const y = chart.scales.y
    const { left, right } = chart.chartArea
    if (!y || 1 < y.min || 1 > y.max) return
    const pixel = y.getPixelForValue(1)
    const { ctx } = chart
    ctx.save()
    ctx.strokeStyle = AXIS_COLOUR
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(left, pixel)
    ctx.lineTo(right, pixel)
    ctx.stroke()
    ctx.restore()
  },
}

export function buildBullwhipTrendConfig(
  matches: readonly MatchSummary[],
): ChartConfiguration<'line'> {
  const { games } = selectTrendGames(matches)

  const datasets: ChartDataset<'line', (number | null)[]>[] = ROLE_ORDER.filter((role) =>
    games.some((game) => game.role === role),
  ).map((role) => {
    const style = roleStyle(role)
    return {
      label: ROLE_LABEL[role],
      // Index i belongs to game i. Every other role's games are null, which
      // Chart.js skips; a 0 or a 1 here would be a dot nobody played.
      data: games.map((game) => (game.role === role ? game.ratio : null)),
      showLine: false,
      borderColor: style.colour,
      backgroundColor: style.colour,
      pointStyle: style.point,
      pointRadius: 6,
      pointHoverRadius: 8,
    }
  })

  return {
    type: 'line',
    data: { labels: games.map((game) => game.finished_at), datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      scales: {
        x: { ticks: { color: AXIS_COLOUR }, grid: { color: GRID_COLOUR } },
        y: {
          type: 'logarithmic',
          ticks: { color: AXIS_COLOUR, callback: (value) => `${value}×` },
          grid: { color: GRID_COLOUR },
        },
      },
      plugins: { legend: { display: false } },
    },
    plugins: [unityRule],
  }
}
