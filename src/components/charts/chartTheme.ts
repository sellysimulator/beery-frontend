/**
 * Every colour a Chart.js canvas is painted with, in one place.
 *
 * A CSS custom property is never resolved on a canvas, so the hues the rest of
 * the screen takes from `src/index.css` have to be written out as literals for
 * the charts. They used to be copied into each chart file and kept in step by
 * hand; they now live here once, keyed by the `--color-*` token each mirrors,
 * and `chartTheme.test.ts` fails the suite when a literal stops matching its
 * token.
 */
import type { Role } from '../../types/game'

/** Every canvas colour literal, keyed by the `--color-*` token in src/index.css it mirrors. */
export const CHART_TOKENS = {
  '--color-demand': '#3f3a30',
  '--color-ink-muted': '#5c5547',
  '--color-border': '#e2dac8',
  '--color-brand': '#c98a00',
  '--color-brand-soft': '#fdefc9',
  '--color-role-retailer': '#1f6f9c',
  '--color-role-wholesaler': '#04705a',
  '--color-role-distributor': '#9c4f78',
  '--color-role-factory': '#a8480a',
  '--color-inventory': '#1f6f9c',
  '--color-inventory-soft': '#d6ecf8',
  '--color-backlog': '#a8420a',
  '--color-backlog-soft': '#fbdfd0',
  '--color-supply-line': '#8a6d00',
  '--color-supply-line-soft': '#f7eeb8',
  '--color-order': '#c98a00',
} as const

/* Named views. Each is read from CHART_TOKENS, never a second literal. */
export const DEMAND_COLOUR: string = CHART_TOKENS['--color-demand']
export const AXIS_COLOUR: string = CHART_TOKENS['--color-ink-muted']
export const GRID_COLOUR: string = CHART_TOKENS['--color-border']
export const CURRENT_WEEK_COLOUR: string = CHART_TOKENS['--color-brand']
/** `DemandPreview`'s fill fallback. */
export const BRAND_SOFT_COLOUR: string = CHART_TOKENS['--color-brand-soft']

export const QUANTITY_COLOUR = {
  inventory: CHART_TOKENS['--color-inventory'],
  inventorySoft: CHART_TOKENS['--color-inventory-soft'],
  backlog: CHART_TOKENS['--color-backlog'],
  backlogSoft: CHART_TOKENS['--color-backlog-soft'],
  supplyLine: CHART_TOKENS['--color-supply-line'],
  supplyLineSoft: CHART_TOKENS['--color-supply-line-soft'],
  order: CHART_TOKENS['--color-order'],
} as const

export interface RoleStyle {
  colour: string
  dash: number[]
  point: 'triangle' | 'rect' | 'rectRot' | 'star'
}

/**
 * Colour is never the only channel: each role also carries its own dash and
 * its own point style, so a chart survives a projector, a photocopy and
 * colour-blindness. These are the bullwhip chart's values, moved unchanged.
 */
const ROLE_STYLE: Record<Role, RoleStyle> = {
  RETAILER: { colour: CHART_TOKENS['--color-role-retailer'], dash: [6, 3], point: 'triangle' },
  WHOLESALER: { colour: CHART_TOKENS['--color-role-wholesaler'], dash: [14, 4], point: 'rect' },
  DISTRIBUTOR: { colour: CHART_TOKENS['--color-role-distributor'], dash: [2, 3], point: 'rectRot' },
  FACTORY: { colour: CHART_TOKENS['--color-role-factory'], dash: [10, 3, 2, 3], point: 'star' },
}

/** One style per role on every chart. */
export function roleStyle(role: Role): RoleStyle {
  const style = ROLE_STYLE[role]
  return { colour: style.colour, dash: [...style.dash], point: style.point }
}

/** `#rrggbb` + alpha in [0, 1] -> `rgba(r, g, b, a)`. For faded/emphasis styling only, never for a plotted value. */
export function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '')
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
