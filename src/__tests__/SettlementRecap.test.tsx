/**
 * `19-frontend-game-room.md §2.5` and `§2.5a` — `SettlementRecap`.
 *
 * Covers acceptance criteria 6 (the recap half), 18, 19 and 20, and failure
 * modes 4 and 7.
 *
 * Harness notes:
 *  - The recap is driven through `GameRoomPlaying`, not rendered directly.
 *    `17 §2.0` freezes the playing screen as taking **no props** and reading
 *    the store, and `§2.4` says every value on it comes from
 *    `useGameStore().myState`; no document freezes a prop shape for the
 *    components inside it, so addressing one directly would mean inventing
 *    one. Ledger assertions are scoped to the recap's own table, which `§3.4`
 *    requires it to be.
 *  - `socket.io-client` is replaced by a recorder so nothing touches
 *    transport. The charting library is **not** mocked: `§2.6a` makes the
 *    chart's visually hidden table the section's surface for it.
 *  - The numbers are `§2.5a`'s normative fixture: the Retailer's week 6 under
 *    the Classic MIT preset, and the ledger printed in `§2.5`.
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
// Fixtures — §2.5a is normative and its numbers are hard-coded
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

function settlementFor(role: Role, over: Partial<WeekSettlement> = {}): WeekSettlement {
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
    ...over,
  };
}

/**
 * The required half of `PlayerView`. `accumulated_cost`, `week_cost` and
 * `balance` are deliberately absent: they are the keys
 * `show_running_cost_to_players` gates, and their absence is criterion 6.
 */
