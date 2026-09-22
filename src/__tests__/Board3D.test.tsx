/**
 * `24-frontend-3d-board.md §8` — the 3D board, asserted as an object.
 *
 * Covers §9's acceptance criteria 6, 7, 8 (structurally), 9, 10, 11, 12, 13,
 * 15, 16, 17, 20 and 22, and §10's failure modes 1, 2, 3, 4, 5, 7 and 10.
 *
 * THE GOVERNING CONSTRAINT (§8.1, §8.2): jsdom has no WebGL. This file imports
 * **only** pure modules and DOM components. It never imports `Board3D.tsx` or
 * `WarehouseScene.tsx`, so `@react-three/fiber` is never loaded and no mock of
 * it is needed. That is not a convenience — it is the point of the seam:
 *
 * > `buildSceneModel` returns exactly what `WarehouseScene` draws — the
 * > component adds nothing to it — which is what lets this section's
 * > acceptance criteria be checked against an object instead of against a
 * > mocked renderer.
 *
 * It is the shape `chartSetup.ts` already established for Chart.js, where
 * `buildBullwhipConfig` is asserted as a configuration object because a canvas
 * is opaque to jsdom. Every assertion below is against the `SceneModel`, never
 * against a pixel, and §8.4 says so explicitly: pixels, camera pose and
 * whether the truck looks like a truck are verified once, by a human, against
 * four screenshots.
 *
 * Harness notes:
 *  - **No socket recorder.** `DecisionPanel.test.tsx` drives gameplay
 *    components through `GameRoomPlaying` with a mocked `socket.io-client`,
 *    because `17 §2.0` freezes that screen as taking no props and no document
 *    freezes a prop shape for the components inside it. Neither half of that
 *    reasoning reaches here. The one component that would mount `Board3DHud`
 *    and `Board3DPanels` is `Board3D.tsx`, which this file may never import;
 *    and 24 §6.2 does freeze these three modules' prop shapes, so addressing
 *    them directly invents nothing. Nothing in this file's import graph
 *    touches `socket.io-client`, `src/api/*` or the store, so there is no
 *    transport for a recorder to intercept. The one thing that *would* be
 *    driven through `GameRoomPlaying` — that the 2D board is still the default
 *    and that the toggle writes `'3D'` — is asserted in `GameRoomFlow.test.tsx`
 *    on the real harness, where it belongs (§8.3).
 *  - Every fixture number is deliberately distinctive, so an assertion that a
 *    figure is present or absent cannot be satisfied by an unrelated digit.
 *  - Labels are asserted **by identity against the source records**
 *    (`RECEIPT_LABEL`, `DEMAND_SOURCE_LABEL`, `UPSTREAM_LABEL`,
 *    `DOWNSTREAM_LABEL`, `ROLE_LABEL`), never against a literal. A literal
 *    that happens to match today is a literal that drifts tomorrow (§10 FM 5).
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ROLE_ORDER } from '../types/game'
import type { PlayerView, Role, WeekRecord, WeekSettlement } from '../types/game'
import { ROLE_LABEL } from '../components/lobby/roleCopy'
import {
  DEMAND_SOURCE_LABEL,
  DOWNSTREAM_LABEL,
  RECEIPT_LABEL,
  UPSTREAM_LABEL,
} from '../components/game/RoleBanner'
import { formatMoney } from '../components/game/SettlementRecap'
import type { BoardViewProps } from '../components/game/views/Board2D'
import BoardViewToggle from '../components/game/views/BoardViewToggle'
import { resolveBoardView } from '../components/game/views/boardViewChoice'
import {
  CONTEXT_LOST_EVENT,
  observeContextLoss,
} from '../components/game/views/board3d/contextLoss'
import { ROLE_SETS } from '../components/game/views/board3d/roleSets'
import {
  ARCHITECTURE_HEX,
  QUANTITY_HEX,
  TEXT_HEX,
} from '../components/game/views/board3d/scenePalette'
import {
  buildSceneModel,
  crateCount,
  deskPrompt,
  describeScene,
  estimateDrawCalls,
} from '../components/game/views/board3d/sceneModel'
import type {
  FixtureId,
  InstancePool,
  PoolId,
  SceneFixture,
  SceneModel,
} from '../components/game/views/board3d/sceneModel'
import {
  FRONT_LANE_SCALE,
  MAX_DRAW_CALLS,
  MAX_INSTANCE_POOLS,
  MAX_LIGHTS,
  MAX_SIGNS,
  PILE_GRID,
  PILE_SCALE,
  pileStackTop,
  SIGN_HEIGHT,
  SUPPLY_LANE_X,
  UNITS_PER_CRATE,
} from '../components/game/views/board3d/sceneLayout'
import Board3DHud from '../components/game/views/board3d/Board3DHud'
import Board3DPanels from '../components/game/views/board3d/Board3DPanels'
import ModelAttribution from '../components/game/views/board3d/ModelAttribution'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function settlementFor(role: Role, over: Partial<WeekSettlement> = {}): WeekSettlement {
  return {
    role,
    week: 6,
    opening_inventory: 12,
    opening_backlog: 0,
    arrived: 14,
    incoming_order: 55,
    obligation: 55,
    shipped: 18,
    unfulfilled: 37,
    closing_inventory: 8,
    closing_backlog: 37,
    holding_cost: 4,
    backlog_cost: 37,
    carrying_cost: 41,
    ...over,
  }
}

function historyFor(role: Role): WeekRecord[] {
  return [601, 602, 603].map((inventory, index) => ({
    role,
    week: index + 1,
    opening_inventory: 12,
    opening_backlog: 0,
    arrived: 4,
    incoming_order: 8,
    obligation: 8,
    shipped: 8,
    unfulfilled: 0,
    closing_inventory: inventory,
    closing_backlog: [701, 702, 703][index],
    supply_line_after: 10,
    orders_in_flight_after: 10,
    order: [801, 802, 803][index],
    was_bot: false,
    was_forced: false,
    holding_cost: 4,
    backlog_cost: 0,
    fixed_order_cost: 0,
    purchase_cost: 0,
    week_cost: 4,
    cumulative_cost: 21.5,
    production_started: null,
    production_queued: null,
  }))
}

/**
 * The gated keys — `accumulated_cost`, `week_cost`, `balance`, `neighbours`,
 * `chain`, `leaderboard`, `customer_demand_series` — are all absent by
 * default, because their absence is exactly what AC 6, AC 11 and AC 23 turn
 * on. `production_queue` follows `07 §3.8`: the Factory's unstarted
 * production, `null` for the other three.
 */
function viewFor(role: Role, over: Partial<PlayerView> = {}): PlayerView {
  return {
    role,
    week: 6,
    duration_weeks: 36,
    phase: 'DECISION',
    currency_symbol: '$',
    inventory: 27,
    backlog: 39,
    supply_line: 103,
    supply_line_slots: [41, 62],
    orders_in_flight: role === 'FACTORY' ? 0 : 40,
    orders_in_flight_slots: role === 'FACTORY' ? [] : [17, 23],
    incoming_order: 55,
    last_order: 31,
    settlement: settlementFor(role),
    has_submitted: false,
    awaiting_roles: [...ROLE_ORDER],
    own_history: historyFor(role),
    max_order_quantity: null,
    allow_negative_orders: false,
    show_supply_line_prominently: true,
    production_queue: role === 'FACTORY' ? 34 : null,
    order_arrival_lead_weeks: 4,
    holding_cost_per_unit_week: 0.5,
    backlog_cost_per_unit_week: 1,
    ...over,
  }
}

/** The board's props, with the 2D board's own contract (**D15**) unwidened. */
function propsFor(
  role: Role,
  over: Partial<PlayerView> = {},
  props: Partial<BoardViewProps> = {},
): BoardViewProps {
  return {
    view: viewFor(role, over),
    week: 6,
    durationWeeks: 36,
    paused: false,
    pausedReason: null,
    locked: false,
    isChangingOrder: false,
    gameOver: false,
    awaitingRoles: [...ROLE_ORDER],
    initialOrder: null,
    notice: null,
    canChangeOrder: true,
    weekChanged: false,
    onSubmitOrder: () => {},
    onChangeOrder: () => {},
    onKeepOrder: () => {},
    ...props,
  }
}

function modelFor(
  role: Role,
  over: Partial<PlayerView> = {},
  props: Partial<BoardViewProps> = {},
): SceneModel {
  return buildSceneModel(propsFor(role, over, props))
}

