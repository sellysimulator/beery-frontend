/** THROWAWAY: sign/plate overlap sweep. Delete before shipping. */
import { describe, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { ROLE_ORDER } from '../types/game'
import type { PlayerView, Role, WeekRecord, WeekSettlement } from '../types/game'
import type { BoardViewProps } from '../components/game/views/Board2D'
import { buildSceneModel } from '../components/game/views/board3d/sceneModel'
import type { SceneModel, SceneSign } from '../components/game/views/board3d/sceneModel'

function settlementFor(role: Role, over: Partial<WeekSettlement> = {}): WeekSettlement {
  return {
    role, week: 6, opening_inventory: 12, opening_backlog: 0, arrived: 14,
    incoming_order: 55, obligation: 55, shipped: 18, unfulfilled: 37,
    closing_inventory: 8, closing_backlog: 37, holding_cost: 4, backlog_cost: 37,
    carrying_cost: 41, ...over,
  }
}
function historyFor(role: Role): WeekRecord[] {
  return [601, 602, 603].map((inventory, index) => ({
    role, week: index + 1, opening_inventory: 12, opening_backlog: 0, arrived: 4,
    incoming_order: 8, obligation: 8, shipped: 8, unfulfilled: 0,
    closing_inventory: inventory, closing_backlog: [701, 702, 703][index],
    supply_line_after: 10, orders_in_flight_after: 10, order: [801, 802, 803][index],
    was_bot: false, was_forced: false, holding_cost: 4, backlog_cost: 0,
    fixed_order_cost: 0, purchase_cost: 0, week_cost: 4, cumulative_cost: 21.5,
    production_started: null, production_queued: null,
  }))
}
function viewFor(role: Role, over: Partial<PlayerView> = {}): PlayerView {
  return {
    role, week: 6, duration_weeks: 36, phase: 'DECISION', currency_symbol: '$',
    inventory: 27, backlog: 39, supply_line: 103, supply_line_slots: [41, 62],
    orders_in_flight: role === 'FACTORY' ? 0 : 40,
    orders_in_flight_slots: role === 'FACTORY' ? [] : [17, 23],
    incoming_order: 55, last_order: 31, settlement: settlementFor(role),
    has_submitted: false, awaiting_roles: [...ROLE_ORDER], own_history: historyFor(role),
    max_order_quantity: null, allow_negative_orders: false,
    show_supply_line_prominently: true, production_queue: role === 'FACTORY' ? 34 : null,
    order_arrival_lead_weeks: 4, holding_cost_per_unit_week: 0.5,
    backlog_cost_per_unit_week: 1, ...over,
  }
}
function propsFor(role: Role, over: Partial<PlayerView> = {}, props: Partial<BoardViewProps> = {}): BoardViewProps {
  return {
    view: viewFor(role, over), week: 6, durationWeeks: 36, paused: false, pausedReason: null,
    locked: false, isChangingOrder: false, gameOver: false, awaitingRoles: [...ROLE_ORDER],
    initialOrder: null, notice: null, canChangeOrder: true, weekChanged: false,
    onSubmitOrder: () => {}, onChangeOrder: () => {}, onKeepOrder: () => {}, ...props,
  }
}
function modelFor(role: Role, over: Partial<PlayerView> = {}, props: Partial<BoardViewProps> = {}): SceneModel {
  return buildSceneModel(propsFor(role, over, props))
}
function maximal(role: Role, over: Partial<PlayerView> = {}, props: Partial<BoardViewProps> = {}): SceneModel {
  return modelFor(role, {
    inventory: 500, backlog: 500,
    supply_line_slots: [40, 40, 40, 40, 40, 40],
    orders_in_flight_slots: role === 'FACTORY' ? [] : [40, 40, 40, 40],
    production_queue: role === 'FACTORY' ? 90 : null,
    accumulated_cost: 61.25, week_cost: 7.5, balance: 81.25,
    customer_demand_series: [3, 4, 9],
    neighbours: { RETAILER: { inventory: 71, backlog: 72 } },
    chain: {
      RETAILER: { inventory: 81, backlog: 0 }, WHOLESALER: { inventory: 82, backlog: 0 },
      DISTRIBUTOR: { inventory: 83, backlog: 0 }, FACTORY: { inventory: 84, backlog: 0 },
    },
    leaderboard: [{ role: 'FACTORY', accumulated_cost: 91.5 }],
    ...over,
  }, props)
}

/** Horizontal penetration and vertical penetration of two plates. A
 *  billboarded plate can face any way, so its footprint is a disc. */
function penetration(a: SceneSign, b: SceneSign): { h: number; v: number } {
  const dx = a.position[0] - b.position[0]
  const dz = a.position[2] - b.position[2]
  const dist = Math.hypot(dx, dz)
  const h = (a.plateWidth + b.plateWidth) / 2 - dist
  const aTop = a.position[1] + a.plateHeight / 2
  const aBot = a.position[1] - a.plateHeight / 2
  const bTop = b.position[1] + b.plateHeight / 2
  const bBot = b.position[1] - b.plateHeight / 2
  const v = Math.min(aTop, bTop) - Math.max(aBot, bBot)
  return { h, v }
}

describe('sweep', () => {
  it('reports every overlapping plate pair', () => {
    const rows: string[] = []
    let count = 0
    for (const role of ROLE_ORDER) {
      for (const [label, model] of [
        ['typical', modelFor(role)],
        ['maximal', maximal(role)],
        ['empty+locked', maximal(role, { inventory: 0 }, { locked: true })],
      ] as const) {
        rows.push(`--- ${role} ${label}: ${model.signs.length} signs`)
        const signs = model.signs
        for (let i = 0; i < signs.length; i += 1) {
          for (let j = i + 1; j < signs.length; j += 1) {
            const { h, v } = penetration(signs[i], signs[j])
            if (h > 0 && v > 0) {
              count += 1
              rows.push(
                `  OVERLAP ${signs[i].id} <> ${signs[j].id}  h=${h.toFixed(2)} v=${v.toFixed(2)}` +
                `  A[${signs[i].position.map((n) => n.toFixed(1)).join(',')} w${signs[i].plateWidth.toFixed(2)} hgt${signs[i].plateHeight.toFixed(2)}]` +
                `  B[${signs[j].position.map((n) => n.toFixed(1)).join(',')} w${signs[j].plateWidth.toFixed(2)} hgt${signs[j].plateHeight.toFixed(2)}]`,
              )
            }
          }
        }
      }
    }
    rows.push(`TOTAL OVERLAPS: ${count}`)
    writeFileSync('/tmp/claude-501/sweep.txt', rows.join('\n'))
  })
})
