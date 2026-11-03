/**
 * Pure builders for the player's history panels (`beer-game-spec.md` §9.3).
 *
 * Every plotted value is a `WeekRecord` field the server sent for this player.
 * Nothing is added up: the supply line is its own dataset drawn on top of
 * on hand by Chart.js's stacking, so the stack's top edge is geometry, not a
 * figure this file computed. The one transformation is the backlog's sign,
 * which puts it below the axis; its tooltip prints the server's number.
 */
import type { ChartConfiguration, ChartOptions, TooltipItem } from 'chart.js'
import type { WeekRecord } from '../../types/game'
import { AXIS_COLOUR, GRID_COLOUR, QUANTITY_COLOUR, withAlpha } from '../charts/chartTheme'
import { CROSSHAIR_SYNC_ID } from '../charts/plugins/crosshairSync'

export const ON_HAND_LABEL = 'On hand'
export const BACKLOG_LABEL = 'Backlog (owed)'
export const ON_THE_WAY_LABEL = 'On the way'
export const RECEIVED_LABEL = 'Orders you received'
export const PLACED_LABEL = 'Orders you placed'

/** Everything the two panels share: axes, index-mode hover, the DOM legend instead of the canvas one. */
function baseOptions(
  group: string | null,
  stacked: boolean,
  label: (item: TooltipItem<'line'>) => string,
): ChartOptions<'line'> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      // The legend is DOM (`charts/Legend.tsx`), so the canvas draws none.
      legend: { display: false },
      tooltip: { callbacks: { label } },
      // Absent, not `{ group: null }`: the plugin acts only on a chart that names a group.
      ...(group === null ? {} : { [CROSSHAIR_SYNC_ID]: { group } }),
    },
    scales: {
      x: {
        title: { display: true, text: 'Week', color: AXIS_COLOUR },
        ticks: { color: AXIS_COLOUR },
        grid: { color: GRID_COLOUR },
      },
      y: {
        stacked,
        title: { display: true, text: 'Units', color: AXIS_COLOUR },
        ticks: { color: AXIS_COLOUR },
        grid: { color: GRID_COLOUR },
      },
    },
  }
}

/** The server's own figure for the hovered week and series, never the plotted (stacked or flipped) one. */
function serverFigure(history: WeekRecord[], label: string, index: number): number | undefined {
  const record = history[index]
  if (!record) return undefined
  switch (label) {
    case ON_HAND_LABEL:
      return record.closing_inventory
    case BACKLOG_LABEL:
      return record.closing_backlog
    case ON_THE_WAY_LABEL:
      return record.supply_line_after
    case RECEIVED_LABEL:
      return record.incoming_order
    case PLACED_LABEL:
      return record.order
    default:
      return undefined
  }
}

function tooltipLabel(history: WeekRecord[]): (item: TooltipItem<'line'>) => string {
  return (item) => {
    const label = item.dataset.label ?? ''
    const figure = serverFigure(history, label, item.dataIndex)
    return `${label}: ${figure ?? item.formattedValue}`
  }
}

const weekLabels = (history: WeekRecord[]): string[] => history.map((record) => String(record.week))

/**
 * Top panel: on hand with the supply line stacked on it, and the backlog
 * below zero. Inventory position is on hand plus on the way minus backlog,
 * which the reader sees as the gap down to the backlog area; nothing here
 * claims the sum.
 */
export function buildOwnStockConfig(
  history: WeekRecord[],
  group: string | null,
): ChartConfiguration<'line'> {
  return {
    type: 'line',
    data: {
      labels: weekLabels(history),
      datasets: [
        {
          label: ON_HAND_LABEL,
          data: history.map((record) => record.closing_inventory),
          borderColor: QUANTITY_COLOUR.inventory,
          backgroundColor: withAlpha(QUANTITY_COLOUR.inventory, 0.35),
          fill: 'origin',
          stack: 'stock',
          tension: 0.2,
        },
        {
          label: ON_THE_WAY_LABEL,
          data: history.map((record) => record.supply_line_after),
          borderColor: QUANTITY_COLOUR.supplyLine,
          backgroundColor: withAlpha(QUANTITY_COLOUR.supplyLine, 0.3),
          borderDash: [2, 3],
          // Fills down to the dataset below it (on hand), so the band is the supply line alone.
          fill: '-1',
          stack: 'stock',
          tension: 0.2,
        },
        {
          label: BACKLOG_LABEL,
          // Below the axis: the sign is the geometry; the tooltip prints the server's figure.
          data: history.map((record) => -record.closing_backlog),
          borderColor: QUANTITY_COLOUR.backlog,
          backgroundColor: withAlpha(QUANTITY_COLOUR.backlog, 0.35),
          borderDash: [6, 3],
          fill: 'origin',
          stack: 'owed',
          tension: 0.2,
        },
      ],
    },
    options: baseOptions(group, true, tooltipLabel(history)),
  }
}

/** Bottom panel: what the player was asked for against what they asked for, on one units axis. */
export function buildOwnOrdersConfig(
  history: WeekRecord[],
  group: string | null,
): ChartConfiguration<'line'> {
  return {
    type: 'line',
    data: {
      labels: weekLabels(history),
      datasets: [
        {
          label: RECEIVED_LABEL,
          data: history.map((record) => record.incoming_order),
          borderColor: QUANTITY_COLOUR.inventory,
          backgroundColor: QUANTITY_COLOUR.inventory,
          borderDash: [6, 3],
          tension: 0.2,
        },
        {
          label: PLACED_LABEL,
          data: history.map((record) => record.order),
          borderColor: QUANTITY_COLOUR.order,
          backgroundColor: QUANTITY_COLOUR.order,
          tension: 0.2,
        },
      ],
    },
    options: baseOptions(group, false, tooltipLabel(history)),
  }
}
