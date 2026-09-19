/**
 * `19-frontend-game-room.md §2.3` — `DecisionForm`, "what you can do".
 *
 * Covers acceptance criteria 9, 10, 11, 12, 13 and 25, and failure modes 5, 6,
 * 10 and 14.
 *
 * Harness notes:
 *  - The form is driven through `GameRoomPlaying`, not rendered directly.
 *    `17 §2.0` freezes the playing screen as taking **no props** and reading
 *    the store; no document freezes a prop shape for the components inside
 *    it, so addressing one directly would mean inventing one. Assertions are
 *    scoped to the form's own region.
 *  - `socket.io-client` is replaced by a recorder, so `src/api/socket.ts` and
 *    `src/api/games.ts` run as real, un-mocked code while nothing touches
 *    transport. What is asserted is therefore what goes on the wire
 *    (`12 §2`), not the name of any client function.
 *  - The charting library is **not** mocked: `§2.6a` makes the chart's
 *    visually hidden table the section's surface for it, and the canvas is
 *    wrapped so a missing 2D context degrades to that table.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ComponentType } from 'react';
import { render, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
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

function settlementFor(role: Role, week: number): WeekSettlement {
  return {
    role,
    week,
    opening_inventory: 12,
    opening_backlog: 0,
    arrived: 4,
    incoming_order: 55,
    obligation: 55,
    shipped: 55,
    unfulfilled: 0,
    closing_inventory: 8,
    closing_backlog: 0,
    holding_cost: 4,
    backlog_cost: 0,
    carrying_cost: 4,
  };
}

/**
 * The fixture carries 1, 3, 4 and 5 in other, delay-shaped fields, so that a
 * preview reassembled out of anything but `order_arrival_lead_weeks` names a
 * different week (failure mode 12).
 */
