import { useMemo, type ReactElement } from 'react'
import {
  CategoryScale,
  Chart as ChartJS,
  LineElement,
  LogarithmicScale,
  PointElement,
  Tooltip,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import type { MatchSummary } from '../../api/users'
import ChartBox from '../charts/ChartBox'
import { ROLE_LABEL } from '../lobby/roleCopy'
import { buildBullwhipTrendConfig, selectTrendGames } from './bullwhipTrendConfig'

/**
 * Registered here, not borrowed from `chartSetup.ts`: that file is edited by
 * another package in the same wave, and this chart needs a logarithmic scale
 * which it does not register.
 */
ChartJS.register(CategoryScale, LogarithmicScale, PointElement, LineElement, Tooltip)

export interface BullwhipTrendProps {
  matches: readonly MatchSummary[]
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many
}

/** What was left out, each kind counted in its own words. */
function exclusionNote(noRatio: number, zeroRatio: number): string {
  const parts: string[] = []
  if (noRatio > 0) {
    parts.push(
      `${noRatio} ${plural(noRatio, 'game', 'games')} left out because demand never varied, so there is no ratio`,
    )
  }
  if (zeroRatio > 0) {
    parts.push(
      `${zeroRatio} ${plural(zeroRatio, 'game', 'games')} left out because the ratio was zero, which a log axis cannot place`,
    )
  }
  return parts.length > 0 ? `. ${parts.join('; ')}` : ''
}

/**
 * One dot per finished game on the page of history already loaded, at that
 * game's bullwhip ratio: whether a player is amplifying demand less over time.
 *
 * It makes no request. The table names date, role and ratio but never a room
 * code, because the history table's rows are found by room code and a second
 * place carrying one would confuse that.
 */
export function BullwhipTrend({ matches }: BullwhipTrendProps): ReactElement {
  const selection = useMemo(() => selectTrendGames(matches), [matches])
  const config = useMemo(() => buildBullwhipTrendConfig(matches), [matches])

  if (selection.games.length < 2) {
    return (
      <p className="text-sm text-ink-muted">
        Play at least two games with a bullwhip ratio to see a trend.
      </p>
    )
  }

  const caption = `The games on this page, oldest first${exclusionNote(selection.noRatio, selection.zeroRatio)}.`

  return (
    <ChartBox
      title="Bullwhip ratio over your games"
      headingLevel={2}
      caption={caption}
      ariaLabel="Bullwhip ratio of each game on this page, oldest first, on a logarithmic axis. The same figures are in the table."
      height={260}
      table={
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Bullwhip ratio of each game on this page</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Role</th>
              <th scope="col">Bullwhip ratio</th>
            </tr>
          </thead>
          <tbody>
            {selection.games.map((game, index) => (
              <tr key={index}>
                <td>{game.finished_at.slice(0, 10)}</td>
                <td>{ROLE_LABEL[game.role]}</td>
                <td>{game.ratio.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <Line data={config.data} options={config.options} plugins={config.plugins} />
    </ChartBox>
  )
}

export default BullwhipTrend
