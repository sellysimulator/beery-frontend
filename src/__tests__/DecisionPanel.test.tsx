/**
 * `19-frontend-game-room.md §2.2` — `DecisionPanel`, "what you have".
 *
 * Covers acceptance criteria 3, 4, 5, 6 (the panel half), 7, 8 and 23, and
 * failure modes 3, 8 and 13.
 *
 * Harness notes:
 *  - The panel is driven through `GameRoomPlaying`, not rendered directly.
 *    `17 §2.0` freezes the playing screen as taking **no props** and reading
 *    the store, and `§2.4` says every value on it comes from
 *    `useGameStore().myState`; no document freezes a prop shape for the
 *    components inside it, so addressing them directly would mean inventing
 *    one. Assertions are scoped to the panel's own region, located by the
 *    elements `§2.2` names.
 *  - `socket.io-client` is replaced by a recorder so nothing touches
 *    transport. The charting library is **not** mocked: `§2.6a` makes the
 *    chart's visually hidden table the section's surface for it.
 *  - Every fixture number is deliberately distinctive, so an assertion that a
 *    figure is present or absent cannot be satisfied by an unrelated digit.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ComponentType } from 'react';
import { render, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { useGameStore } from '../store/gameStore';
import { ROLE_ORDER } from '../types/game';
import type {
  GameConfig,
  PlayerView,
  Role,
  RoleConfig,
  WeekSettlement,
} from '../types/game';
import * as GameRoomPlayingModule from '../pages/GameRoomPlaying';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

type Listener = (...args: unknown[]) => void;

const rec = vi.hoisted(() => ({
  emits: [] as Array<{ event: string; payload: unknown }>,
  listeners: new Map<string, Listener[]>(),
}));

vi.mock('socket.io-client', () => {
  const add = (event: string, cb: Listener) => {
    rec.listeners.set(event, [...(rec.listeners.get(event) ?? []), cb]);
  };
  const socket: Record<string, unknown> = {
    id: 'test-sid',
    connected: true,
    on: (e: string, cb: Listener) => {
      add(e, cb);
      return socket;
    },
    once: (e: string, cb: Listener) => {
      add(e, cb);
      return socket;
    },
    off: (e: string) => {
      rec.listeners.delete(e);
      return socket;
    },
    removeAllListeners: () => {
      rec.listeners.clear();
      return socket;
    },
    emit: (event: string, payload: unknown) => {
      rec.emits.push({ event, payload });
      return socket;
    },
    connect: () => socket,
    disconnect: () => socket,
    io: { engine: { transport: { name: 'websocket' } } },
  };
  const io = () => socket;
  return { io, default: io, Socket: class {}, Manager: class {} };
});

type Renderable = ComponentType<Record<string, never>>;

function componentFrom(mod: unknown, name: string): Renderable {
  const found = (mod as Record<string, unknown>)[name] ?? (mod as Record<string, unknown>).default;
  if (typeof found !== 'function') {
    throw new Error(`${name} must be exported from src/pages/${name}.tsx (19, "Implementation agent writes").`);
  }
  return found as Renderable;
}

const GameRoomPlaying = componentFrom(GameRoomPlayingModule, 'GameRoomPlaying');

const ROOM = 'ABC234';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function roleConfig(): RoleConfig {
  return {
    initial_inventory: 12,
    initial_backlog: 0,
    shipping_delay_weeks: 2,
    information_delay_weeks: 2,
    initial_pipeline_quantity: 4,
    initial_order_in_pipeline: 4,
    holding_cost_per_unit_week: 0.5,
    backlog_cost_per_unit_week: 1,
    fixed_order_cost: 0,
    unit_purchase_cost: 0,
    starting_capital: 0,
  };
}

function gameConfig(): GameConfig {
  return {
    duration_weeks: 36,
    stage_count: 4,
    pause_on_disconnect: true,
    bot_fill_empty_roles: true,
    random_seed: 1,
    currency_symbol: '$',
    role_assignment_mode: 'HOST_ASSIGNS',
    preset_name: 'classic_mit',
    roles: {
      RETAILER: roleConfig(),
      WHOLESALER: roleConfig(),
      DISTRIBUTOR: roleConfig(),
      FACTORY: { ...roleConfig(), production_delay_weeks: 2, production_capacity_per_week: null },
    },
    demand: { kind: 'CONSTANT', value: 4 },
    visibility: {
      show_true_customer_demand_to_all: false,
      show_neighbour_inventory: false,
      show_all_inventories: false,
      show_supply_line_prominently: true,
      show_running_cost_to_players: true,
      show_leaderboard_during_game: false,
      max_order_quantity: null,
      allow_negative_orders: false,
    },
    bot: { theta: 0.36, alpha: 0.26, beta: 0.34, target_stock_multiplier: 1 },
  };
}

function settlementFor(role: Role): WeekSettlement {
  return {
    role,
    week: 6,
    opening_inventory: 12,
    opening_backlog: 0,
    arrived: 4,
    incoming_order: 8,
    obligation: 8,
    shipped: 8,
    unfulfilled: 0,
    closing_inventory: 8,
    closing_backlog: 0,
    holding_cost: 4,
    backlog_cost: 0,
    carrying_cost: 4,
  };
}

/**
 * The gated keys — `accumulated_cost`, `week_cost`, `balance`, `neighbours`,
 * `chain`, `leaderboard`, `customer_demand_series` — are all absent by
 * default, because their absence is exactly what criteria 6 and 23 turn on.
 */