// ---------------------------------------------------------------------------
// Model helpers
// ---------------------------------------------------------------------------

function fixtureIds(model: SceneModel): FixtureId[] {
  return model.fixtures.map((fixture) => fixture.id)
}

function fixtureFor(model: SceneModel, id: FixtureId): SceneFixture | undefined {
  return model.fixtures.find((fixture) => fixture.id === id)
}

function poolFor(model: SceneModel, id: PoolId): InstancePool | undefined {
  return model.pools.find((pool) => pool.id === id)
}

/** One sign's text, by the id `sceneModel.ts` gave it. */
function signText(model: SceneModel, id: string): string | undefined {
  return model.signs.find((item) => item.id === id)?.text
}

function allSignText(model: SceneModel): string {
  return model.signs.map((item) => item.text).join(' | ')
}

/**
 * Every string anywhere in the model, walked recursively.
 *
 * AC 11 is *"no currency symbol appears anywhere in the scene"*, and "anywhere"
 * has to mean the whole object — a plate the scan forgot to visit is exactly
 * the plate that ships. The model is a finite tree of plain data, so a walk is
 * cheap and total.
 */
function everyString(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const item of value) everyString(item, out)
  else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) everyString(item, out)
  }
  return out
}

/**
 * The stub `setup.ts` installs answers `false` to every query, which is the
 * right default. Two tests need a query to match; both restore it afterwards.
 */
const REAL_MATCH_MEDIA = window.matchMedia

