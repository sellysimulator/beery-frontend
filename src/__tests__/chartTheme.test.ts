/**
 * BE-1 (`CHARTS-PLAN.md`), the theme half of the chart kit.
 *
 * Covers acceptance (1) no palette literal outside `chartTheme.ts`, acceptance
 * (2) the drift test that fails when one token changes, and the failure mode
 * "a literal drifting from its token".
 *
 * Chart.js is never mocked (`21 §2.2a`); nothing here needs a canvas.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import {
  AXIS_COLOUR,
  BRAND_SOFT_COLOUR,
  CHART_TOKENS,
  CURRENT_WEEK_COLOUR,
  DEMAND_COLOUR,
  GRID_COLOUR,
  QUANTITY_COLOUR,
  roleStyle,
  withAlpha,
} from '../components/charts/chartTheme'
import { buildBullwhipConfig, orderSeriesDash, type ResultsView } from '../components/charts/chartSetup'
import { ROLE_ORDER } from '../types/game'

function projectRoot(): string {
  let dir = process.cwd()
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'src'))) return dir
    dir = dirname(dir)
  }
  throw new Error('could not find the Beery_Frontend directory')
}

const ROOT = projectRoot()
const INDEX_CSS = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8')

/** `--color-x: #rrggbb;` declarations in a stylesheet, token -> value. */
function cssTokens(css: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const match of css.matchAll(/(--color-[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    if (!found.has(match[1])) found.set(match[1], match[2].toLowerCase())
  }
  return found
}

/** The tokens whose literal in `CHART_TOKENS` no longer equals the stylesheet's. */
function drifted(css: string): string[] {
  const tokens = cssTokens(css)
  return Object.entries(CHART_TOKENS)
    .filter(([token, literal]) => tokens.get(token) !== literal.toLowerCase())
    .map(([token]) => token)
}

describe('ACCEPTANCE 2 and FAILURE MODE: a literal drifting from its token', () => {
  it('has every CHART_TOKENS literal equal to its --color-* token in index.css', () => {
    expect(drifted(INDEX_CSS)).toEqual([])
  })

  it('names exactly the sixteen tokens of the public surface', () => {
    expect(Object.keys(CHART_TOKENS).sort()).toEqual(
      [
        '--color-demand',
        '--color-ink-muted',
        '--color-border',
        '--color-brand',
        '--color-brand-soft',
        '--color-role-retailer',
        '--color-role-wholesaler',
        '--color-role-distributor',
        '--color-role-factory',
        '--color-inventory',
        '--color-inventory-soft',
        '--color-backlog',
        '--color-backlog-soft',
        '--color-supply-line',
        '--color-supply-line-soft',
        '--color-order',
      ].sort(),
    )
  })

  it('holds a #rrggbb literal for every token', () => {
    for (const literal of Object.values(CHART_TOKENS)) expect(literal).toMatch(/^#[0-9a-fA-F]{6}$/)
  })

  it('fails when any single token in the stylesheet changes', () => {
    for (const token of Object.keys(CHART_TOKENS)) {
      const current = cssTokens(INDEX_CSS).get(token)
      expect(current, `${token} is declared in index.css`).toBeDefined()
      const edited = INDEX_CSS.replace(
        new RegExp(`(${token}\\s*:\\s*)#[0-9a-fA-F]{6}`),
        '$1#010203',
      )
      expect(edited).not.toBe(INDEX_CSS)
      expect(drifted(edited)).toContain(token)
    }
  })

  it('fails when a token is missing from the stylesheet', () => {
    const edited = INDEX_CSS.replace(/--color-order\s*:/, '--color-orderx:')
    expect(drifted(edited)).toContain('--color-order')
  })
})

describe('the named views are read from CHART_TOKENS', () => {
  it('maps each named colour to its token', () => {
    expect(DEMAND_COLOUR).toBe(CHART_TOKENS['--color-demand'])
    expect(AXIS_COLOUR).toBe(CHART_TOKENS['--color-ink-muted'])
    expect(GRID_COLOUR).toBe(CHART_TOKENS['--color-border'])
    expect(CURRENT_WEEK_COLOUR).toBe(CHART_TOKENS['--color-brand'])
    expect(BRAND_SOFT_COLOUR).toBe(CHART_TOKENS['--color-brand-soft'])
  })

  it('maps QUANTITY_COLOUR to the quantity tokens', () => {
    expect(QUANTITY_COLOUR).toEqual({
      inventory: CHART_TOKENS['--color-inventory'],
      inventorySoft: CHART_TOKENS['--color-inventory-soft'],
      backlog: CHART_TOKENS['--color-backlog'],
      backlogSoft: CHART_TOKENS['--color-backlog-soft'],
      supplyLine: CHART_TOKENS['--color-supply-line'],
      supplyLineSoft: CHART_TOKENS['--color-supply-line-soft'],
      order: CHART_TOKENS['--color-order'],
    })
  })

  it('keeps the values the three files carried before the move', () => {
    expect(DEMAND_COLOUR).toBe('#3f3a30')
    expect(AXIS_COLOUR).toBe('#5c5547')
    expect(GRID_COLOUR).toBe('#e2dac8')
    expect(CURRENT_WEEK_COLOUR).toBe('#c98a00')
    expect(BRAND_SOFT_COLOUR).toBe('#fdefc9')
  })
})

describe('roleStyle', () => {
  it('keeps the bullwhip chart’s colour, dash and point for every role, unchanged', () => {
    expect(roleStyle('RETAILER')).toEqual({ colour: '#1f6f9c', dash: [6, 3], point: 'triangle' })
    expect(roleStyle('WHOLESALER')).toEqual({ colour: '#04705a', dash: [14, 4], point: 'rect' })
    expect(roleStyle('DISTRIBUTOR')).toEqual({ colour: '#9c4f78', dash: [2, 3], point: 'rectRot' })
    expect(roleStyle('FACTORY')).toEqual({ colour: '#a8480a', dash: [10, 3, 2, 3], point: 'star' })
  })

  it('reads each role colour from its --color-role-* token', () => {
    expect(roleStyle('RETAILER').colour).toBe(CHART_TOKENS['--color-role-retailer'])
    expect(roleStyle('WHOLESALER').colour).toBe(CHART_TOKENS['--color-role-wholesaler'])
    expect(roleStyle('DISTRIBUTOR').colour).toBe(CHART_TOKENS['--color-role-distributor'])
    expect(roleStyle('FACTORY').colour).toBe(CHART_TOKENS['--color-role-factory'])
  })

  it('tells the four roles apart by colour, dash and point', () => {
    const styles = ROLE_ORDER.map((role) => roleStyle(role))
    expect(new Set(styles.map((s) => s.colour)).size).toBe(4)
    expect(new Set(styles.map((s) => s.dash.join(' '))).size).toBe(4)
    expect(new Set(styles.map((s) => s.point)).size).toBe(4)
  })
})

describe('withAlpha', () => {
  it('turns #rrggbb and an alpha into rgba(r, g, b, a)', () => {
    expect(withAlpha('#1f6f9c', 0.5)).toBe('rgba(31, 111, 156, 0.5)')
    expect(withAlpha('#ffffff', 1)).toBe('rgba(255, 255, 255, 1)')
    expect(withAlpha('#000000', 0)).toBe('rgba(0, 0, 0, 0)')
    expect(withAlpha('#c98a00', 0.25)).toBe('rgba(201, 138, 0, 0.25)')
  })
})

describe('the chart setup reads the theme', () => {
  const view: ResultsView = {
    room_code: 'ABCD',
    weeks_played: 3,
    demand_series: [4, 4, 8],
    chain_total_cost: 0,
    demand_variance: 0,
    currency_symbol: '$',
    per_role: ROLE_ORDER.map((role) => ({
      role,
      display_name: role,
      is_bot: false,
      total_cost: 0,
      peak_inventory: 0,
      peak_backlog: 0,
      weeks_in_backlog: 0,
      order_variance: 0,
      bullwhip_ratio: 1,
      fill_rate: 1,
      average_order: 4,
      orders: [4, 5, 6],
    })),
  }

  it('draws each order line in roleStyle’s colour and dash, and demand in DEMAND_COLOUR', () => {
    const config = buildBullwhipConfig(view)
    const datasets = config.data.datasets as Array<{ borderColor?: string; borderDash?: number[] }>
    ROLE_ORDER.forEach((role, index) => {
      expect(datasets[index].borderColor).toBe(roleStyle(role).colour)
      expect(datasets[index].borderDash).toEqual(roleStyle(role).dash)
      expect(orderSeriesDash(role)).toEqual(roleStyle(role).dash)
    })
    expect(datasets[4].borderColor).toBe(DEMAND_COLOUR)
  })

  it('colours the axes and the grid from the theme', () => {
    const scales = buildBullwhipConfig(view).options?.scales as Record<
      string,
      { ticks?: { color?: string }; grid?: { color?: string } }
    >
    expect(scales.x.ticks?.color).toBe(AXIS_COLOUR)
    expect(scales.y.ticks?.color).toBe(AXIS_COLOUR)
    expect(scales.x.grid?.color).toBe(GRID_COLOUR)
    expect(scales.y.grid?.color).toBe(GRID_COLOUR)
  })
})

describe('ACCEPTANCE 1: no palette literal remains outside chartTheme.ts', () => {
  const SRC = join(ROOT, 'src')
  const ALLOWED = [
    join('components', 'charts', 'chartTheme.ts'),
    '__tests__' + sep,
    join('components', 'game', 'views', 'board3d') + sep,
  ]

  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return sources(path)
      return /\.tsx?$/.test(name) ? [path] : []
    })
  }

  it('finds no #rrggbb literal in any src/**/*.ts(x) outside the allowed places', () => {
    const offenders: string[] = []
    for (const file of sources(SRC)) {
      const rel = relative(SRC, file)
      if (ALLOWED.some((allowed) => rel === allowed || rel.startsWith(allowed))) continue
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, index) => {
        if (/#[0-9a-fA-F]{6}\b/.test(line)) offenders.push(`${rel}:${index + 1}: ${line.trim()}`)
      })
    }
    expect(offenders).toEqual([])
  })
})
