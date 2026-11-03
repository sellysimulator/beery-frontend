/**
 * The "Final cost per role and for the chain" cards (`21 §2.1`).
 *
 * A bot's card used to come out a different shape from a player's: the live
 * results had no participant entry for a bot seat, so its card had no name
 * row and no Bot tag, and its cost figure sat higher than its neighbours'.
 * Every card now carries the same rows, and a bot's carries the tag.
 */
import { describe, expect, it } from 'vitest'
import { render, within } from '@testing-library/react'

import CostSummary from '../components/results/CostSummary'
import type { ResultsView, RoleResultView } from '../components/charts/chartSetup'
import { ROLE_ORDER, type Role } from '../types/game'

function roleView(role: Role, display_name: string, is_bot: boolean): RoleResultView {
  return {
    role,
    display_name,
    is_bot,
    total_cost: 100,
    peak_inventory: 10,
    peak_backlog: 2,
    weeks_in_backlog: 1,
    order_variance: 3,
    bullwhip_ratio: 1.5,
    fill_rate: 0.9,
    average_order: 4,
    orders: [4, 4],
  }
}

function makeView(per_role: RoleResultView[]): ResultsView {
  return {
    room_code: 'BEERYX',
    weeks_played: 2,
    demand_series: [4, 4],
    chain_total_cost: 400,
    demand_variance: 0,
    currency_symbol: '$',
    per_role,
  }
}

function card(container: HTMLElement, role: Role): HTMLElement {
  const found = container.querySelector<HTMLElement>(`[data-role="${role}"]`)
  if (!found) throw new Error(`no cost card for ${role}`)
  return found
}

describe('the cost cards', () => {
  const view = makeView([
    roleView('RETAILER', 'Ana', false),
    roleView('WHOLESALER', 'Beto', false),
    roleView('DISTRIBUTOR', 'Distributor (bot)', true),
    roleView('FACTORY', 'Factory (bot)', true),
  ])

  it('tags each bot seat, and only the bot seats, with Bot', () => {
    const { container } = render(<CostSummary view={view} revealed onToggle={() => {}} />)
    for (const role of ['DISTRIBUTOR', 'FACTORY'] as const) {
      expect(within(card(container, role)).getByText('Bot')).toBeInTheDocument()
    }
    for (const role of ['RETAILER', 'WHOLESALER'] as const) {
      expect(within(card(container, role)).queryByText('Bot')).toBeNull()
    }
  })

  it('shows every seat’s name, a player’s and a bot’s alike', () => {
    const { container } = render(<CostSummary view={view} revealed onToggle={() => {}} />)
    expect(within(card(container, 'RETAILER')).getByText('Ana')).toBeInTheDocument()
    expect(within(card(container, 'FACTORY')).getByText('Factory (bot)')).toBeInTheDocument()
  })

  it('gives every card the same rows, so the figures line up — even a seat with no name', () => {
    const odd = makeView([
      roleView('RETAILER', 'Ana', false),
      roleView('WHOLESALER', '', false),
      roleView('DISTRIBUTOR', 'Distributor (bot)', true),
      roleView('FACTORY', '', true),
    ])
    const { container } = render(<CostSummary view={odd} revealed onToggle={() => {}} />)
    const shapes = ROLE_ORDER.map((role) =>
      Array.from(card(container, role).children).map(
        (child) => `${child.tagName}:${child.getAttribute('data-field') ?? ''}:${child.className}`,
      ),
    )
    for (const shape of shapes) expect(shape).toEqual(shapes[0])
    expect(within(card(container, 'FACTORY')).getByText('Bot')).toBeInTheDocument()
  })
})