function viewFor(role: Role, over: Partial<PlayerView> = {}): PlayerView {
  const week = typeof over.week === 'number' ? over.week : 6;
  return {
    role,
    week,
    duration_weeks: 36,
    phase: 'DECISION',
    currency_symbol: '$',
    inventory: 27,
    backlog: 0,
    supply_line: 8,
    supply_line_slots: [3, 5],
    orders_in_flight: role === 'FACTORY' ? 0 : 5,
    orders_in_flight_slots: role === 'FACTORY' ? [] : [1, 4],
    incoming_order: 55,
    last_order: 31,
    settlement: settlementFor(role, week),
    has_submitted: false,
    awaiting_roles: [...ROLE_ORDER],
    own_history: [],
    max_order_quantity: null,
    allow_negative_orders: false,
    show_supply_line_prominently: true,
    // `07 §3.8`: the Factory's unstarted production, `null` for the others.
    production_queue: role === 'FACTORY' ? 34 : null,
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

/** Puts the store where a started, running game would put it. */
function renderForm(view: PlayerView) {
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
// DOM and wire helpers
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

function emitsOf(event: string): Array<Record<string, unknown>> {
  return rec.emits
    .filter((e) => e.event === event)
    .map((e) => (e.payload ?? {}) as Record<string, unknown>);
}

/** `§2.3`: "One numeric input: how many units to order from your supplier." */
function orderInput(): HTMLInputElement {
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input'));
  const found = inputs.find((i) => i.type === 'number') ?? inputs[0];
  if (!found) throw new Error('§2.3 requires one numeric input for the order quantity.');
  return found;
}

function controlMatching(re: RegExp, what: string): HTMLElement {
  const matches = Array.from(
    document.querySelectorAll<HTMLElement>('button, [role="button"], input, a[href]'),
  )
    .filter((el) => re.test(textOf(el)) || re.test(el.getAttribute('aria-label') ?? ''))
    .sort((a, b) => textOf(a).length - textOf(b).length);
  if (matches.length === 0) {
    throw new Error(`§2.3 requires a control for "${what}"; nothing matched ${re}.`);
  }
  return matches[0];
}

function confirmControl(): HTMLElement {
  return controlMatching(/confirm/i, 'Confirm');
}

/** The decision form's own region, so panel copy cannot satisfy its assertions. */
function formRegion(): HTMLElement {
  const input = orderInput();
  const form = input.closest('form');
  if (form) return form;
  let el: HTMLElement | null = input.parentElement;
  const confirm = confirmControl();
  while (el && !el.contains(confirm)) el = el.parentElement;
  if (!el) throw new Error('§2.3 requires the input, the quick-fills and Confirm in one form.');
  return el;
}

function formText(): string {
  return textOf(formRegion());
}

function isDisabled(el: HTMLElement): boolean {
  return el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
}

async function typeOrder(user: UserEvent, qty: string): Promise<void> {
  const input = orderInput();
  await user.clear(input);
  await user.type(input, qty);
}

/** Tab order from wherever focus is, until it comes back round. */
async function tabOrder(user: UserEvent, limit = 60): Promise<HTMLElement[]> {
  const seen: HTMLElement[] = [];
  for (let i = 0; i < limit; i += 1) {
    await user.tab();
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) continue;
    if (seen.includes(el)) break;
    seen.push(el);
  }
  return seen;
}

async function tabTo(user: UserEvent, target: HTMLElement, limit = 60): Promise<boolean> {
  for (let i = 0; i < limit; i += 1) {
    await user.tab();
    if (document.activeElement === target) return true;
  }
  return false;
}

beforeEach(() => {
  seq = 0;
  rec.emits.length = 0;
  act(() => {
    useGameStore.getState().reset();
  });
});

// ---------------------------------------------------------------------------
// Criterion 9 — the constraints are stated, not only enforced
// ---------------------------------------------------------------------------

describe('CRITERION 9: the minimum and the maximum are stated in text', () => {
  it('states a minimum of 0 and the configured maximum', () => {
    renderForm(viewFor('WHOLESALER', { max_order_quantity: 500 }));

    const text = formText();
    expect(text).toMatch(/min(imum)?\b[^0-9-]{0,14}0\b/i);
    expect(text).toMatch(/max(imum)?\b[^0-9]{0,14}500\b/i);
  });

  it('states that there is no minimum once allow_negative_orders is set', () => {
    // §2.3: "the form states that there is no minimum and sets no `min`
    // attribute". There is no negative floor on the wire.
    renderForm(viewFor('WHOLESALER', { max_order_quantity: 500, allow_negative_orders: true }));

    const text = formText();
    expect(text).toMatch(/min(imum)?/i);
    expect(text).not.toMatch(/min(imum)?\b[^0-9-]{0,14}0\b/i);
  });

  it('sets no `min` attribute, and invents no floor, when negatives are allowed', () => {
    // Deriving a floor from `max_order_quantity` would be client-side game
    // arithmetic (§2.3, 00-conventions §4).
    renderForm(viewFor('WHOLESALER', { max_order_quantity: 500, allow_negative_orders: true }));

    expect(orderInput().hasAttribute('min')).toBe(false);
    expect(formText()).not.toMatch(/-\s*500\b/);
    expect(formText()).not.toMatch(/min(imum)?\b[^0-9]{0,14}-\d/i);
  });

  it('states the constraint as text, not only as an input attribute', () => {
    // "Stated as text, not only enforced" — an input's `max` attribute is
    // invisible to a player wondering why their order was clamped.
    renderForm(viewFor('WHOLESALER', { max_order_quantity: 500 }));

    expect(formText()).toContain('500');
  });
});

// ---------------------------------------------------------------------------
// Criteria 10 and 11, failure mode 12 — the arrival preview
// ---------------------------------------------------------------------------

describe('CRITERION 10: the preview names week + order_arrival_lead_weeks', () => {
  it('names week 10 for week 6 and a lead of 4', async () => {
    const user = userEvent.setup();
    renderForm(viewFor('WHOLESALER', { week: 6, order_arrival_lead_weeks: 4 }));

    await typeOrder(user, '7');

    const text = formText();
    expect(text).toMatch(/week\s*10\b/i);
    expect(text).toMatch(/\b4\s*weeks?\b/i);
  });

  it('follows the lead field when it changes, not a remembered number', async () => {
    const user = userEvent.setup();
    renderForm(viewFor('WHOLESALER', { week: 6, order_arrival_lead_weeks: 1 }));

    await typeOrder(user, '12');

    expect(formText()).toMatch(/week\s*7\b/i);
  });
});

describe('CRITERION 11: the Factory produces rather than orders', () => {
  it('labels the input as production for the Factory', () => {
    renderForm(viewFor('FACTORY'));

    expect(formText()).toMatch(/produc/i);
  });

  it('labels the input as an order for a downstream role', () => {
    renderForm(viewFor('WHOLESALER'));

    const text = formText();
    expect(text).toMatch(/order/i);
    expect(text).not.toMatch(/produc/i);
  });
});

describe('FAILURE MODE 14: the preview is never reassembled from other numbers', () => {
  // `§3.8`: no per-role delay is sent at all, precisely so this cannot be
  // attempted. Only `order_arrival_lead_weeks` is 2, so week + 2 = 8 is the
  // single right answer for the Factory and for a downstream role alike.
  const roles: Role[] = ['FACTORY', 'WHOLESALER'];

  it.each(roles)('%s names week 8 for week 6 and a lead of 2', async (role) => {
    const user = userEvent.setup();
    renderForm(viewFor(role, { week: 6, order_arrival_lead_weeks: 2 }));

    await typeOrder(user, '12');

    const text = formText();
    expect(text).toMatch(/week\s*8\b/i);
    expect(text).not.toMatch(/week\s*(7|9|10|11)\b/i);
  });
});

// ---------------------------------------------------------------------------
// Criterion 12 — the quick-fill buttons
// ---------------------------------------------------------------------------

describe('CRITERION 12: the three quick-fill buttons fill the right numbers', () => {
  it('"Match incoming order" fills this week’s incoming order', async () => {
    const user = userEvent.setup();
    renderForm(viewFor('WHOLESALER', { incoming_order: 55 }));

    await user.click(controlMatching(/match/i, 'Match incoming order'));

    expect(orderInput().value).toBe('55');
  });

  it('"Repeat last order" fills last_order', async () => {
    const user = userEvent.setup();
    renderForm(viewFor('WHOLESALER', { last_order: 31 }));

    await user.click(controlMatching(/repeat/i, 'Repeat last order'));

    expect(orderInput().value).toBe('31');
  });

  it('"Order zero" fills 0', async () => {
    const user = userEvent.setup();
    renderForm(viewFor('WHOLESALER'));

    await user.click(controlMatching(/zero/i, 'Order zero'));

    expect(orderInput().value).toBe('0');
  });

  it('a quick-fill does not submit by itself', async () => {
    const user = userEvent.setup();
    renderForm(viewFor('WHOLESALER'));

    await user.click(controlMatching(/match/i, 'Match incoming order'));

    expect(emitsOf('submit_order')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Criterion 13 and failure modes 5 and 6 — what goes on the wire
// ---------------------------------------------------------------------------

describe('CRITERION 13: confirming emits submit_order for the open week', () => {
  it('emits the open week and the entered quantity', async () => {
    const user = userEvent.setup();
    renderForm(viewFor('WHOLESALER', { week: 6 }));

    await typeOrder(user, '37');
    await user.click(confirmControl());

    expect(emitsOf('submit_order')).toEqual([{ room_id: ROOM, week: 6, order: 37 }]);
  });

  it('sends the order as a number, never as the input’s string', async () => {
    const user = userEvent.setup();
    renderForm(viewFor('WHOLESALER'));

    await typeOrder(user, '37');
    await user.click(confirmControl());

    expect(typeof emitsOf('submit_order')[0].order).toBe('number');
  });
});

describe('FAILURE MODE 5: no client-computed total reaches the wire', () => {
  it('emits exactly {room_id, week, order}', async () => {
    const user = userEvent.setup();
    renderForm(viewFor('WHOLESALER', { accumulated_cost: 88.75, week_cost: 9.25 }));

    await typeOrder(user, '37');
    await user.click(confirmControl());

    const payload = emitsOf('submit_order')[0];
    expect(Object.keys(payload).sort()).toEqual(['order', 'room_id', 'week']);
  });

  it('puts no display-only figure on the wire, on any emit', async () => {
    const user = userEvent.setup();
    renderForm(viewFor('WHOLESALER', { accumulated_cost: 88.75, week_cost: 9.25 }));

    await typeOrder(user, '37');
    await user.click(confirmControl());

    const forbidden = ['accumulated_cost', 'week_cost', 'balance', 'total', 'inventory', 'backlog'];
    const keys = rec.emits.flatMap((e) => Object.keys((e.payload ?? {}) as object));
    for (const key of forbidden) expect(keys).not.toContain(key);
  });
});

describe('FAILURE MODE 6: the emitted week is the client’s believed open week', () => {
  it('emits week 5 when the store is on week 5, so STALE_WEEK has something to compare', async () => {
    const user = userEvent.setup();
    renderForm(viewFor('WHOLESALER', { week: 5 }));

    await typeOrder(user, '37');
    await user.click(confirmControl());

    expect(emitsOf('submit_order')[0].week).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Failure mode 10 — submission while paused
// ---------------------------------------------------------------------------

describe('FAILURE MODE 10: a paused game cannot be submitted into', () => {
  /**
   * The order is entered first, and the control checked enabled, so that
   * "disabled while paused" cannot pass against a form that simply never
   * enables it.
   */
  async function readyThenPause(user: UserEvent) {
    renderForm(viewFor('WHOLESALER'));
    await typeOrder(user, '37');
    expect(isDisabled(confirmControl())).toBe(false);
    act(() => {
      useGameStore
        .getState()
        .applyGamePaused({ seq: nextSeq(), reason: 'The host has paused the game.' });
    });
  }

  it('disables the confirm control', async () => {
    const user = userEvent.setup();
    await readyThenPause(user);

    expect(isDisabled(confirmControl())).toBe(true);
  });

  it('emits nothing when the disabled control is clicked', async () => {
    const user = userEvent.setup();
    await readyThenPause(user);

    await user.click(confirmControl());

    expect(emitsOf('submit_order')).toHaveLength(0);
  });

  it('emits again once the host resumes', async () => {
    const user = userEvent.setup();
    await readyThenPause(user);

    act(() => {
      useGameStore.getState().applyGameResumed({ seq: nextSeq() });
    });
    await user.click(confirmControl());

    expect(emitsOf('submit_order')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Criterion 25 — keyboard alone
// ---------------------------------------------------------------------------

describe('CRITERION 25: the input, quick-fills and confirm are keyboard-operable', () => {
  it('reaches every control by Tab', async () => {
    const user = userEvent.setup();
    renderForm(viewFor('WHOLESALER'));

    const input = orderInput();
    expect(await tabTo(user, input)).toBe(true);
    // Confirm is legitimately disabled while the field is empty, so it can
    // only be tabbed to once there is an order to confirm.
    await user.keyboard('37');
    const reachable = await tabOrder(user);

    expect(reachable).toContain(controlMatching(/match/i, 'Match incoming order'));
    expect(reachable).toContain(controlMatching(/repeat/i, 'Repeat last order'));
    expect(reachable).toContain(controlMatching(/zero/i, 'Order zero'));
    expect(reachable).toContain(confirmControl());
  });

  it('uses real buttons for the quick-fills, not clickable divs', () => {
    renderForm(viewFor('WHOLESALER'));

    for (const [re, what] of [
      [/match/i, 'Match incoming order'],
      [/repeat/i, 'Repeat last order'],
      [/zero/i, 'Order zero'],
    ] as Array<[RegExp, string]>) {
      const el = controlMatching(re, what);
      expect(el.tagName === 'BUTTON' || el.getAttribute('role') === 'button').toBe(true);
    }
  });

  it('submits with the keyboard alone, never touching the mouse', async () => {
    const user = userEvent.setup();
    renderForm(viewFor('WHOLESALER', { week: 6 }));

    expect(await tabTo(user, orderInput())).toBe(true);
    await user.keyboard('37');
    expect(await tabTo(user, confirmControl())).toBe(true);
    await user.keyboard('{Enter}');

    expect(emitsOf('submit_order')).toEqual([{ room_id: ROOM, week: 6, order: 37 }]);
  });
});