function matchOnly(...queries: readonly string[]): void {
  window.matchMedia = ((query: string) => ({
    matches: queries.includes(query),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

afterEach(() => {
  window.matchMedia = REAL_MATCH_MEDIA
})

// ---------------------------------------------------------------------------
// §8.2 — Display scaling (§4.1, normative)
// ---------------------------------------------------------------------------

describe('display scaling: crateCount is the only place a quantity becomes a count', () => {
  it('clamps floor(quantity / divisor) between 0 and the cap', () => {
    expect(crateCount(0, 2, 40)).toBe(0)
    // Below one crate's worth is no crate, not a rounded-up one: a crate that
    // is not there is not drawn.
    expect(crateCount(1, 2, 40)).toBe(0)
    expect(crateCount(24, 2, 40)).toBe(12)
    expect(crateCount(400, 2, 40)).toBe(40)
  })

  it('never returns a negative count, whatever it is handed', () => {
    // The lower clamp is not decoration: `balance` is signed, and the cost
    // corner hands it through `Math.abs` precisely because a mesh count of
    // −3 is not a thing three.js can be asked for.
    expect(crateCount(-5, 2, 40)).toBe(0)
  })

  it('the divisors and caps come from sceneLayout, not from this file', () => {
    expect(PILE_SCALE.inventory).toEqual({ divisor: UNITS_PER_CRATE, cap: 40 })
    expect(PILE_SCALE.supplyLane.cap).toBe(12)
    expect(PILE_SCALE.orderMarker.cap).toBe(10)
    expect(PILE_SCALE.productionQueue.cap).toBe(20)
    expect(PILE_SCALE.money.cap).toBe(20)
  })
})

// ---------------------------------------------------------------------------
// §8.2 — No computed figure (§4.1, AC 6, AC 7, §10 FM 1 and FM 4)
// ---------------------------------------------------------------------------

describe('NO COMPUTED FIGURE: the sign carries the field, the crates are a texture on it', () => {
  it('inventory 81 caps the pile at 40 while the sign still reads 81', () => {
    const model = modelFor('WHOLESALER', { inventory: 81 })

    expect(poolFor(model, 'inventory')?.stacks[0]?.count).toBe(40)
    expect(signText(model, 'stock-floor-sign')).toBe('ON HAND 81')
    // The lie this guards against is the sign reading the mesh count back out.
    expect(allSignText(model)).not.toMatch(/ON HAND 40\b/)
  })

  it('FM 1: inventory 500 caps the pile and the sign still reads 500', () => {
    const model = modelFor('DISTRIBUTOR', { inventory: 500 })

    expect(poolFor(model, 'inventory')?.stacks[0]?.count).toBe(PILE_SCALE.inventory.cap)
    expect(signText(model, 'stock-floor-sign')).toBe('ON HAND 500')
    // The canvas label is the same boundary from the screen-reader side: it
    // reports the server's figure, never the forty crates standing for it.
    expect(describeScene(model)).toContain('500 crates on hand')
    expect(describeScene(model)).not.toContain('40 crates')
  })

  it('FM 4: a settlement whose holding_cost is not units × rate renders the payload', () => {
    // 8 closing units × $0.50 would be $4.00. The server says $9.99. A view
    // that multiplied the two would be right until the day the server rounded
    // differently, and then wrong in a way nobody could explain
    // (`SettlementRecap.tsx`'s [HARD-WON] note, and `19` FM 4).
    const model = modelFor('RETAILER', {
      holding_cost_per_unit_week: 0.5,
      settlement: settlementFor('RETAILER', {
        closing_inventory: 8,
        holding_cost: 9.99,
        backlog_cost: 12.34,
        carrying_cost: 22.33,
      }),
    })

    const ledger = allSignText(model)
    expect(ledger).toContain(formatMoney('$', 9.99))
    expect(ledger).toContain(formatMoney('$', 12.34))
    expect(ledger).toContain(formatMoney('$', 22.33))
    // The rate line is text beside the server's figure; the product is never
    // computed, so `$4.00` must appear nowhere in the whole model.
    expect(everyString(model).join(' | ')).not.toContain(formatMoney('$', 4))
  })

  it('every money string goes through formatMoney with the view s own symbol', () => {
    const model = modelFor('RETAILER', {
      currency_symbol: '£',
      balance: -18.5,
      settlement: settlementFor('RETAILER', { holding_cost: 7.25 }),
    })

    const text = everyString(model).join(' | ')
    expect(text).toContain('£7.25')
    expect(text).toContain('-£18.50')
    expect(text).not.toContain('$')
  })
})

// ---------------------------------------------------------------------------
// §8.2 — Per-role shells (§3.3, §10 FM 5)
// ---------------------------------------------------------------------------

describe('per-role shells: every label is the source record s, by identity', () => {
  it.each(ROLE_ORDER)('%s sources its five labels from the shared records', (role) => {
    const set = ROLE_SETS[role]

    expect(set.receiptSign).toBe(RECEIPT_LABEL[role])
    expect(set.demandSign).toBe(DEMAND_SOURCE_LABEL[role])
    expect(set.upstreamName).toBe(UPSTREAM_LABEL[role])
    expect(set.downstreamName).toBe(DOWNSTREAM_LABEL[role])
    expect(set.label).toBe(ROLE_LABEL[role])
  })

  it('FM 5: there are exactly four dressings and no fifth copy of the vocabulary', () => {
    expect(Object.keys(ROLE_SETS).sort()).toEqual([...ROLE_ORDER].sort())
    expect(ROLE_ORDER.map((role) => ROLE_SETS[role].label)).toEqual(
      ROLE_ORDER.map((role) => ROLE_LABEL[role]),
    )
    // `UPSTREAM_LABEL.FACTORY === null` is the single most important
    // structural fact about that seat, and the RoleSet carries it unaltered
    // rather than papering over it with a string.
    expect(ROLE_SETS.FACTORY.upstreamName).toBeNull()
  })

  it('the scene puts the role s own words on the gantry and the demand placard', () => {
    for (const role of ROLE_ORDER) {
      const model = modelFor(role)
      expect(signText(model, 'gantry-receipt')).toBe(RECEIPT_LABEL[role].toUpperCase())
      expect(signText(model, 'demand-placard-sign')).toBe(
        `${DEMAND_SOURCE_LABEL[role]} WANTS 55`,
      )
      expect(signText(model, 'role-sign')).toBe(ROLE_LABEL[role])
    }
  })
})

// ---------------------------------------------------------------------------
// §8.2 — FACTORY structure (AC 9, `19` AC 7 / FM 13)
// ---------------------------------------------------------------------------

describe('FACTORY structure: the seat with no supplier has no road to one', () => {
  it('has no order road at all', () => {
    expect(ROLE_SETS.FACTORY.hasOrderRoad).toBe(false)
  })

  it('omits the upstream gate, the order road and the courier, and builds a brewhouse', () => {
    const ids = fixtureIds(modelFor('FACTORY'))

    expect(ids).not.toContain('upstream-gate')
    expect(ids).not.toContain('order-road')
    expect(ids).not.toContain('order-courier')
    expect(ids).not.toContain('order-marker-0')
    expect(ids).toContain('brewhouse')
  })

  it('says why the road is missing rather than leaving a player hunting for it', () => {
    const model = modelFor('FACTORY')
    const ids = fixtureIds(model)

    expect(ids).toContain('brewhouse-wall-sign')
    const wall = `${signText(model, 'brewhouse-wall-line-1')} ${signText(
      model,
      'brewhouse-wall-line-2',
    )}`
    expect(wall).toContain('YOU BREW YOUR OWN SUPPLY')
    expect(wall).toContain('NOBODY IS UPSTREAM OF YOU')
  })

  it('the other three roles do have the gate and the road', () => {
    for (const role of ['RETAILER', 'WHOLESALER', 'DISTRIBUTOR'] as const) {
      const ids = fixtureIds(modelFor(role))
      expect(ids).toContain('upstream-gate')
      expect(ids).toContain('order-road')
    }
  })
})

// ---------------------------------------------------------------------------
// §8.2 — The FACTORY queue (AC 12)
// ---------------------------------------------------------------------------

describe('the production queue: one role, and only when there is one', () => {
  it('production_queue 4 builds the pen with 2 crates', () => {
    const model = modelFor('FACTORY', { production_queue: 4 })

    expect(fixtureIds(model)).toContain('production-queue')
    expect(poolFor(model, 'production-queue')?.stacks[0]?.count).toBe(2)
    expect(signText(model, 'production-queue-sign')).toBe('WAITING TO BE PRODUCED: 4')
  })

  it('production_queue 0 omits the whole fixture — no pen, no sign', () => {
    const model = modelFor('FACTORY', { production_queue: 0 })

    expect(fixtureIds(model)).not.toContain('production-queue')
    expect(poolFor(model, 'production-queue')).toBeUndefined()
    expect(allSignText(model)).not.toMatch(/WAITING TO BE PRODUCED/)
  })

  it('production_queue null omits it too, mirroring 2D s `!== null && > 0`', () => {
    expect(fixtureIds(modelFor('FACTORY', { production_queue: null }))).not.toContain(
      'production-queue',
    )
  })

  it('a stray non-null on a non-Factory is ignored — the bay is a FACTORY fixture', () => {
    // A server that ever sent this would be wrong; a board that drew a
    // production bay in a shop would be wrong in a way a player could not
    // recover from, because it would teach them the game works another way.
    const model = modelFor('RETAILER', { production_queue: 34 })

    expect(fixtureIds(model)).not.toContain('production-queue')
    expect(allSignText(model)).not.toMatch(/WAITING TO BE PRODUCED/)
  })
})

// ---------------------------------------------------------------------------
// §8.2 — The supply line (AC 10, `19` AC 4 / AC 5 / FM 3)
// ---------------------------------------------------------------------------

describe('the supply line: four lanes, front lane first', () => {
  it('a four-slot view builds four lanes, nearest first and largest', () => {
    const model = modelFor('WHOLESALER', { supply_line_slots: [9, 13, 21, 33], supply_line: 76 })
    const ids = fixtureIds(model)

    expect(ids).toContain('supply-lane-0')
    expect(ids).toContain('supply-lane-3')
    expect(ids).not.toContain('supply-lane-overflow')

    const stacks = poolFor(model, 'supply-lanes')?.stacks ?? []
    expect(stacks).toHaveLength(4)
    // Lane i at x = −6 + 4i, front lane at 1.15× (§4.2, §1.1's whole bet).
    expect(stacks[0]?.position[0]).toBe(SUPPLY_LANE_X[0])
    expect(stacks[0]?.scale).toBe(FRONT_LANE_SCALE)
    expect(stacks[1]?.scale).toBe(1)
    // ÷2, capped at 12 per lane: the fourth lane's 33 units would be 16
    // crates and stands at the cap instead — while its placard still reads
    // 33, which is FM 1 again, one lane at a time.
    expect(stacks.map((stack) => stack.count)).toEqual([4, 6, 10, PILE_SCALE.supplyLane.cap])
    expect(signText(model, 'supply-lane-3-placard')).toContain('33 UNITS')

    expect(signText(model, 'supply-lane-0-placard')).toBe('9 UNITS ARRIVING NEXT WEEK')
    expect(signText(model, 'supply-lane-1-placard')).toBe('13 UNITS ARRIVING THE WEEK AFTER')
    expect(signText(model, 'supply-lane-2-placard')).toBe('21 UNITS ARRIVING IN 3 WEEKS')
  })

  it('a fifth slot folds into one placard rather than a fifth lane', () => {
    const model = modelFor('WHOLESALER', { supply_line_slots: [9, 13, 21, 33, 5, 5] })

    expect(fixtureIds(model)).toContain('supply-lane-overflow')
    expect(signText(model, 'supply-lane-overflow-placard')).toBe('+2 MORE LANES')
    expect(model.figures.lanesShown).toBe(4)
  })

  it('AC 10 / FM 3: show_supply_line_prominently false omits every lane placard', () => {
    const model = modelFor('WHOLESALER', {
      show_supply_line_prominently: false,
      supply_line_slots: [9, 13, 21, 33],
      supply_line: 76,
    })
    const ids = fixtureIds(model)

    for (const lane of ['supply-lane-0', 'supply-lane-1', 'supply-lane-2', 'supply-lane-3']) {
      expect(ids).not.toContain(lane)
    }
    expect(ids).not.toContain('supply-lane-overflow')
    // No crates either — a hidden pile is still a pile in the draw call.
    expect(poolFor(model, 'supply-lanes')).toBeUndefined()

    // The gantry total still renders, over bare paint. The host made the game
    // harder on purpose (`19 §2.2`) and helpfully compensating defeats that.
    expect(ids).toContain('receiving-bay')
    expect(signText(model, 'gantry-total')).toBe('TOTAL ON THE WAY TO YOU: 76 UNITS')
    // None of the individual slot figures leaks out on another sign.
    expect(allSignText(model)).not.toMatch(/\b33 UNITS ARRIVING\b/)
  })

  it('the gantry total is the server s figure, never a sum of the lanes', () => {
    // 41 + 62 = 103, and the server happens to disagree. The server wins.
    const model = modelFor('RETAILER', { supply_line: 999, supply_line_slots: [41, 62] })
    expect(signText(model, 'gantry-total')).toBe('TOTAL ON THE WAY TO YOU: 999 UNITS')
  })
})

// ---------------------------------------------------------------------------
// §8.2 — The wrong pipeline (§10 FM 2)
// ---------------------------------------------------------------------------

describe('FM 2: the order road is the SUPPLIER s pipeline, and the Factory has none', () => {
  it('the Retailer s road carries orders_in_flight_slots, not supply_line_slots', () => {
    const model = modelFor('RETAILER', {
      orders_in_flight: 40,
      orders_in_flight_slots: [17, 23],
      supply_line_slots: [41, 62],
    })
    const ids = fixtureIds(model)

    expect(ids).toContain('order-road')
    expect(ids).toContain('order-marker-0')
    expect(signText(model, 'upstream-total')).toBe('TOTAL STILL TRAVELLING UPSTREAM: 40 UNITS')
    expect(signText(model, 'order-marker-0-placard')).toBe(
      '17 REACHING YOUR SUPPLIER NEXT WEEK',
    )
    // Inverting the two is the mistake `07 §3.8` warns about, and it would put
    // the downstream neighbour's future demand on the player's screen.
    expect(signText(model, 'order-marker-0-placard')).not.toContain('41')
    // ÷2, capped at 10 per slot: 17 → 8 crates, 23 → the cap, both placarded
    // with the server's own figure.
    expect(poolFor(model, 'order-markers')?.stacks.map((stack) => stack.count)).toEqual([
      8,
      PILE_SCALE.orderMarker.cap,
    ])
    expect(signText(model, 'order-marker-1-placard')).toContain('23 REACHING')
  })

  it('the Factory s empty pipeline builds no road at all', () => {
    const model = modelFor('FACTORY', { orders_in_flight: 0, orders_in_flight_slots: [] })
    const ids = fixtureIds(model)

    expect(ids).not.toContain('order-road')
    expect(ids).not.toContain('order-courier')
    expect(poolFor(model, 'order-markers')).toBeUndefined()
  })

  it('a truck stands on the road only when something is actually on it', () => {
    expect(fixtureIds(modelFor('RETAILER', { orders_in_flight: 40 }))).toContain('order-courier')
    const empty = modelFor('RETAILER', { orders_in_flight: 0, orders_in_flight_slots: [] })
    expect(fixtureIds(empty)).not.toContain('order-courier')
    expect(signText(empty, 'upstream-empty')).toBe(
      'No orders of yours are still travelling upstream.',
    )
  })
})

// ---------------------------------------------------------------------------
// §8.2 — Cost visibility (AC 11, `19` AC 6)
// ---------------------------------------------------------------------------

describe('cost visibility: absent means absent, not hidden', () => {
  it('all three cost fields absent omits the cost corner and its money entirely', () => {
    const model = modelFor('DISTRIBUTOR')

    expect(fixtureIds(model)).not.toContain('cost-corner')
    expect(poolFor(model, 'money')).toBeUndefined()
    expect(model.models.some((placement) => placement.asset === 'money')).toBe(false)
    expect(allSignText(model)).not.toMatch(/THIS WEEK|BALANCE|ACCUMULATED/)
  })

  it('AC 11: with nothing settled either, no currency symbol appears anywhere', () => {
    // The scan is over the WHOLE model, which is why the fixture also has
    // nothing settled: the ledger wall's rows are the server's per-week
    // settlement figures and are not gated by `show_running_cost_to_players`,
    // so the only scene that can carry no currency symbol at all is one where
    // no week has closed yet. `sceneModel.ts` guards `settlement` truthily for
    // exactly this week, as `SettlementRecap` does.
    const model = modelFor('DISTRIBUTOR', {
      settlement: null as unknown as WeekSettlement,
    })

    expect(fixtureIds(model)).not.toContain('cost-corner')
    for (const text of everyString(model)) {
      expect(text, `a currency symbol reached the scene: ${text}`).not.toMatch(/[$£€]/)
    }
    expect(signText(model, 'ledger-row-0')).toBe('Nothing has settled yet')
  })

  it('week_cost alone builds the corner; balance outranks accumulated_cost', () => {
    const weekOnly = modelFor('DISTRIBUTOR', { week_cost: 7.5 })
    expect(fixtureIds(weekOnly)).toContain('cost-corner')
    expect(signText(weekOnly, 'cost-week')).toBe('THIS WEEK $7.50')

    const both = modelFor('DISTRIBUTOR', { balance: 81.25, accumulated_cost: 44 })
    expect(signText(both, 'cost-balance')).toBe('BALANCE $81.25')
    expect(signText(both, 'cost-accumulated')).toBeUndefined()

    const accumulated = modelFor('DISTRIBUTOR', { accumulated_cost: 44 })
    expect(signText(accumulated, 'cost-accumulated')).toBe('ACCUMULATED $44.00')
  })
})

// ---------------------------------------------------------------------------
// §8.2 — The six optional blocks, independently (`19` AC 23)
// ---------------------------------------------------------------------------

describe('the six visibility blocks are independently absent', () => {
  /** Each block, the fixture it builds, and the key that turns it on. */
  const BLOCKS: ReadonlyArray<{ name: string; fixture: FixtureId; on: Partial<PlayerView> }> = [
    { name: 'neighbours', fixture: 'neighbour-hatch', on: { neighbours: { RETAILER: { inventory: 71, backlog: 72 } } } },
    {
      name: 'chain',
      fixture: 'chain-table',
      on: {
        chain: {
          RETAILER: { inventory: 81, backlog: 0 },
          WHOLESALER: { inventory: 82, backlog: 0 },
          DISTRIBUTOR: { inventory: 83, backlog: 0 },
          FACTORY: { inventory: 84, backlog: 0 },
        },
      },
    },
    { name: 'leaderboard', fixture: 'leaderboard-plaque', on: { leaderboard: [{ role: 'FACTORY', accumulated_cost: 91.5 }] } },
    { name: 'customer_demand_series', fixture: 'demand-ticker', on: { customer_demand_series: [3, 4, 9] } },
    { name: 'the cost trio', fixture: 'cost-corner', on: { accumulated_cost: 61.25 } },
    { name: 'production_queue', fixture: 'production-queue', on: { production_queue: 12 } },
  ]

  /** A Factory with every optional key off — the six-blocks-absent baseline. */
  const BARE: Partial<PlayerView> = { production_queue: null }

  it('with every key off, none of the six fixtures is built', () => {
    const ids = fixtureIds(modelFor('FACTORY', BARE))
    for (const block of BLOCKS) expect(ids, block.name).not.toContain(block.fixture)
  })

  it.each(BLOCKS)('$name alone builds only its own fixture', (block) => {
    const ids = fixtureIds(modelFor('FACTORY', { ...BARE, ...block.on }))

    expect(ids).toContain(block.fixture)
    for (const other of BLOCKS) {
      if (other.fixture === block.fixture) continue
      expect(ids, `${block.name} also switched on ${other.name}`).not.toContain(other.fixture)
    }
  })

  it('FM 3: a gate omits its fixture — no fixture in the scene carries a visible flag', () => {
    // `visible={false}` satisfies a screenshot and violates AC 6. The
    // structural guarantee is that the concept does not exist in the model at
    // all, so there is nothing for a renderer to be tempted by.
    for (const model of [modelFor('FACTORY', BARE), modelFor('RETAILER')]) {
      for (const fixture of model.fixtures) {
        expect(Object.keys(fixture), fixture.id).not.toContain('visible')
        expect(Object.keys(fixture), fixture.id).not.toContain('hidden')
      }
    }
  })
})

// ---------------------------------------------------------------------------
// §8.2 — Empty states (§4.2)
// ---------------------------------------------------------------------------

describe('empty states: an empty floor is not nothing', () => {
  it('inventory 0 draws no crates, an empty pallet and the stated sign', () => {
    const model = modelFor('RETAILER', { inventory: 0 })

    expect(poolFor(model, 'inventory')).toBeUndefined()
    expect(fixtureIds(model)).toContain('stock-floor-empty')
    expect(signText(model, 'stock-floor-sign')).toBe('ON HAND 0 — nothing in stock')
  })

  it('backlog 0 keeps the pen, empties it, and carries the 2D teaching copy', () => {
    const model = modelFor('RETAILER', { backlog: 0 })

    expect(fixtureIds(model)).toContain('backlog-pen')
    expect(poolFor(model, 'backlog')).toBeUndefined()
    expect(signText(model, 'backlog-empty')).toBe(
      'Nothing owed. Everything your customer has asked for has gone out.',
    )
  })

  it('the backlog pen carries three signals for one quantity, not just a colour', () => {
    // `19 §3.4` / AC 8: colour is never the only signal. The fence, the
    // warning glyph the 2D `BacklogIcon` draws, and the word OWED.
    const pen = fixtureFor(modelFor('RETAILER', { backlog: 39 }), 'backlog-pen')

    expect(pen?.kind).toBe('pen')
    expect(pen?.glyph).toBe('warning')
    expect(pen?.signs.map((item) => item.text)).toContain('OWED')
    expect(signText(modelFor('RETAILER', { backlog: 39 }), 'backlog-figure')).toBe('OWED 39')
  })

  it('supply_line_slots [] leaves painted lanes and the 2D empty copy', () => {
    const model = modelFor('RETAILER', { supply_line_slots: [], supply_line: 0 })

    expect(fixtureIds(model)).toContain('receiving-bay')
    expect(fixtureIds(model)).not.toContain('supply-lane-0')
    expect(signText(model, 'gantry-empty')).toBe('Nothing is on its way to you.')
  })

  it('an unsettled week says so rather than going blank', () => {
    const model = modelFor('RETAILER', { settlement: null as unknown as WeekSettlement })
    expect(signText(model, 'ledger-row-0')).toBe('Nothing has settled yet')
  })

  it('last_order null reads NO ORDER PLACED YET', () => {
    expect(signText(modelFor('RETAILER', { last_order: null }), 'desk-clipboard')).toBe(
      'NO ORDER PLACED YET',
    )
    expect(signText(modelFor('RETAILER', { last_order: 31 }), 'desk-clipboard')).toBe(
      'LAST ORDER 31',
    )
  })

  it('an all-submitted team board says the week is closing', () => {
    const model = modelFor('RETAILER', {}, { awaitingRoles: [] })
    expect(signText(model, 'team-all-in')).toBe('EVERYONE HAS DECIDED. THE WEEK IS CLOSING.')
  })
})

// ---------------------------------------------------------------------------
// §8.2 — The seven prompt rows of §5.2 (AC 13, AC 18)
// ---------------------------------------------------------------------------

describe('the desk prompt: the seven rows of §5.2, each from a props fixture', () => {
  it('row 1 — the three ordering seats name their actual supplier', () => {
    for (const role of ['RETAILER', 'WHOLESALER', 'DISTRIBUTOR'] as const) {
      // Composed from the source record, never typed out: AC 13 is a
      // statement about `UPSTREAM_LABEL`, not about a string.
      expect(deskPrompt(propsFor(role))).toBe(`Press E — order from ${UPSTREAM_LABEL[role]}`)
    }
  })

  it('row 2 — the Factory starts producing, and never orders', () => {
    const prompt = deskPrompt(propsFor('FACTORY'))
    expect(prompt).toBe('Press E — start producing')
    expect(prompt).not.toMatch(/order from/)
  })

  it('row 3 — isChangingOrder', () => {
    expect(deskPrompt(propsFor('RETAILER', {}, { isChangingOrder: true }))).toBe(
      'Press E — change your order',
    )
  })

  it('row 4 — locked && canChangeOrder', () => {
    expect(
      deskPrompt(propsFor('RETAILER', {}, { locked: true, canChangeOrder: true })),
    ).toBe("Press E — your order is in. See who's left.")
  })

  it('row 5 — locked && !canChangeOrder', () => {
    expect(
      deskPrompt(propsFor('RETAILER', {}, { locked: true, canChangeOrder: false })),
    ).toBe('Press E — your last order stands')
  })

  it('row 6 — paused reads the server s words, and E is inert', () => {
    const props = propsFor('RETAILER', {}, { paused: true, pausedReason: 'The host stepped out.' })
    expect(deskPrompt(props)).toBe('Paused. The host stepped out.')

    const model = buildSceneModel(props)
    expect(model.desk.enabled).toBe(false)
    expect(model.interactTargets.every((target) => target.enabled)).toBe(false)
    // Paused outranks every other branch: E does nothing, whatever else is true.
    expect(
      deskPrompt(propsFor('RETAILER', {}, { paused: true, pausedReason: null, gameOver: true })),
    ).toBe('Paused.')
  })

  it('row 7 — gameOver', () => {
    const props = propsFor('RETAILER', {}, { gameOver: true })
    expect(deskPrompt(props)).toBe('Press E — the game is over')

    const model = buildSceneModel(props)
    expect(model.desk.clipboard).toBe('absent')
    expect(model.dispatchDoorClosed).toBe(true)
    expect(signText(model, 'desk-over')).toBe('THE GAME IS OVER')
  })

  it('the other two targets say what they open, and the model carries all three', () => {
    const model = modelFor('RETAILER')
    const prompts = new Map(model.interactTargets.map((target) => [target.id, target.prompt]))

    expect([...prompts.keys()]).toEqual(['order-desk', 'ledger-wall', 'team-board'])
    expect(prompts.get('ledger-wall')).toBe("Press E — read this week's settlement")
    expect(prompts.get('team-board')).toBe('Press E — see who has decided')
    expect(prompts.get('order-desk')).toBe(deskPrompt(propsFor('RETAILER')))
  })

  it('a submitted order stamps the desk and shuts the clipboard', () => {
    const locked = buildSceneModel(propsFor('RETAILER', {}, { locked: true }))
    expect(locked.desk.stamped).toBe(true)
    expect(locked.desk.clipboard).toBe('closed')
    expect(signText(locked, 'desk-stamp')).toBe('SUBMITTED')

    const reopened = buildSceneModel(
      propsFor('RETAILER', {}, { locked: true, isChangingOrder: true }),
    )
    expect(reopened.desk.stamped).toBe(false)
    expect(reopened.desk.clipboard).toBe('open')
  })
})

// ---------------------------------------------------------------------------
// §8.2 — The budget (§7.1, AC 19)
// ---------------------------------------------------------------------------

describe('the budget ceilings hold for every role and a maximal view', () => {
  /** Everything on at once: every optional block, every pipeline, every pile. */
  function maximal(
    role: Role,
    over: Partial<PlayerView> = {},
    props: Partial<BoardViewProps> = {},
  ): SceneModel {
    const view: Partial<PlayerView> = {
      inventory: 500,
      backlog: 500,
      supply_line_slots: [40, 40, 40, 40, 40, 40],
      orders_in_flight_slots: role === 'FACTORY' ? [] : [40, 40, 40, 40],
      production_queue: role === 'FACTORY' ? 90 : null,
      accumulated_cost: 61.25,
      week_cost: 7.5,
      balance: 81.25,
      customer_demand_series: [3, 4, 9],
      neighbours: { RETAILER: { inventory: 71, backlog: 72 } },
      chain: {
        RETAILER: { inventory: 81, backlog: 0 },
        WHOLESALER: { inventory: 82, backlog: 0 },
        DISTRIBUTOR: { inventory: 83, backlog: 0 },
        FACTORY: { inventory: 84, backlog: 0 },
      },
      leaderboard: [{ role: 'FACTORY', accumulated_cost: 91.5 }],
      ...over,
    }
    return modelFor(role, view, props)
  }

  it.each(ROLE_ORDER)(
    '%s: one uniform light, at most two trucks, at most eight pools',
    (role) => {
    const model = maximal(role)

    // Tequila shipped ~18 pointLights against meshStandardMaterial, which is a
    // per-fragment cost paid on every pixel of every frame (§7.4). This is the
    // red test that keeps that regression from being a frame-rate report
    // nobody runs.
    //
    // It asserted **four** — a hemisphere, a directional key and two point
    // lights — until 2026-09-22, when a player who walked the hall asked for
    // the lighting to be removed and replaced with lighting uniform across the
    // whole board. The rule it enforces did not change and is the reason the
    // assertion was rewritten rather than deleted: the light count is bounded
    // and deliberate. What changed is the bound and the *kind*. A hemisphere
    // light has no position and no falloff, so it lights the far corner of a
    // 60 × 42 hall exactly as it lights the desk; a `pointLight` falls off
    // with the square of the distance and is by definition a hotspot with dark
    // corners round it, which is what the player was objecting to.
    expect(model.lights.length).toBeLessThanOrEqual(MAX_LIGHTS)
    expect(MAX_LIGHTS).toBe(1)
    expect(model.lights).toHaveLength(1)
    expect(model.lights.every((light) => light.kind === 'hemisphere')).toBe(true)
    // `groundColor` is what keeps a crate reading as a cube under one light:
    // an up-face takes the sky colour, an underside the ground colour, and a
    // single `ambientLight` would give a box six identical faces.
    expect(model.lights[0]?.groundColor).toBeTruthy()

    // The draw-call budget drops the truck count first, so it is the number
    // with the least slack.
    const trucks = model.models.filter((placement) => placement.asset === 'truck')
    expect(trucks.length).toBeLessThanOrEqual(2)
    expect(model.fixtures.filter((fixture) => fixture.kind === 'vehicle').length).toBeLessThanOrEqual(2)

    expect(model.pools.length).toBeLessThanOrEqual(MAX_INSTANCE_POOLS)
    // The four supply lanes share ONE pool with four offsets (§7.2).
    expect(new Set(model.pools.map((pool) => pool.id)).size).toBe(model.pools.length)
    },
  )

  it('every pile sign hangs clear of a full stack of its own crates', () => {
    // The other half of what a player called clipping. A capped stock floor of
    // 40 crates in the old 5 × 2 grid was four tiers and 4.76 m tall, and the
    // ON HAND sign hung at 3.2 — inside the pile, which is why the crates
    // "clipped" it. The grids are wide and low now, and this is the arithmetic
    // that keeps them so: a cap or a grid that grows a third tier fails here
    // rather than on a player's screen.
    //
    // `pileStackTop` is the model's own function, so this is not a second copy
    // of the geometry; it is the assertion that the sign heights and the pile
    // shapes were derived from the same number.
    const overhead = [
      ['inventory', PILE_SCALE.inventory.cap, PILE_GRID.inventory, 1],
      ['backlog', PILE_SCALE.backlog.cap, PILE_GRID.backlog, 1],
      ['production queue', PILE_SCALE.productionQueue.cap, PILE_GRID.productionQueue, 1],
      // The front receiving lane is drawn 1.15× (§4.2), so its stack is too.
      ['supply lane', PILE_SCALE.supplyLane.cap, PILE_GRID.supplyLane, FRONT_LANE_SCALE],
    ] as const

    for (const [label, cap, grid, scale] of overhead) {
      expect(pileStackTop(cap, grid) * scale, `${label} stack top`).toBeLessThan(
        SIGN_HEIGHT.pile,
      )
    }

    // And the bay's own totals clear the tallest thing standing under them.
    expect(pileStackTop(PILE_SCALE.supplyLane.cap, PILE_GRID.supplyLane) * FRONT_LANE_SCALE).toBeLessThan(
      SIGN_HEIGHT.bayTotal,
    )
  })

  it.each(ROLE_ORDER)('%s: signs and estimated draw calls stay under their ceilings', (role) => {
    // The half of AC 19 nothing counted. `MAX_LIGHTS` made Tequila's eighteen
    // point lights a red test rather than a frame-rate report nobody runs;
    // until now the sign count and the draw-call total had no such test, and
    // they had drifted to 48 signs and 188 estimated calls against §7.1's
    // "~16 signs" line and its ceiling of 90.
    //
    // This asserts against `MAX_DRAW_CALLS` — §7.1's ceiling and the number AC
    // 19 owes — and no longer against a ratchet above it. The gap the ratchet
    // stood in for was the architecture `FixtureMesh.tsx` drew as four rails,
    // two uprights and a post apiece; it is merged (`mergeParts`), the truck's
    // thirteen materials are baked into vertex colours, and the placard posts
    // are one `InstancedMesh`. The worst view of the twelve below measures 81.
    for (const [label, model] of [
      ['typical', modelFor(role)],
      ['maximal', maximal(role)],
      // The two variants that cost more than the maximal fixture does: an
      // empty stock floor is four quads of pallet ghost where a full one is
      // one pad, and a locked desk carries the SUBMITTED stamp as a sign.
      ['empty and locked', maximal(role, { inventory: 0 }, { locked: true })],
    ] as const) {
      expect(model.signs.length, `${role} ${label} signs`).toBeLessThanOrEqual(MAX_SIGNS)
      expect(estimateDrawCalls(model), `${role} ${label} draw calls`).toBeLessThanOrEqual(
        MAX_DRAW_CALLS,
      )
    }

    // §7.1's ceiling, stated here so the number AC 19 owes is in the test and
    // not only in the spec.
    expect(MAX_DRAW_CALLS).toBe(90)
  })

  it('a block of rows that shares a size and a colour is ONE sign, with the same words', () => {
    // A drei `<Text>` is one draw call whatever it says, so the ledger wall's
    // nine rows are a heading and one eight-line mesh under it rather than
    // nine meshes — and the words a player reads are unchanged, which is the
    // only thing about the fold a player could notice.
    const model = maximal('RETAILER')
    const ledger = model.signs.filter((item) => item.id.startsWith('ledger-row'))

    expect(ledger).toHaveLength(2)
    expect(ledger[1].text.split('\n').length).toBeGreaterThan(1)
    expect(ledger[1].text).toContain('Week cost')
    expect(ledger[1].text).toContain('Holding cost')

    // The team board's four plaques are one mesh while they agree, and break
    // only where the ink does — the colour is the signal (`19 §3.4`).
    const allWaiting = model.signs.filter((item) => item.id.startsWith('team-plaque'))
    expect(allWaiting).toHaveLength(1)
    expect(allWaiting[0].text.split('\n')).toHaveLength(ROLE_ORDER.length)

    const midWeek = modelFor('RETAILER', {}, { awaitingRoles: ['WHOLESALER'] })
    const plaques = midWeek.signs.filter((item) => item.id.startsWith('team-plaque'))
    expect(plaques.length).toBeGreaterThan(1)
    expect(plaques.map((item) => item.text).join('\n').split('\n')).toHaveLength(
      ROLE_ORDER.length,
    )
  })

  it('every pool gathered on the model belongs to a fixture that is still in the scene', () => {
    // One construction site: a fixture cannot be absent from the scene while
    // its crates are still drawn.
    const model = maximal('FACTORY')
    const owned = model.fixtures.flatMap((fixture) => (fixture.pool ? [fixture.pool] : []))
    expect(model.pools).toEqual(owned)
  })

  it('every crate pool wears a QUANTITY hex, never one reached for elsewhere (§3.8)', () => {
    // The rule is *"an accent hex is only ever applied to architecture, a
    // quantity hex only ever to crates"* — and it cannot be asserted as "the
    // two differ", because §3.8 says in as many words that two of them
    // collide: `--color-inventory` **is** `--color-role-retailer`, and
    // `--color-backlog` is one digit off `--color-role-factory`. The
    // assertable form of the rule is provenance: a pool's colour came out of
    // `QUANTITY_HEX`. A pool reaching into the wrong group is then visible
    // here rather than only in a screenshot of a Retailer's shop where the
    // walls and the stock are the same blue.
    const quantities = new Set<string>(Object.values(QUANTITY_HEX))
    for (const role of ROLE_ORDER) {
      for (const pool of maximal(role).pools) {
        expect(quantities.has(pool.color), `${pool.id} is not a quantity hex`).toBe(true)
      }
    }
  })

  it('every sign wears a TEXT hex, bar the one stamp §4.3 paints in --color-success', () => {
    const texts = new Set<string>([...Object.values(TEXT_HEX), ARCHITECTURE_HEX.success])
    for (const role of ROLE_ORDER) {
      for (const item of maximal(role).signs) {
        expect(texts.has(item.color), `sign ${item.id} is not a text hex`).toBe(true)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// §8.2 — boardViewChoice (§2.2, AC 1)
// ---------------------------------------------------------------------------

describe('resolveBoardView: localStorage → VITE_BOARD_VIEW → 2D', () => {
  it('a stored choice wins over the env', () => {
    expect(resolveBoardView('3D', '2D')).toBe('3D')
    expect(resolveBoardView('2D', '3D')).toBe('2D')
    expect(resolveBoardView('3D', undefined)).toBe('3D')
  })

  it('stored garbage falls through to the env rather than throwing', () => {
    // A stale or hand-edited key is somebody's leftover, not an error: the
    // resolution order already has an answer for "no preference", so a throw
    // would only turn a stale key into a broken game screen.
    expect(resolveBoardView('4D', '3D')).toBe('3D')
    expect(resolveBoardView('', '3D')).toBe('3D')
  })

  it('the env alone decides when nothing is stored', () => {
    expect(resolveBoardView(null, '3D')).toBe('3D')
    expect(resolveBoardView(undefined, '3D')).toBe('3D')
  })

  it('AC 1: neither set — and an unknown env value — is 2D', () => {
    expect(resolveBoardView(null, undefined)).toBe('2D')
    expect(resolveBoardView(null, null)).toBe('2D')
    expect(resolveBoardView('4D', 'sideways')).toBe('2D')
    expect(resolveBoardView(undefined, '')).toBe('2D')
  })
})

// ---------------------------------------------------------------------------
// §8.2 — contextLoss (§7.6.3, AC 21)
// ---------------------------------------------------------------------------

/** The repository root, found by walking up from wherever the runner started.
 *  `socketHandlers.test.ts` established this shape for the same reason it is
 *  needed here: a file that may not be imported can still be read. */
function projectRoot(): string {
  let dir = process.cwd()
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'src'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return process.cwd()
}

describe('AC 21: a lost WebGL context is heard, and does not cost a player their week', () => {
  // An ErrorBoundary catches a render throw — WebGL missing when the canvas
  // first mounts. It never hears about a context the GPU takes away twenty
  // minutes later on a driver reset: nothing throws, the canvas simply stops
  // painting, and the player is left staring at a frozen warehouse with a week
  // to submit. §7.6.3 says that must not happen, and until `contextLoss.ts`
  // was cut out of `Board3D.tsx` the whole of that path was code no test could
  // reach, because §8.1 forbids importing the component jsdom has no WebGL for.

  it('calls back when the canvas below the host loses its context', () => {
    const host = document.createElement('div')
    const canvas = document.createElement('canvas')
    host.append(canvas)
    document.body.append(host)

    let lost = 0
    const stop = observeContextLoss(host, () => {
      lost += 1
    })

    // Dispatched at the canvas, as a browser does — never at the host. The
    // capture phase is what carries it to the ancestor, and it is the reason
    // this file needs no `querySelector` for an element r3f owns.
    canvas.dispatchEvent(new Event(CONTEXT_LOST_EVENT, { bubbles: false, cancelable: true }))

    expect(lost).toBe(1)
    stop()
    host.remove()
  })

  it('preventDefaults the event, which is what claims the loss from the browser', () => {
    // Per the WebGL specification, a page that does not cancel this event has
    // told the browser to leave the canvas dead. We cancel it and then leave.
    const host = document.createElement('div')
    const canvas = document.createElement('canvas')
    host.append(canvas)
    document.body.append(host)

    const stop = observeContextLoss(host, () => {})
    const event = new Event(CONTEXT_LOST_EVENT, { bubbles: false, cancelable: true })
    canvas.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    stop()
    host.remove()
  })

  it('the returned unsubscribe really removes the listener', () => {
    // It is returned straight out of a `useEffect`, and under StrictMode that
    // effect runs twice. A cleanup that removed nothing would leave a second
    // listener behind on every remount.
    const host = document.createElement('div')
    const canvas = document.createElement('canvas')
    host.append(canvas)
    document.body.append(host)

    let lost = 0
    observeContextLoss(host, () => {
      lost += 1
    })()

    canvas.dispatchEvent(new Event(CONTEXT_LOST_EVENT, { bubbles: false, cancelable: true }))

    expect(lost).toBe(0)
    host.remove()
  })

  it('ignores an unrelated event on the same host', () => {
    const host = document.createElement('div')
    document.body.append(host)

    let lost = 0
    const stop = observeContextLoss(host, () => {
      lost += 1
    })

    host.dispatchEvent(new Event('webglcontextrestored', { cancelable: true }))
    host.dispatchEvent(new Event('click', { cancelable: true }))

    expect(lost).toBe(0)
    stop()
    host.remove()
  })

  describe('Board3D.tsx wires it to the SAME fallback the error boundary uses', () => {
    // Read rather than imported: §8.1 forbids this file from importing
    // `Board3D.tsx`, and `socketHandlers.test.ts` already reads `main.tsx` for
    // exactly this class of claim — an ordering or wiring fact that lives in a
    // module a test may not load. What is asserted is only the wiring, never
    // behaviour: the behaviour is the four tests above.
    const source = readFileSync(
      join(projectRoot(), 'src', 'components', 'game', 'views', 'Board3D.tsx'),
      'utf8',
    )

    it('subscribes through contextLoss.ts rather than binding its own listener', () => {
      expect(source).toMatch(/observeContextLoss/)
      // A second, inline copy of the subscription is the drift this extraction
      // exists to prevent — the same argument `playerMotion.ts` makes for the
      // typing guard (FM 6).
      expect(source).not.toMatch(/addEventListener\(\s*['"]webglcontextlost['"]/)
    })

    it('both the lost-context branch and the boundary render WebGLFallback', () => {
      // AC 21 is not "something else renders" — it is that the player lands on
      // the 2D board with the identical props and `'2D'` written to storage,
      // which is what `WebGLFallback` does, once, for both doors into it.
      expect(source).toMatch(/if\s*\(contextLost\)\s*return\s*<WebGLFallback\s*\{\.\.\.props\}\s*\/>/)
      expect(source).toMatch(/<ErrorBoundary\s+fallback=\{<WebGLFallback\s*\{\.\.\.props\}\s*\/>\}>/)
      expect(source.match(/<WebGLFallback\s*\{\.\.\.props\}/g) ?? []).toHaveLength(2)
    })
  })
})

// ---------------------------------------------------------------------------
// §8.2 — the other half of AC 19: shadow maps (§7.4, §7.5)
// ---------------------------------------------------------------------------

describe('AC 19: zero shadow maps, and castShadow written nowhere', () => {
  // The light count has had `MAX_LIGHTS` and a red test since the beginning.
  // The shadow half of the same criterion had neither: it was two sentences of
  // comment. §7.4 names the exact shape of the regression in Tequila — mesh
  // after mesh carrying `castShadow` while `shadows` is never enabled on the
  // `<Canvas>`, which costs nothing and looks like a feature until somebody
  // turns shadows on and the frame budget goes with it. Source is read rather
  // than imported for the reason §8.1 gives: jsdom has no WebGL, so this file
  // may not load `Board3D.tsx` or anything under `board3d/`.

  const VIEWS = join(projectRoot(), 'src', 'components', 'game', 'views')

  /** Comments name `castShadow` on purpose — §7.4's defect list does, in three
   *  files — so the scan below reads code only. */
  function codeOf(path: string): string {
    return readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
  }

  function boardSources(): string[] {
    const board3d = join(VIEWS, 'board3d')
    return [
      join(VIEWS, 'Board3D.tsx'),
      ...readdirSync(board3d)
        .filter((name) => name.endsWith('.ts') || name.endsWith('.tsx'))
        .map((name) => join(board3d, name)),
    ]
  }

  it('the Canvas is mounted with shadows off (§7.5)', () => {
    expect(codeOf(join(VIEWS, 'Board3D.tsx'))).toMatch(/shadows=\{false\}/)
  })

  it('no module in the 3D board sets castShadow or receiveShadow', () => {
    const offenders = boardSources().filter((path) => /(cast|receive)Shadow/.test(codeOf(path)))
    expect(offenders, 'shadow flags found in the 3D board').toEqual([])
  })

  it('is not vacuous: the scan does read the board\'s modules', () => {
    // A `readdirSync` that quietly returned nothing would make the test above
    // pass for the wrong reason, which is the failure mode §10 FM 3 names for
    // gates generally: assert on the list, never on its emptiness alone.
    const sources = boardSources()
    expect(sources.length).toBeGreaterThan(10)
    expect(codeOf(join(VIEWS, 'Board3D.tsx'))).toContain('Canvas')
  })
})

// ---------------------------------------------------------------------------
// §8.2 — BoardViewToggle (§2.4, AC 2, AC 22, §7.6)
// ---------------------------------------------------------------------------

describe('BoardViewToggle: a real button whose label names the destination', () => {
  it('offers 3D from the 2D board and 2D from the 3D board', () => {
    const { unmount } = render(<BoardViewToggle choice="2D" onChange={() => {}} />)
    const toTheWarehouse = screen.getByRole('button', { name: /switch to the 3d warehouse/i })
    expect(toTheWarehouse.tagName).toBe('BUTTON')
    expect(toTheWarehouse).not.toBeDisabled()
    unmount()

    render(<BoardViewToggle choice="3D" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: /switch to the 2d board/i })).toBeInTheDocument()
  })

  it('is not an ARIA toggle button — the label already says what pressing it does', () => {
    render(<BoardViewToggle choice="2D" onChange={() => {}} />)
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-pressed')
  })

  it('a click asks for the other board', async () => {
    // The write-through to localStorage is `useBoardViewChoice`'s, not the
    // button's: the toggle is a sibling of the board and owns no state
    // (§2.1). `GameRoomFlow.test.tsx` asserts the click lands `'3D'` in
    // storage through the real screen, and `storage.test.ts` asserts the
    // accessor pair.
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<BoardViewToggle choice="2D" onChange={onChange} />)

    await user.click(screen.getByRole('button'))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('3D')
  })

  it('AC 22: a coarse pointer disables it with the reason stated, never absent', () => {
    matchOnly('(pointer: coarse)')
    render(<BoardViewToggle choice="2D" onChange={() => {}} />)

    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
    // An absent control is one nobody can ask about, and a player on a tablet
    // beside a classmate on a laptop needs to be told why their screen differs.
    expect(screen.getByText('The 3D warehouse needs a keyboard and a mouse.')).toBeInTheDocument()
    expect(button).toHaveAttribute('aria-describedby')
  })

  it('FM 10: reduced motion still OFFERS 3D, but not silently', () => {
    // §7.6.2: 3D is offered under reduced motion, the toggle carries a warning
    // line, head-bob is never introduced at all, and the week-change lane lift
    // is replaced by the colour flash alone. The in-scene half of that is
    // `WarehouseScene`'s, which this file may not import; the offer and the
    // warning are here.
    matchOnly('(prefers-reduced-motion: reduce)')
    render(<BoardViewToggle choice="2D" onChange={() => {}} />)

    expect(screen.getByRole('button')).not.toBeDisabled()
    expect(
      screen.getByText(/the 3d warehouse moves the camera as you walk/i),
    ).toBeInTheDocument()
  })

  it('going back to 2D carries no reduced-motion warning — that is the recommendation', () => {
    matchOnly('(prefers-reduced-motion: reduce)')
    render(<BoardViewToggle choice="3D" onChange={() => {}} />)

    expect(screen.queryByText(/moves the camera as you walk/i)).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// §8.2 — Board3DPanels (§5.4, AC 14, AC 17, §10 FM 7)
// ---------------------------------------------------------------------------

describe('Board3DPanels: one DOM copy, two presentations', () => {
  function renderPanels(
    open: ReadonlyArray<'order-desk' | 'ledger-wall' | 'team-board'> = [],
    props: Partial<BoardViewProps> = {},
  ) {
    return render(
      <Board3DPanels
        {...propsFor('RETAILER', {}, props)}
        open={open}
        onClose={() => {}}
        canvasRef={{ current: null }}
      />,
    )
  }

  it('FM 7: there is exactly ONE "What you have" landmark, closed or open', () => {
    // The naive fix for §5.4 is to render the panels twice — once hidden for
    // the reader, once visible for the player — which puts two landmarks and
    // two history tables in the document and breaks AC 17.
    const { unmount } = renderPanels()
    expect(screen.getAllByLabelText('What you have')).toHaveLength(1)
    unmount()

    renderPanels(['ledger-wall'])
    expect(screen.getAllByLabelText('What you have')).toHaveLength(1)
  })

  it('AC 17: the settlement, the panel and the history are each reachable exactly once', () => {
    renderPanels()

    expect(screen.getAllByLabelText('What you have')).toHaveLength(1)
    expect(screen.getAllByLabelText('Your history')).toHaveLength(1)

    // `OwnHistoryChart`'s visually hidden table, with the player's own three
    // series — the surface `19 §2.6a` makes the chart assertable through. The
    // count, not just the presence: "exactly once in the DOM" is the whole
    // acceptance criterion, and every figure here is deliberately distinctive
    // so a second copy cannot hide behind an unrelated digit.
    const body = document.body.textContent ?? ''
    for (const figure of ['601', '701', '801', '603', '703', '803']) {
      expect(body.split(figure).length - 1, `${figure} is not in the DOM exactly once`).toBe(1)
    }
  })

  it('AC 14: the order desk renders the EXISTING DecisionForm, not a re-implementation', () => {
    renderPanels(['order-desk'])
    expect(screen.getAllByRole('spinbutton')).toHaveLength(1)
  })

  it('AC 14: locked renders WaitingForOthers, and gameOver the game-over panel', () => {
    const { unmount } = renderPanels(['order-desk'], { locked: true })
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Waiting for the other players')).toBeInTheDocument()
    unmount()

    renderPanels(['order-desk'], { gameOver: true })
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(document.body.textContent).toMatch(/the game is over/i)
  })

  it('a closed panel is sr-only; an open one gets chrome and a Close control', () => {
    const { unmount } = renderPanels()
    expect(document.querySelector('[data-panel="ledger-wall"]')?.className).toBe('sr-only')
    expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument()
    unmount()

    renderPanels(['ledger-wall'])
    const wrapper = document.querySelector('[data-panel="ledger-wall"]')
    expect(wrapper?.className).not.toBe('sr-only')
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument()
    // Still exactly one copy: the open presentation is the same node.
    expect(screen.getAllByLabelText('What you have')).toHaveLength(1)
  })

  it('all three panels are mounted at once, so opening one does not remount another', () => {
    renderPanels(['ledger-wall', 'order-desk'])

    for (const panel of ['order-desk', 'ledger-wall', 'team-board']) {
      expect(document.querySelector(`[data-panel="${panel}"]`)).not.toBeNull()
    }
  })
})

// ---------------------------------------------------------------------------
// §8.2 — Board3DHud (§5.5, §5.6, AC 15, AC 16)
// ---------------------------------------------------------------------------

describe('Board3DHud: words are DOM, never in-scene', () => {
  function renderHud(over: Partial<Parameters<typeof Board3DHud>[0]> = {}) {
    return render(
      <Board3DHud
        view={viewFor('RETAILER')}
        week={7}
        durationWeeks={36}
        prompt={null}
        notice={null}
        weekChanged={false}
        {...over}
      />,
    )
  }

  it('AC 16: a notice renders in a role="status" region, wherever the camera points', () => {
    renderHud({ notice: "You've changed this order too many times." })

    const statuses = screen.getAllByRole('status')
    expect(
      statuses.some((node) => node.textContent?.includes('changed this order too many times')),
    ).toBe(true)
  })

  it('the live regions are mounted whether or not they have anything to say', () => {
    // A `role="status"` that appears at the same moment as its text is a
    // region a screen reader may never announce.
    renderHud()
    const statuses = screen.getAllByRole('status')
    expect(statuses.length).toBeGreaterThanOrEqual(3)
    for (const node of statuses) expect(node).toHaveAttribute('aria-live', 'polite')
  })

  it('the interact prompt is polite and carries the model s own wording', () => {
    const prompt = deskPrompt(propsFor('FACTORY'))
    renderHud({ prompt })

    const carrier = screen
      .getAllByRole('status')
      .find((node) => node.textContent?.includes(prompt))
    expect(carrier).toBeDefined()
    expect(carrier).toHaveAttribute('aria-live', 'polite')
  })

  it('AC 15: weekChanged announces the week and what arrived, in the role s words', () => {
    const view = viewFor('RETAILER', { settlement: settlementFor('RETAILER', { arrived: 14 }) })
    renderHud({ view, weekChanged: true })

    const expected = `Week 7. ${RECEIPT_LABEL.RETAILER} 14.`
    expect(
      screen.getAllByRole('status').some((node) => node.textContent?.includes(expected)),
    ).toBe(true)
  })

  it('a quiet week says nothing — the announcement is empty until it turns over', () => {
    renderHud({ weekChanged: false })
    expect(document.body.textContent).not.toMatch(new RegExp(`${RECEIPT_LABEL.RETAILER} 14`))
  })

  it('the week strip and the controls legend are always there', () => {
    renderHud()
    expect(document.body.textContent).toContain('Week 7 of 36')
    expect(document.body.textContent).toContain('W A S D')
    expect(document.body.textContent).toContain('Esc')
  })
})

// ---------------------------------------------------------------------------
// §8.2 — Attribution (§6.1, AC 20)
// ---------------------------------------------------------------------------

describe('ModelAttribution: CC-BY is an attribution licence, not a polish item', () => {
  /** The four records, as `public/3dmodels/ATTRIBUTION.txt` carries them. */
  const CREDITS: ReadonlyArray<{ title: string; author: string; file: string }> = [
    { title: 'Box, Low Poly', author: 'FLAREMEDIA', file: 'box.glb' },
    { title: 'Low Poly Truck', author: 'Arifido._', file: 'truck.glb' },
    { title: 'FREE Mecha Chameleon Character Model!', author: 'xtiborz095', file: 'person.glb' },
    { title: 'Low Poly Stack of Money', author: 'Courvois', file: 'money.glb' },
  ]

  /**
   * Open the disclosure by its own property rather than by a click.
   *
   * A `<details>` is reachable by keyboard and readable by a screen reader
   * without any of the machinery a custom disclosure would need — but jsdom
   * applies no UA stylesheet, so whether a closed one's children are
   * "visible" to a role query is a property of the harness, not of the
   * component. Setting `open` removes the question from the test entirely.
   */
  function openCredits(): void {
    const details = document.querySelector('details')
    if (details instanceof HTMLDetailsElement) details.open = true
  }

  it('renders the four titles, the four authors and the licence', () => {
    render(<ModelAttribution />)
    openCredits()

    expect(screen.getByText('3D model credits')).toBeInTheDocument()
    for (const credit of CREDITS) {
      expect(screen.getByText(credit.title)).toBeInTheDocument()
      expect(screen.getByText(credit.author)).toBeInTheDocument()
    }
    expect(screen.getAllByText('CC-BY-4.0')).toHaveLength(CREDITS.length)
  })

  it('every source is a real <a href>, and every outbound link is noopener', () => {
    render(<ModelAttribution />)
    openCredits()

    for (const credit of CREDITS) {
      const link = screen.getByRole('link', { name: `Source (${credit.file})` })
      expect(link).toHaveAttribute('href', expect.stringContaining('sketchfab.com/3d-models/'))
    }

    const links = screen.getAllByRole('link')
    expect(links.length).toBeGreaterThanOrEqual(CREDITS.length * 3)
    for (const link of links) {
      // An attribution credit is not a place to hand a third party a
      // `window.opener` handle.
      expect(link.getAttribute('rel') ?? '').toContain('noopener')
      expect(link.getAttribute('href') ?? '').toMatch(/^https?:\/\//)
    }
  })
})