function viewFor(role: Role, over: Partial<PlayerView> = {}): PlayerView {
  return {
    role,
    week: 6,
    duration_weeks: 36,
    phase: 'DECISION',
    currency_symbol: '$',
    inventory: 27,
    backlog: 0,
    supply_line: 103,
    supply_line_slots: [41, 62],
    orders_in_flight: role === 'FACTORY' ? 0 : 40,
    orders_in_flight_slots: role === 'FACTORY' ? [] : [17, 23],
    incoming_order: 55,
    last_order: 31,
    settlement: settlementFor(role),
    has_submitted: false,
    awaiting_roles: [...ROLE_ORDER],
    own_history: [],
    max_order_quantity: null,
    allow_negative_orders: false,
    show_supply_line_prominently: true,
    order_arrival_lead_weeks: 4,
    holding_cost_per_unit_week: 0.5,
    backlog_cost_per_unit_week: 1,
    ...over,
  };
}

let seq = 0;

function nextSeq(): number {
  seq += 1;
  return seq;
}

function renderPanel(view: PlayerView) {
  act(() => {
    const store = useGameStore.getState();
    store.setRoomCode(ROOM);
    store.applyGameStarted({
      seq: nextSeq(),
      week: view.week,
      duration_weeks: view.duration_weeks,
      role_to_alias: { RETAILER: 'P1', WHOLESALER: 'P2', DISTRIBUTOR: 'P3', FACTORY: 'P4' },
      bots: [],
      config_public: gameConfig(),
    });
    store.applyYourState({ seq: nextSeq(), ...view });
  });
  return render(
    <MemoryRouter initialEntries={[`/game/${ROOM}`]}>
      <Routes>
        <Route path="/game/:roomCode" element={<GameRoomPlaying />} />
      </Routes>
    </MemoryRouter>,
  );
}