function viewFor(role: Role, over: Partial<PlayerView> = {}): PlayerView {
  return {
    role,
    week: 6,
    duration_weeks: 36,
    phase: 'DECISION',
    currency_symbol: '$',
    inventory: 8,
    backlog: 0,
    supply_line: 0,
    supply_line_slots: [],
    orders_in_flight: role === 'FACTORY' ? 0 : 40,
    orders_in_flight_slots: role === 'FACTORY' ? [] : [17, 23],
    incoming_order: 8,
    last_order: 8,
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

/** `§2.5a` exactly: the fixture criterion 18 asserts against. */
function fixtureView(): PlayerView {
  return viewFor('RETAILER', { accumulated_cost: 21.5, week_cost: 4 });
}

let seq = 0;

function nextSeq(): number {
  seq += 1;
  return seq;
}

function renderRecap(view: PlayerView) {
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

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function norm(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Rendered text with element boundaries preserved as spaces. `textContent`
 * glues adjacent elements together, which silently defeats every
 * `\b`-anchored assertion.
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

/**
 * `§3.4`: "The recap is a semantic table with row headers, so a screen reader
 * reads it as a ledger." The recap is the table that carries the cost lines.
 */
function recapTable(): HTMLElement {
  const tables = Array.from(document.querySelectorAll<HTMLElement>('table, [role="table"]'));
  const found = tables.find((t) => /holding cost/i.test(textOf(t)));
  if (!found) {
    throw new Error(
      '§3.4 requires the recap to be a semantic table with row headers; no table carried the ' +
        `§2.5 ledger. The screen rendered: ${bodyText()}`,
    );
  }
  return found;
}

function recapText(): string {
  return textOf(recapTable());
}

function ledgerRows(): string[] {
  return Array.from(recapTable().querySelectorAll<HTMLElement>('tr, [role="row"]')).map((r) =>
    textOf(r),
  );
}

function rowIndex(label: RegExp): number {
  const rows = ledgerRows();
  const index = rows.findIndex((r) => label.test(r));
  if (index < 0) {
    throw new Error(
      `No ledger row matched ${label}. §2.5 fixes the ledger's shape line for line. Rows were:\n` +
        rows.map((r) => `  - ${r}`).join('\n'),
    );
  }
  return index;
}

function row(label: RegExp): string {
  return ledgerRows()[rowIndex(label)];
}

beforeEach(() => {
  seq = 0;
  act(() => {
    useGameStore.getState().reset();
  });
});

// ---------------------------------------------------------------------------
// Criterion 18 — the §2.5a fixture, line for line
// ---------------------------------------------------------------------------

describe('CRITERION 18: the recap reproduces the §2.5 ledger for the §2.5a fixture', () => {
  it('names the week the settlement belongs to', () => {
    renderRecap(fixtureView());

    expect(bodyText()).toMatch(/week\s*6\s*settlement/i);
  });

  it('renders the arrival line: +4, inventory 12 to 16', () => {
    renderRecap(fixtureView());

    const line = row(/received/i);
    expect(line).toMatch(/wholesaler/i);
    expect(line).toMatch(/\b4\b/);
    expect(line).toMatch(/\b12\b/);
    expect(line).toMatch(/\b16\b/);
  });

  it('renders the demand line: customer ordered 8', () => {
    renderRecap(fixtureView());

    expect(row(/customer ordered/i)).toMatch(/\b8\b/);
  });

  it('renders the shipping line: shipped 8, inventory 16 to 8', () => {
    renderRecap(fixtureView());

    const line = row(/shipped/i);
    expect(line).toMatch(/\b8\b/);
    expect(line).toMatch(/\b16\b/);
  });

  it('renders the unfulfilled line: 0, backlog 0', () => {
    renderRecap(fixtureView());

    const line = row(/unfulfilled/i);
    expect(line).toMatch(/\b0\b/);
    expect(line).toMatch(/backlog/i);
  });

  it('renders the holding-cost line: 8 units x $0.50 = $4.00', () => {
    renderRecap(fixtureView());

    const line = row(/holding cost/i);
    expect(line).toMatch(/8\s*units/i);
    expect(line).toMatch(/\$0\.50/);
    expect(line).toMatch(/\$4\.00/);
  });

  it('renders the backlog-cost line: 0 units x $1.00 = $0.00', () => {
    renderRecap(fixtureView());

    const line = row(/backlog cost/i);
    expect(line).toMatch(/0\s*units/i);
    expect(line).toMatch(/\$1\.00/);
    expect(line).toMatch(/\$0\.00/);
  });

  it('renders the week-cost line from settlement.carrying_cost', () => {
    renderRecap(fixtureView());

    expect(row(/week cost/i)).toMatch(/\$4\.00/);
  });

  it('renders the running total from your_state.accumulated_cost', () => {
    renderRecap(fixtureView());

    expect(row(/total so far/i)).toMatch(/\$21\.50/);
  });

  it('renders the nine lines in the §2.5 order', () => {
    renderRecap(fixtureView());

    const order = [
      rowIndex(/received/i),
      rowIndex(/customer ordered/i),
      rowIndex(/shipped/i),
      rowIndex(/unfulfilled/i),
      rowIndex(/holding cost/i),
      rowIndex(/backlog cost/i),
      rowIndex(/week cost/i),
      rowIndex(/total so far/i),
    ];

    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(order).size).toBe(order.length);
  });

  it('uses the configured currency symbol rather than a hardcoded one', () => {
    renderRecap(
      viewFor('RETAILER', { currency_symbol: '€', accumulated_cost: 21.5, week_cost: 4 }),
    );

    expect(row(/week cost/i)).toMatch(/€\s*4\.00/);
    expect(bodyText()).not.toMatch(/\$/);
  });
});

// ---------------------------------------------------------------------------
// Criterion 19 — the supplier and customer lines name the real neighbours
// ---------------------------------------------------------------------------

describe('CRITERION 19: the ledger names this role’s actual neighbours', () => {
  const upstream: Array<[Role, RegExp]> = [
    ['RETAILER', /wholesaler/i],
    ['WHOLESALER', /distributor/i],
    ['DISTRIBUTOR', /factory/i],
  ];

  it.each(upstream)('%s receives from its upstream neighbour', (role, supplier) => {
    renderRecap(viewFor(role, { accumulated_cost: 21.5, week_cost: 4 }));

    expect(row(/received/i)).toMatch(supplier);
  });

  it('the Factory receives "Finished production", not a supplier name', () => {
    renderRecap(viewFor('FACTORY', { accumulated_cost: 21.5, week_cost: 4 }));

    expect(recapText()).toMatch(/finished production/i);
    expect(recapText()).not.toMatch(/received from/i);
  });

  const downstream: Array<[Role, RegExp]> = [
    ['RETAILER', /customer ordered/i],
    ['WHOLESALER', /retailer ordered/i],
    ['DISTRIBUTOR', /wholesaler ordered/i],
    ['FACTORY', /distributor ordered/i],
  ];

  it.each(downstream)('%s shows its downstream customer on the demand line', (role, label) => {
    renderRecap(viewFor(role, { accumulated_cost: 21.5, week_cost: 4 }));

    expect(row(label)).toMatch(/\b8\b/);
  });
});

// ---------------------------------------------------------------------------
// Criterion 20 — D8's balance replaces the running total
// ---------------------------------------------------------------------------

describe('CRITERION 20: with starting_capital > 0 the last line is a Balance', () => {
  it('reads "Balance" and shows starting_capital - accumulated_cost', () => {
    // D8: the server sends the transform; 978.50 = 1000.00 - 21.50.
    renderRecap(viewFor('RETAILER', { accumulated_cost: 21.5, week_cost: 4, balance: 978.5 }));

    expect(row(/balance/i)).toMatch(/\$978\.50/);
    expect(recapText()).not.toMatch(/total so far/i);
  });

  it('keeps the week’s own lines unchanged, because D8 is a display transform', () => {
    renderRecap(viewFor('RETAILER', { accumulated_cost: 21.5, week_cost: 4, balance: 978.5 }));

    expect(row(/holding cost/i)).toMatch(/\$4\.00/);
    expect(row(/week cost/i)).toMatch(/\$4\.00/);
  });
});

// ---------------------------------------------------------------------------
// Criterion 6 — show_running_cost_to_players off
// ---------------------------------------------------------------------------

describe('CRITERION 6: with the running cost hidden, the last line is absent', () => {
  it('omits the running total entirely when the gated keys are absent', () => {
    // §3.8: `accumulated_cost`, `week_cost` and `balance` are simply not sent.
    renderRecap(viewFor('RETAILER'));

    expect(bodyText()).not.toMatch(/total so far/i);
    expect(bodyText()).not.toMatch(/balance/i);
    expect(bodyText()).not.toMatch(/21\.50/);
    expect(document.body.innerHTML).not.toMatch(/21\.50/);
  });

  it('still renders the week’s own cost lines, which come from settlement', () => {
    renderRecap(viewFor('RETAILER'));

    expect(row(/holding cost/i)).toMatch(/\$4\.00/);
    expect(row(/backlog cost/i)).toMatch(/\$0\.00/);
    expect(row(/week cost/i)).toMatch(/\$4\.00/);
  });
});

// ---------------------------------------------------------------------------
// Failure mode 4 — client-computed cost
// ---------------------------------------------------------------------------

describe('FAILURE MODE 4: the money figure is the server’s, never a product', () => {
  it('renders settlement.holding_cost even when it contradicts units x rate', () => {
    // 8 closing units x $0.50 would be $4.00. The server says $99.00, and the
    // server is the only authority (00-conventions §4).
    renderRecap(
      viewFor('RETAILER', {
        settlement: settlementFor('RETAILER', { holding_cost: 99, carrying_cost: 99 }),
        accumulated_cost: 21.5,
        week_cost: 99,
      }),
    );

    const line = row(/holding cost/i);
    expect(line).toMatch(/\$99\.00/);
    expect(line).not.toMatch(/\$4\.00/);
  });

  it('renders settlement.backlog_cost even when it contradicts units x rate', () => {
    // 3 closing backlog units x $1.00 would be $3.00; the server says $7.25.
    renderRecap(
      viewFor('RETAILER', {
        settlement: settlementFor('RETAILER', {
          closing_backlog: 3,
          backlog_cost: 7.25,
          carrying_cost: 11.25,
        }),
        accumulated_cost: 21.5,
        week_cost: 11.25,
      }),
    );

    const line = row(/backlog cost/i);
    expect(line).toMatch(/\$7\.25/);
    expect(line).not.toMatch(/\$3\.00/);
  });

  it('renders settlement.carrying_cost as the week cost, not holding + backlog', () => {
    // holding 4.00 + backlog 7.25 would be 11.25; the server says 12.75.
    renderRecap(
      viewFor('RETAILER', {
        settlement: settlementFor('RETAILER', {
          closing_backlog: 3,
          backlog_cost: 7.25,
          carrying_cost: 12.75,
        }),
        accumulated_cost: 21.5,
        week_cost: 12.75,
      }),
    );

    const line = row(/week cost/i);
    expect(line).toMatch(/\$12\.75/);
    expect(line).not.toMatch(/\$11\.25/);
  });
});

// ---------------------------------------------------------------------------
// Failure mode 7 — recap arithmetic drift
// ---------------------------------------------------------------------------

describe('FAILURE MODE 7: "Unfulfilled" is the payload’s field, not a subtraction', () => {
  it('renders settlement.unfulfilled when shipped < obligation', () => {
    // obligation 10 - shipped 6 would be 4. The payload says 3.
    renderRecap(
      viewFor('RETAILER', {
        settlement: settlementFor('RETAILER', {
          opening_backlog: 2,
          incoming_order: 8,
          obligation: 10,
          shipped: 6,
          unfulfilled: 3,
          closing_inventory: 10,
          closing_backlog: 3,
          holding_cost: 5,
          backlog_cost: 3,
          carrying_cost: 8,
        }),
        accumulated_cost: 21.5,
        week_cost: 8,
      }),
    );

    const line = row(/unfulfilled/i);
    expect(line).toMatch(/\b3\b/);
    expect(line).not.toMatch(/\b4\b/);
  });

  it('renders settlement.closing_backlog on the same line', () => {
    renderRecap(
      viewFor('RETAILER', {
        settlement: settlementFor('RETAILER', {
          opening_backlog: 2,
          incoming_order: 8,
          obligation: 10,
          shipped: 6,
          unfulfilled: 3,
          closing_inventory: 10,
          closing_backlog: 9,
          holding_cost: 5,
          backlog_cost: 9,
          carrying_cost: 14,
        }),
        accumulated_cost: 21.5,
        week_cost: 14,
      }),
    );

    expect(row(/unfulfilled/i)).toMatch(/\b9\b/);
  });
});