function freshRender(view: PlayerView) {
  act(() => {
    useGameStore.getState().reset();
  });
  seq = 0;
  return renderPanel(view);
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function norm(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Rendered text with element boundaries preserved as spaces. `textContent`
 * glues adjacent elements together ("Incoming shipments" + "41" reads as
 * "shipments41"), which silently defeats every `\b`-anchored assertion.
 */
function textOf(node: Node | null | undefined): string {
  if (!node) return '';
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  while (walker.nextNode()) parts.push(walker.currentNode.nodeValue ?? '');
  return norm(parts.join(' '));
}

function bodyText(): string {
  return textOf(document.body);
}

function smallestMatching(res: RegExp[]): HTMLElement | null {
  const matches = Array.from(document.body.querySelectorAll<HTMLElement>('*'))
    .filter((el) => {
      const text = textOf(el);
      return res.every((r) => r.test(text));
    })
    .sort((a, b) => textOf(a).length - textOf(b).length);
  return matches[0] ?? null;
}

const ORDERS_PLACED = /orders\s+you[’'a-z ]{0,8}placed/i;

/** The panel's own region: the tightest block holding the §2.2 elements. */
function panelRegion(): HTMLElement {
  const found = smallestMatching([/on hand/i, /incoming shipment/i, /incoming order/i]);
  if (!found) {
    throw new Error(
      '§2.2 requires On hand, Incoming shipments and This week’s incoming order in one ' +
        `panel; the screen rendered: ${bodyText()}`,
    );
  }
  return found;
}

function panelText(): string {
  return textOf(panelRegion());
}

/** Where a label first appears inside the panel, for document-order checks. */
function positionOf(label: RegExp, what: string): number {
  const at = panelText().search(label);
  if (at < 0) throw new Error(`§2.2 requires "${what}" on the panel; ${label} matched nothing.`);
  return at;
}

/** Every attribute value in the panel, for "absent, not merely hidden" checks. */
function panelAttributes(): string {
  const parts: string[] = [];
  for (const el of Array.from(panelRegion().querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) parts.push(attr.value);
  }
  return parts.join(' ');
}

/** An icon is either an icon element or a non-ASCII glyph. */
function hasIcon(el: HTMLElement): boolean {
  if (el.querySelector('svg, img, [role="img"], [data-icon], [class*="icon"], [class*="Icon"]')) {
    return true;
  }
  return /[^\p{ASCII}]/u.test(el.textContent ?? '');
}

function classTokens(el: HTMLElement): Set<string> {
  return new Set((el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean));
}

/** The backlog block: the one that carries both the label and the word "owed". */
function backlogBlock(): HTMLElement {
  const found = smallestMatching([/backlog/i, /owed/i]);
  if (!found) throw new Error('§2.2 requires the backlog element to say "owed" when backlog > 0.');
  return found;
}

/** The neutral block beside it, for comparison. */
function onHandBlock(): HTMLElement {
  const found = smallestMatching([/on hand/i, /\b27\b/]);
  if (!found) throw new Error('§2.2 requires an On hand element carrying the inventory.');
  return found;
}

beforeEach(() => {
  seq = 0;
  act(() => {
    useGameStore.getState().reset();
  });
});

// ---------------------------------------------------------------------------
// Criterion 3 — the six elements, in the §2.2 order
// ---------------------------------------------------------------------------

describe('CRITERION 3: the panel renders the §2.2 elements in the §2.2 order', () => {
  function fullPanel() {
    return renderPanel(viewFor('WHOLESALER', { accumulated_cost: 88.75, week_cost: 9.25 }));
  }

  it('renders on hand, backlog, supply line, orders in flight, incoming order and costs', () => {
    fullPanel();

    const text = panelText();
    expect(text).toMatch(/on hand/i);
    expect(text).toMatch(/\b27\b/); // inventory
    expect(text).toMatch(/backlog/i);
    expect(text).toMatch(/incoming shipment/i);
    expect(text).toMatch(ORDERS_PLACED);
    expect(text).toMatch(/incoming order/i);
    expect(text).toMatch(/\b55\b/); // this week's incoming order
    expect(text).toMatch(/cost/i);
  });

  it('places them in the order §2.2 fixes, which is "always the same order"', () => {
    fullPanel();

    const order = [
      positionOf(/on hand/i, 'On hand'),
      positionOf(/backlog/i, 'Backlog'),
      positionOf(/incoming shipment/i, 'Incoming shipments'),
      positionOf(ORDERS_PLACED, "Orders you've placed"),
      positionOf(/incoming order/i, "This week's incoming order"),
      positionOf(/cost/i, 'Your costs'),
    ];

    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

// ---------------------------------------------------------------------------
// Criteria 4 and 5, failure mode 3 — the supply line
// ---------------------------------------------------------------------------

describe('CRITERION 4: the supply line renders slot by slot, plus the total', () => {
  it('renders every slot quantity', () => {
    renderPanel(viewFor('WHOLESALER'));

    const text = panelText();
    expect(text).toMatch(/\b41\b/);
    expect(text).toMatch(/\b62\b/);
  });

  it('labels each slot with the week it arrives in', () => {
    renderPanel(viewFor('WHOLESALER'));

    // Week 6 is open, so the front slot is "next week" (week 7) and the one
    // behind it "the week after" (week 8) — §2.2's own wording.
    const text = panelText();
    expect(text).toMatch(/next week|week\s*7\b/i);
    expect(text).toMatch(/the week after|week\s*8\b/i);
  });

  it('renders the slots front first, so the nearest arrival reads first', () => {
    renderPanel(viewFor('WHOLESALER'));

    const text = panelText();
    expect(text.indexOf('41')).toBeLessThan(text.indexOf('62'));
  });

  it('renders the total alongside the breakdown', () => {
    renderPanel(viewFor('WHOLESALER'));

    expect(panelText()).toMatch(/\b103\b/);
  });
});

describe('CRITERION 5 / FAILURE MODE 3: show_supply_line_prominently false collapses it', () => {
  function collapsed() {
    return renderPanel(viewFor('WHOLESALER', { show_supply_line_prominently: false }));
  }

  it('still renders the bare total', () => {
    collapsed();

    expect(panelText()).toMatch(/incoming shipment/i);
    expect(panelText()).toMatch(/\b103\b/);
  });

  it('renders no per-slot breakdown at all', () => {
    collapsed();

    expect(panelText()).not.toMatch(/\b41\b/);
    expect(panelText()).not.toMatch(/\b62\b/);
  });

  it('keeps the breakdown out of the DOM, not merely out of sight', () => {
    // "A host turned it off deliberately." `textContent` ignores CSS, so the
    // check above already defeats `display: none`; this one closes the
    // remaining route — a slot smuggled into an attribute a tooltip reads.
    collapsed();

    expect(panelAttributes()).not.toMatch(/\b41\b/);
    expect(panelAttributes()).not.toMatch(/\b62\b/);
  });
});

// ---------------------------------------------------------------------------
// Criterion 7 and failure mode 13 — whose order pipeline this is
// ---------------------------------------------------------------------------

describe('CRITERION 7: "Orders you’ve placed" is absent for the Factory', () => {
  it('omits the block for the FACTORY, which has no supplier to reach', () => {
    renderPanel(viewFor('FACTORY'));

    expect(panelText()).not.toMatch(ORDERS_PLACED);
  });

  const downstream: Role[] = ['RETAILER', 'WHOLESALER', 'DISTRIBUTOR'];

  it.each(downstream)('renders the block slot by slot for %s', (role) => {
    renderPanel(viewFor(role));

    const text = panelText();
    expect(text).toMatch(ORDERS_PLACED);
    expect(text).toMatch(/\b17\b/);
    expect(text).toMatch(/\b23\b/);
  });

  it('counts the Factory’s production order in the supply line instead', () => {
    // `07 §3.8`: the production order enters the Factory's own production
    // pipeline, where the supply line already counts it, so there is no
    // second place for it to appear.
    renderPanel(viewFor('FACTORY'));

    const text = panelText();
    expect(text).toMatch(/incoming shipment/i);
    expect(text).toMatch(/\b103\b/);
  });
});

describe('FAILURE MODE 13: the block follows orders_in_flight_slots, not the role', () => {
  // `07 §3.8` warns that the naive wiring sends the role's *own* order
  // pipeline — the downstream neighbour's orders travelling towards it, which
  // is next week's demand. A screen that decides by role rather than by the
  // field it was sent renders exactly that. The payloads here are inverted
  // against what the real server sends, and the screen must follow the
  // payload.
  it('renders the block for a Retailer that was sent slots', () => {
    renderPanel(viewFor('RETAILER', { orders_in_flight: 40, orders_in_flight_slots: [17, 23] }));

    const text = panelText();
    expect(text).toMatch(ORDERS_PLACED);
    expect(text).toMatch(/\b17\b/);
    expect(text).toMatch(/\b23\b/);
  });

  it('omits the block for a Factory that was sent none', () => {
    renderPanel(viewFor('FACTORY', { orders_in_flight: 0, orders_in_flight_slots: [] }));

    expect(panelText()).not.toMatch(ORDERS_PLACED);
  });

  it('puts no order-pipeline quantity on the Factory’s screen at all', () => {
    renderPanel(viewFor('FACTORY', { orders_in_flight: 0, orders_in_flight_slots: [] }));

    const text = panelText();
    expect(text).not.toMatch(/\b17\b/);
    expect(text).not.toMatch(/\b23\b/);
  });
});

// ---------------------------------------------------------------------------
// Criterion 8 and failure mode 8 — backlog is never colour alone
// ---------------------------------------------------------------------------

describe('CRITERION 8 / FAILURE MODE 8: backlog > 0 is colour AND icon AND "owed"', () => {
  function withBacklog() {
    return renderPanel(viewFor('WHOLESALER', { backlog: 19 }));
  }

  it('renders the word "owed" in the accessible text, independent of any styling', () => {
    withBacklog();

    // This is the assertion that survives a stylesheet being switched off.
    expect(panelText()).toMatch(/owed/i);
    expect(textOf(backlogBlock())).toMatch(/owed/i);
  });

  it('renders the backlog quantity next to the word', () => {
    withBacklog();

    expect(textOf(backlogBlock())).toMatch(/\b19\b/);
  });

  it('renders an icon as well as the word', () => {
    withBacklog();

    expect(hasIcon(backlogBlock())).toBe(true);
  });

  it('renders an alarming colour as well as the icon and the word', () => {
    // The colour is whatever the design system calls it, so what is asserted
    // is that the block is styled differently from the neutral On hand block
    // beside it — the "colour" of "colour AND icon AND the word".
    withBacklog();

    const alarmed = classTokens(backlogBlock());
    const neutral = classTokens(onHandBlock());
    expect([...alarmed].some((token) => !neutral.has(token))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Criterion 23 — the six conditional blocks, asserted independently
// ---------------------------------------------------------------------------

describe('CRITERION 23: each conditional block renders only when its flag is set', () => {
  it('1/6 supply-line prominence: the breakdown appears only with the flag on', () => {
    const on = freshRender(viewFor('WHOLESALER', { show_supply_line_prominently: true }));
    expect(panelText()).toMatch(/\b41\b/);
    on.unmount();

    freshRender(viewFor('WHOLESALER', { show_supply_line_prominently: false }));
    expect(panelText()).not.toMatch(/\b41\b/);
  });

  it('2/6 running cost: the figures appear only when the gated keys are sent', () => {
    const off = freshRender(viewFor('WHOLESALER'));
    expect(bodyText()).not.toMatch(/88\.75/);
    expect(bodyText()).not.toMatch(/9\.25/);
    off.unmount();

    freshRender(viewFor('WHOLESALER', { accumulated_cost: 88.75, week_cost: 9.25 }));
    expect(bodyText()).toMatch(/88\.75/);
    expect(bodyText()).toMatch(/9\.25/);
  });

  it('3/6 neighbour inventories: only when `neighbours` is sent', () => {
    const off = freshRender(viewFor('WHOLESALER'));
    expect(bodyText()).not.toMatch(/\b611\b/);
    off.unmount();

    freshRender(
      viewFor('WHOLESALER', {
        neighbours: {
          RETAILER: { inventory: 611, backlog: 0 },
          DISTRIBUTOR: { inventory: 622, backlog: 0 },
        },
      }),
    );
    expect(bodyText()).toMatch(/\b611\b/);
    expect(bodyText()).toMatch(/\b622\b/);
  });

  it('4/6 the full chain: only when `chain` is sent', () => {
    const off = freshRender(viewFor('WHOLESALER'));
    expect(bodyText()).not.toMatch(/\b711\b/);
    off.unmount();

    freshRender(
      viewFor('WHOLESALER', {
        chain: {
          RETAILER: { inventory: 711, backlog: 0 },
          WHOLESALER: { inventory: 712, backlog: 0 },
          DISTRIBUTOR: { inventory: 713, backlog: 0 },
          FACTORY: { inventory: 714, backlog: 0 },
        },
      }),
    );
    const text = bodyText();
    expect(text).toMatch(/\b711\b/);
    expect(text).toMatch(/\b714\b/);
  });

  it('5/6 the leaderboard: only when `leaderboard` is sent', () => {
    const off = freshRender(viewFor('WHOLESALER'));
    expect(bodyText()).not.toMatch(/811\.50/);
    off.unmount();

    freshRender(
      viewFor('WHOLESALER', {
        leaderboard: [
          { role: 'RETAILER', accumulated_cost: 811.5 },
          { role: 'WHOLESALER', accumulated_cost: 812.5 },
        ],
      }),
    );
    expect(bodyText()).toMatch(/811\.50/);
  });

  it('6/6 the true customer demand series: only when it is sent', () => {
    const off = freshRender(viewFor('WHOLESALER'));
    expect(bodyText()).not.toMatch(/\b901\b/);
    off.unmount();

    freshRender(viewFor('WHOLESALER', { customer_demand_series: [901, 902, 903] }));
    expect(bodyText()).toMatch(/\b901\b/);
  });
});

// ---------------------------------------------------------------------------
// Criterion 6 — the panel half: no running total anywhere on the screen
// ---------------------------------------------------------------------------

describe('CRITERION 6: with show_running_cost_to_players off, no running total appears', () => {
  it('renders neither an accumulated cost, a week cost nor a balance', () => {
    renderPanel(viewFor('WHOLESALER'));

    const html = document.body.innerHTML;
    expect(html).not.toContain('88.75');
    expect(html).not.toContain('9.25');
    expect(bodyText()).not.toMatch(/total so far/i);
    expect(bodyText()).not.toMatch(/balance/i);
  });
});
