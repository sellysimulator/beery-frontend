/**
 * `19-frontend-game-room.md §2.1`, `§2.4`, `§2.6`, `§2.7`, `§3.2`, `§3.3` —
 * `GameRoomPlaying`, the whole playing screen.
 *
 * Covers acceptance criteria 1, 2, 14, 15, 16, 17, 21, 22 and 24, and failure
 * modes 1, 2, 9 and 11.
 *
 * Criterion 17 goes through `useGameStore().lastError` (`§2.4`, `16 §3`), and
 * criterion 21 through the chart's visually hidden table (`§2.6a`).
 *
 * Harness notes:
 *  - `socket.io-client` is replaced by a recorder, so `src/api/socket.ts`,
 *    `src/api/socketHandlers.ts` and `src/api/games.ts` run as real,
 *    un-mocked code while nothing touches transport. Server -> client events
 *    are delivered by calling what was registered, exactly as the transport
 *    would; client -> server emits are asserted as wire payloads (`12 §2`).
 *  - The charting library is **not** mocked. `§2.6a` makes the chart's
 *    visually hidden three-series table the section's surface for it, and the
 *    canvas is wrapped so a missing 2D context degrades to that table, so
 *    criterion 21 reads the table.
 *  - Game state is driven through section 16's frozen store actions
 *    (`16 §3`); the screen takes no props (`17 §2.0`).
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import type { ComponentType } from 'react';
import { render, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { useGameStore } from '../store/gameStore';
import { ROLE_ORDER } from '../types/game';
import type {
  GameConfig,
  PlayerView,
  Role,
  RoleConfig,
  WeekRecord,
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
    off: (e: string, cb?: Listener) => {
      if (!cb) rec.listeners.delete(e);
      else rec.listeners.set(e, (rec.listeners.get(e) ?? []).filter((l) => l !== cb));
      return socket;
    },
    removeAllListeners: (e?: string) => {
      if (e) rec.listeners.delete(e);
      else rec.listeners.clear();
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


const firebaseStub = vi.hoisted(
  () =>
    (extra: Record<string, unknown> = {}) =>
      new Proxy(
        { ...extra },
        {
          get(target: Record<string, unknown>, prop: string | symbol) {
            if (prop in target) return target[prop as string];
            if (prop === '__esModule') return true;
            if (typeof prop !== 'string' || prop === 'then') return undefined;
            return vi.fn();
          },
        },
      ),
);

vi.mock('firebase/app', () =>
  firebaseStub({
    initializeApp: vi.fn(() => ({ name: 'test' })),
    getApps: vi.fn(() => []),
    getApp: vi.fn(() => ({ name: 'test' })),
  }),
);

vi.mock('firebase/auth', () =>
  firebaseStub({
    getAuth: vi.fn(() => ({ currentUser: null })),
    // firebase.ts uses initializeAuth, not getAuth, so that no popup/redirect
    // resolver is registered at start-up. Both are stubbed: the Proxy default
    // would hand back a vi.fn() returning undefined, and `auth` would then be
    // undefined for every consumer that reads `auth.currentUser`.
    initializeAuth: vi.fn(() => ({ currentUser: null })),
    // These are imported by name, and vitest validates named exports against
    // the object returned here before the Proxy's get trap ever runs, so each
    // one has to be present explicitly. Their values are never inspected:
    // firebase.ts only hands the persistences to initializeAuth, and
    // AuthContext passes the resolver straight to signInWithPopup.
    indexedDBLocalPersistence: {},
    browserLocalPersistence: {},
    browserPopupRedirectResolver: {},
    onAuthStateChanged: vi.fn(() => () => {}),
    GoogleAuthProvider: class {},
  }),
);

vi.mock('../api/health', () => ({ checkHealth: vi.fn(async () => true) }));

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

/** Distinctive series, so a chart assertion cannot pass on a coincidence. */
const OWN_INVENTORY = [301, 302, 303, 304, 305, 306];
const OWN_BACKLOG = [401, 402, 403, 404, 405, 406];
const OWN_ORDERS = [501, 502, 503, 504, 505, 506];

function ownHistory(role: Role): WeekRecord[] {
  return OWN_INVENTORY.map((inventory, index) => ({
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
    closing_backlog: OWN_BACKLOG[index],
    supply_line_after: 10,
    orders_in_flight_after: 10,
    order: OWN_ORDERS[index],
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
  }));
}

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
    supply_line: 103,
    supply_line_slots: [41, 62],
    orders_in_flight: role === 'FACTORY' ? 0 : 40,
    orders_in_flight_slots: role === 'FACTORY' ? [] : [17, 23],
    incoming_order: 55,
    last_order: 31,
    settlement: settlementFor(role, week),
    has_submitted: false,
    awaiting_roles: [...ROLE_ORDER],
    own_history: ownHistory(role),
    max_order_quantity: 500,
    allow_negative_orders: false,
    show_supply_line_prominently: true,
    // `07 §3.8`: the Factory's unstarted production, `null` for the others.
    production_queue: role === 'FACTORY' ? 34 : null,
    order_arrival_lead_weeks: 4,
    holding_cost_per_unit_week: 0.5,
    backlog_cost_per_unit_week: 1,
    accumulated_cost: 21.5,
    week_cost: 4,
    ...over,
  };
}

let seq = 0;

function nextSeq(): number {
  seq += 1;
  return seq;
}

function startGame(week = 6): void {
  act(() => {
    const store = useGameStore.getState();
    store.setRoomCode(ROOM);
    store.applyGameStarted({
      seq: nextSeq(),
      week,
      duration_weeks: 36,
      role_to_alias: { RETAILER: 'P1', WHOLESALER: 'P2', DISTRIBUTOR: 'P3', FACTORY: 'P4' },
      bots: [],
      config_public: gameConfig(),
    });
  });
}

function deliverState(view: PlayerView): void {
  act(() => {
    useGameStore.getState().applyYourState({ seq: nextSeq(), ...view });
  });
}

function renderScreen() {
  return render(
    <MemoryRouter initialEntries={[`/game/${ROOM}`]}>
      <Routes>
        <Route path="/game/:roomCode" element={<GameRoomPlaying />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** A started game showing `role`'s week-6 state. */
function renderPlaying(role: Role = 'RETAILER', over: Partial<PlayerView> = {}) {
  startGame(typeof over.week === 'number' ? over.week : 6);
  deliverState(viewFor(role, over));
  return renderScreen();
}

// ---------------------------------------------------------------------------
// DOM and wire helpers
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

function emitsOf(event: string): Array<Record<string, unknown>> {
  return rec.emits
    .filter((e) => e.event === event)
    .map((e) => (e.payload ?? {}) as Record<string, unknown>);
}

/** Deliver a server -> client event to whatever registered for it. */
function dispatch(event: string, payload?: unknown): void {
  const listeners = [...(rec.listeners.get(event) ?? [])];
  if (listeners.length === 0) {
    throw new Error(
      `Nothing is listening for "${event}". 12 §2 makes it a server -> client event, and ` +
        'nothing on the playing screen or in section 16’s handlers registered for it.',
    );
  }
  act(() => {
    for (const cb of listeners) cb(payload);
  });
}

function smallestMatching(predicate: (text: string, el: HTMLElement) => boolean): HTMLElement | null {
  const matches = Array.from(document.body.querySelectorAll<HTMLElement>('*'))
    .filter((el) => predicate(textOf(el), el))
    .sort((a, b) => textOf(a).length - textOf(b).length);
  return matches[0] ?? null;
}

function blockMatching(re: RegExp, what: string): HTMLElement {
  const found = smallestMatching((text) => re.test(text));
  if (!found) throw new Error(`Nothing rendered "${what}" (${re}).`);
  return found;
}

function orderInput(): HTMLInputElement | null {
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input'));
  return inputs.find((i) => i.type === 'number') ?? inputs[0] ?? null;
}

function requireOrderInput(): HTMLInputElement {
  const input = orderInput();
  if (!input) throw new Error('§2.3 requires one numeric input for the order quantity.');
  return input;
}

function controlMatching(re: RegExp, what: string): HTMLElement {
  const matches = Array.from(
    document.querySelectorAll<HTMLElement>('button, [role="button"], input, a[href]'),
  )
    .filter((el) => re.test(textOf(el)) || re.test(el.getAttribute('aria-label') ?? ''))
    .sort((a, b) => textOf(a).length - textOf(b).length);
  if (matches.length === 0) throw new Error(`No control for "${what}" (${re}).`);
  return matches[0];
}

function isDisabled(el: HTMLElement): boolean {
  return el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
}

function isNumericText(text: string): boolean {
  return /^-?\d+(?:\.\d+)?$/.test(text.replace(/[\s,]/g, ''));
}

/**
 * `§2.6a`: the chart "also renders the same three series as a visually hidden
 * table — one row per week". That table, not the canvas, is this section's
 * surface for the chart. It is the table that is not the settlement recap.
 */
function historyTable(): HTMLElement {
  const tables = Array.from(document.querySelectorAll<HTMLElement>('table, [role="table"]'));
  const found = tables.find((t) => !/holding cost/i.test(textOf(t)));
  if (!found) {
    throw new Error(
      '\u00a72.6a requires the chart to render its three series as a table as well as a canvas; ' +
        `no such table was rendered. The screen rendered: ${bodyText()}`,
    );
  }
  return found;
}

/** The table's data rows: the ones whose every cell is a number. */
function historyRows(): number[][] {
  const rows = Array.from(historyTable().querySelectorAll<HTMLElement>('tr, [role="row"]'));
  const data: number[][] = [];
  for (const row of rows) {
    const cells = Array.from(
      row.querySelectorAll<HTMLElement>('td, th, [role="cell"], [role="rowheader"]'),
    ).map((cell) => textOf(cell));
    if (cells.length > 0 && cells.every(isNumericText)) data.push(cells.map(Number));
  }
  return data;
}

/** The three series columns, with the week column dropped. */
function historySeries(): number[][] {
  const rows = historyRows();
  if (rows.length === 0) throw new Error('\u00a72.6a requires one table row per week played.');
  const weeks = rows.map((_, index) => index + 1).join(',');
  const columns = rows[0].map((_, index) => rows.map((row) => row[index]));
  return columns.filter((column) => column.join(',') !== weeks);
}

/** The waiting tick-list: the tightest block that is about waiting and names every role. */
function tickList(): HTMLElement {
  const found = smallestMatching(
    (text) => /waiting/i.test(text) && ROLE_ORDER.every((r) => new RegExp(r, 'i').test(text)),
  );
  if (!found) {
    throw new Error(
      '§2.4 requires a live tick-list naming every role beside the waiting message; ' +
        `the screen rendered: ${bodyText()}`,
    );
  }
  return found;
}

function tickRow(role: Role): HTMLElement {
  const pattern = new RegExp(role, 'i');
  const list = tickList();
  const matches = Array.from(list.querySelectorAll<HTMLElement>('*'))
    .filter((el) => pattern.test(textOf(el)))
    .sort((a, b) => textOf(a).length - textOf(b).length);
  if (matches.length === 0) throw new Error(`The tick-list does not name ${role}.`);
  return matches[0];
}

/** A row's text with the role name removed, so two rows can be compared. */
function tickState(role: Role): string {
  return textOf(tickRow(role))
    .replace(new RegExp(role, 'gi'), '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

async function submitOrder(user: ReturnType<typeof userEvent.setup>, qty: string): Promise<void> {
  const input = requireOrderInput();
  await user.clear(input);
  await user.type(input, qty);
  await user.click(controlMatching(/confirm/i, 'Confirm'));
}

beforeAll(async () => {
  // The mocks above must be in place first, then the socket module builds the
  // client, then the handler module registers against it — `main.tsx`'s order.
  await import('../api/socket');
  await import('../api/socketHandlers');
});

beforeEach(() => {
  seq = 0;
  rec.emits.length = 0;
  act(() => {
    useGameStore.getState().reset();
  });
});

// ---------------------------------------------------------------------------
// Criterion 1 — the RoleBanner
// ---------------------------------------------------------------------------

describe('CRITERION 1: the banner names the role and both neighbours', () => {
  const chain: Array<[Role, RegExp, RegExp]> = [
    ['RETAILER', /buy[\s\S]{0,40}?wholesaler/i, /sell[\s\S]{0,40}?customer/i],
    ['WHOLESALER', /buy[\s\S]{0,40}?distributor/i, /sell[\s\S]{0,40}?retailer/i],
    ['DISTRIBUTOR', /buy[\s\S]{0,40}?factory/i, /sell[\s\S]{0,40}?wholesaler/i],
  ];

  it.each(chain)('%s buys from and sells to the right neighbours', (role, upstream, downstream) => {
    renderPlaying(role);

    const text = bodyText();
    expect(text).toMatch(new RegExp(role, 'i'));
    expect(text).toMatch(upstream);
    expect(text).toMatch(downstream);
  });

  it('the Factory produces rather than buying, and sells to the Distributor', () => {
    renderPlaying('FACTORY');

    const text = bodyText();
    expect(text).toMatch(/factory/i);
    expect(text).toMatch(/produc/i);
    expect(text).toMatch(/sell[\s\S]{0,40}?distributor/i);
    expect(text).not.toMatch(/buy[\s\S]{0,40}?(retailer|wholesaler|distributor)/i);
  });

  it('names the week and the duration', () => {
    renderPlaying('RETAILER');

    expect(bodyText()).toMatch(/week\s*6\s*of\s*36/i);
  });
});

// ---------------------------------------------------------------------------
// Criterion 2 — D6, no timer
// ---------------------------------------------------------------------------

describe('CRITERION 2: nothing on the screen is a timer (D6)', () => {
  it('renders no countdown, deadline or remaining-time text', () => {
    renderPlaying('RETAILER');

    const text = bodyText();
    expect(text).not.toMatch(/countdown/i);
    expect(text).not.toMatch(/\btimer\b/i);
    expect(text).not.toMatch(/time (remaining|left)/i);
    expect(text).not.toMatch(/seconds? (remaining|left)/i);
    expect(text).not.toMatch(/deadline/i);
  });

  it('exposes no element with the timer role', () => {
    renderPlaying('RETAILER');

    expect(document.querySelector('[role="timer"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Failure mode 2 — the supply line comes first
// ---------------------------------------------------------------------------

describe('FAILURE MODE 2: the supply line precedes the decision input', () => {
  it('puts the supply line above the order input in document order', () => {
    renderPlaying('RETAILER');

    const supplyLine = blockMatching(/incoming shipment/i, 'the supply line');
    const input = requireOrderInput();

    expect(supplyLine.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Criteria 14, 15, 16 and failure modes 1 and 9 — the locked state
// ---------------------------------------------------------------------------

describe('CRITERION 14: after submitting, the locked state replaces the form', () => {
  async function submitAndLock() {
    const user = userEvent.setup();
    renderPlaying('RETAILER');
    await submitOrder(user, '7');
    // The server echoes the new truth (§3.1): this role has submitted, and
    // the Distributor and the Factory have not.
    deliverState(
      viewFor('RETAILER', {
        has_submitted: true,
        awaiting_roles: ['DISTRIBUTOR', 'FACTORY'],
      }),
    );
    return user;
  }

  it('shows the submitted-and-waiting message', async () => {
    await submitAndLock();

    const text = bodyText();
    expect(text).toMatch(/order submitted/i);
    expect(text).toMatch(/waiting/i);
  });

  it('shows a tick-list naming all four roles', async () => {
    await submitAndLock();

    const list = textOf(tickList());
    for (const role of ROLE_ORDER) expect(list).toMatch(new RegExp(role, 'i'));
  });

  it('offers "Change my order" (§7 Phase B lets a player change until the window closes)', async () => {
    await submitAndLock();

    expect(controlMatching(/change my order/i, 'Change my order')).toBeTruthy();
  });

  it('FAILURE MODE 9: each role carries a submitted-or-awaiting state of its own', async () => {
    await submitAndLock();

    // Two roles have submitted and two have not, so the two states must read
    // differently; the two roles sharing a state must read the same.
    expect(tickState('DISTRIBUTOR')).toBe(tickState('FACTORY'));
    expect(tickState('WHOLESALER')).not.toBe(tickState('DISTRIBUTOR'));
    expect(tickState('RETAILER')).not.toBe(tickState('DISTRIBUTOR'));
    for (const role of ROLE_ORDER) expect(tickState(role)).not.toBe('');
  });

  it('CRITERION 15: no row in the tick-list carries a quantity', async () => {
    await submitAndLock();

    // A standalone number token. An alias such as "P1" is a name, not a
    // quantity, and `\b\d+\b` does not match inside it.
    for (const role of ROLE_ORDER) {
      expect(textOf(tickRow(role))).not.toMatch(/\b\d+\b/);
    }
  });

  it('CRITERION 15: the whole tick-list carries no order quantity', async () => {
    await submitAndLock();

    // 7 is this player's own order; §2.4 says the list is names only, for
    // every role including the one reading it.
    expect(textOf(tickList())).not.toMatch(/\b7\b/);
  });
});

describe('CRITERION 16: "Change my order" reopens the form, pre-filled', () => {
  it('returns to the form with the submitted quantity already in it', async () => {
    const user = userEvent.setup();
    renderPlaying('RETAILER');
    await submitOrder(user, '7');
    deliverState(
      viewFor('RETAILER', { has_submitted: true, awaiting_roles: ['DISTRIBUTOR', 'FACTORY'] }),
    );

    await user.click(controlMatching(/change my order/i, 'Change my order'));

    expect(requireOrderInput().value).toBe('7');
  });

  it('emits submit_order again with the replacement quantity', async () => {
    const user = userEvent.setup();
    renderPlaying('RETAILER');
    await submitOrder(user, '7');
    deliverState(
      viewFor('RETAILER', { has_submitted: true, awaiting_roles: ['DISTRIBUTOR', 'FACTORY'] }),
    );

    await user.click(controlMatching(/change my order/i, 'Change my order'));
    await submitOrder(user, '9');

    expect(emitsOf('submit_order')).toEqual([
      { room_id: ROOM, week: 6, order: 7 },
      { room_id: ROOM, week: 6, order: 9 },
    ]);
  });
});

describe('CRITERION 17: TOO_MANY_SUBMISSIONS is explained, and the lock stays', () => {
  /**
   * The code reaches this screen through `useGameStore().lastError` (§2.4,
   * `16 §3`). The `error` event is still delivered over the recorded socket,
   * because that is the real route: section 16's handler is what writes the
   * store, and driving the store's writer rather than the store keeps the
   * whole channel under test.
   */
  async function lockThenRefuse() {
    const user = userEvent.setup();
    renderPlaying('RETAILER');
    await submitOrder(user, '7');
    deliverState(
      viewFor('RETAILER', { has_submitted: true, awaiting_roles: ['DISTRIBUTOR', 'FACTORY'] }),
    );
    dispatch('error', {
      message: 'Too many submissions for this week.',
      code: 'TOO_MANY_SUBMISSIONS',
    });
  }

  it('reads the code from the store, registering no listener of its own', () => {
    // §2.4: "This screen must not register its own `socket.on('error')`
    // listener" — StrictMode double-registers one and a reconnect leaves it
    // stale, which is why the store is the wire's single reader.
    const before = (rec.listeners.get('error') ?? []).length;

    renderPlaying('RETAILER');

    expect((rec.listeners.get('error') ?? []).length).toBe(before);
  });

  it('writes the refusal into the store’s lastError', async () => {
    await lockThenRefuse();

    expect(useGameStore.getState().lastError).toEqual({
      message: 'Too many submissions for this week.',
      code: 'TOO_MANY_SUBMISSIONS',
    });
  });

  it('renders the message §2.4 fixes', async () => {
    await lockThenRefuse();

    expect(bodyText()).toMatch(
      /You['’]ve changed this order too many times\.?\s*Your last order stands\./i,
    );
  });

  it('leaves the locked state in place', async () => {
    await lockThenRefuse();

    expect(controlMatching(/change my order/i, 'Change my order')).toBeTruthy();
    expect(textOf(tickList())).toMatch(/waiting/i);
  });

  it('does not show that message for some other error code', async () => {
    // The control that keeps the assertion above honest: the copy belongs to
    // TOO_MANY_SUBMISSIONS, not to every `error` the server can send.
    const user = userEvent.setup();
    renderPlaying('RETAILER');
    await submitOrder(user, '7');
    deliverState(
      viewFor('RETAILER', { has_submitted: true, awaiting_roles: ['DISTRIBUTOR', 'FACTORY'] }),
    );

    dispatch('error', { message: 'That week is already closed.', code: 'STALE_WEEK' });

    expect(bodyText()).not.toMatch(/changed this order too many times/i);
  });
});

describe('FAILURE MODE 1: no other player’s order is ever visible', () => {
  it('shows none of the other three quantities at any point in the week', async () => {
    const user = userEvent.setup();
    const others = ['313', '517', '719'];
    const seen: string[] = [];

    renderPlaying('RETAILER');
    seen.push(bodyText());

    await submitOrder(user, '7');
    seen.push(bodyText());

    deliverState(
      viewFor('RETAILER', { has_submitted: true, awaiting_roles: ['WHOLESALER', 'DISTRIBUTOR', 'FACTORY'] }),
    );
    seen.push(bodyText());

    // The other three submit. `order_submitted` is identity only (12 §2).
    const roles: Role[] = ['WHOLESALER', 'DISTRIBUTOR', 'FACTORY'];
    roles.forEach((role, index) => {
      act(() => {
        useGameStore.getState().applyOrderSubmitted({
          seq: nextSeq(),
          week: 6,
          role,
          display_name: `Player ${index + 2}`,
          is_bot: false,
        });
      });
      seen.push(bodyText());
    });

    act(() => {
      useGameStore
        .getState()
        .applyWeekClosed({ seq: nextSeq(), week: 6, next_week: 7, awaiting_roles: [...ROLE_ORDER] });
    });
    seen.push(bodyText());

    act(() => {
      useGameStore.getState().applyYourWeekClosed({
        seq: nextSeq(),
        week: 6,
        record: { ...ownHistory('RETAILER')[5], week: 6, order: 7 },
      });
    });
    seen.push(bodyText());

    deliverState(viewFor('RETAILER', { week: 7, settlement: settlementFor('RETAILER', 7) }));
    seen.push(bodyText());

    for (const snapshot of seen) {
      for (const quantity of others) expect(snapshot).not.toContain(quantity);
    }
  });
});

// ---------------------------------------------------------------------------
// Criterion 21 — the player's own history, and nobody else's
// ---------------------------------------------------------------------------

describe('CRITERION 21: the history chart exposes the player’s own three series', () => {
  it('renders one row per week of own_history', () => {
    renderPlaying('RETAILER');

    expect(historyRows()).toHaveLength(OWN_INVENTORY.length);
  });

  it('exposes exactly three series beside the week column', () => {
    renderPlaying('RETAILER');

    expect(historySeries()).toHaveLength(3);
  });

  it('exposes closing_inventory, closing_backlog and order, and nothing else', () => {
    renderPlaying('RETAILER');

    const series = historySeries().map((column) => column.join(','));
    expect(series.sort()).toEqual(
      [OWN_INVENTORY.join(','), OWN_BACKLOG.join(','), OWN_ORDERS.join(',')].sort(),
    );
  });

  it('carries nobody else’s figures — every number traces to own_history', () => {
    renderPlaying('RETAILER');

    const all = historySeries()
      .flat()
      .sort((a, b) => a - b);
    const own = [...OWN_INVENTORY, ...OWN_BACKLOG, ...OWN_ORDERS].sort((a, b) => a - b);
    expect(all).toEqual(own);
  });

  it('names no other role in the table', () => {
    renderPlaying('RETAILER');

    const text = textOf(historyTable());
    for (const role of ['WHOLESALER', 'DISTRIBUTOR', 'FACTORY'] as Role[]) {
      expect(text).not.toMatch(new RegExp(role, 'i'));
    }
  });

  it('leaves the table in the accessibility tree, which is what §2.6a is for', () => {
    // Visually hidden, not hidden: §3.4 needs a screen reader to read it.
    renderPlaying('RETAILER');

    const table = historyTable();
    expect(table.getAttribute('aria-hidden')).not.toBe('true');
    expect(table.hasAttribute('hidden')).toBe(false);
    expect(table.closest('[aria-hidden="true"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Criterion 22 — the paused overlay
// ---------------------------------------------------------------------------

describe('CRITERION 22: PausedOverlay states the server’s reason and disables the form', () => {
  const reason = 'Waiting for the Distributor to reconnect.';

  function pause(): void {
    act(() => {
      useGameStore.getState().applyGamePaused({ seq: nextSeq(), reason });
    });
  }

  /**
   * A confirm control is legitimately disabled while the input is empty, so
   * the order is entered first. Without that, "disabled while paused" would
   * pass against a screen that never enabled it at all.
   */
  async function readyToConfirm(user: ReturnType<typeof userEvent.setup>) {
    renderPlaying('RETAILER');
    const input = requireOrderInput();
    await user.clear(input);
    await user.type(input, '7');
    expect(isDisabled(controlMatching(/confirm/i, 'Confirm'))).toBe(false);
  }

  it('renders the reason the server sent, verbatim', () => {
    renderPlaying('RETAILER');
    pause();

    expect(bodyText()).toContain(reason);
  });

  it('disables the confirm control beneath it', async () => {
    const user = userEvent.setup();
    await readyToConfirm(user);

    pause();

    expect(isDisabled(controlMatching(/confirm/i, 'Confirm'))).toBe(true);
  });

  it('emits nothing while paused', async () => {
    const user = userEvent.setup();
    await readyToConfirm(user);
    pause();

    await user.click(controlMatching(/confirm/i, 'Confirm'));

    expect(emitsOf('submit_order')).toHaveLength(0);
  });

  it('clears the overlay when the host resumes', async () => {
    const user = userEvent.setup();
    await readyToConfirm(user);
    pause();

    act(() => {
      useGameStore.getState().applyGameResumed({ seq: nextSeq() });
    });

    expect(bodyText()).not.toContain(reason);
    expect(isDisabled(controlMatching(/confirm/i, 'Confirm'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Criterion 24 and failure mode 11 — nothing important lives in useState
// ---------------------------------------------------------------------------

describe('CRITERION 24: the screen rebuilds from a single your_state', () => {
  /**
   * `own_history` is empty for the text comparisons. jsdom has no 2D canvas
   * context, so whether the chart throws and the wrapper degrades with its
   * notice (§2.6a) differs between a first mount and a remount in the same
   * test — an artefact of the environment, not of the screen's state. The
   * chart's own content is compared through its §2.6a table instead, which
   * is deterministic.
   */
  function resyncView(over: Partial<PlayerView> = {}): PlayerView {
    return viewFor('RETAILER', { own_history: [], ...over });
  }

  it('renders identically after a reset and one resync payload', () => {
    startGame(6);
    deliverState(resyncView());
    const first = renderScreen();
    const before = bodyText();
    first.unmount();

    // A refresh: the store starts empty and the server resyncs (§3.3).
    act(() => {
      useGameStore.getState().reset();
    });
    seq = 0;
    act(() => {
      useGameStore.getState().setRoomCode(ROOM);
    });
    deliverState(resyncView());
    renderScreen();

    expect(bodyText()).toBe(before);
  });

  it('rebuilds the history table from the same single payload', () => {
    startGame(6);
    deliverState(viewFor('RETAILER'));
    const first = renderScreen();
    const before = historyRows();
    first.unmount();

    act(() => {
      useGameStore.getState().reset();
    });
    seq = 0;
    deliverState(viewFor('RETAILER'));
    renderScreen();

    expect(historyRows()).toEqual(before);
    expect(before).toHaveLength(OWN_INVENTORY.length);
  });
});

describe('FAILURE MODE 11: unmounting and remounting changes nothing', () => {
  it('re-renders identically with the store left intact', () => {
    startGame(6);
    deliverState(viewFor('RETAILER', { own_history: [] }));
    const first = renderScreen();
    const before = bodyText();
    first.unmount();

    renderScreen();

    expect(bodyText()).toBe(before);
  });

  it('keeps the locked state across a remount, because the server owns it', async () => {
    const user = userEvent.setup();
    startGame(6);
    deliverState(viewFor('RETAILER', { own_history: [] }));
    const first = renderScreen();
    await submitOrder(user, '7');
    deliverState(
      viewFor('RETAILER', {
        own_history: [],
        has_submitted: true,
        awaiting_roles: ['DISTRIBUTOR', 'FACTORY'],
      }),
    );
    const before = bodyText();
    first.unmount();

    renderScreen();

    expect(bodyText()).toBe(before);
  });

  it('keeps the history table across a remount', () => {
    startGame(6);
    deliverState(viewFor('RETAILER'));
    const first = renderScreen();
    const before = historyRows();
    first.unmount();

    renderScreen();

    expect(historyRows()).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// `24-frontend-3d-board.md` §8.3 — two additions, and no existing test changed
// ---------------------------------------------------------------------------

/**
 * Section 24 put a second board behind the seam `19 §2.8` was holding open.
 * Everything above this line is the 2D board, and every one of those tests is
 * unchanged on purpose: **the regression that matters most is that section 24
 * changed nothing for a player who never asks for the warehouse** (24 AC 1).
 *
 * The toggle test deliberately never lets `Board3D` mount. `24 §8.2`'s whole
 * discipline is that jsdom has no WebGL and the 3D board is therefore asserted
 * as a `SceneModel` object in `Board3D.test.tsx`, never as pixels; this
 * recorder harness has no WebGL either, so the lazy chunk is replaced for the
 * one test that flips the switch. What is being asserted here is the *wiring*
 * — a real button, and `'3D'` in localStorage afterwards — which is exactly
 * the half that cannot be seen from a pure module.
 */
describe('24 AC 1 / AC 2 / AC 3: the board seam has a second entry and the default is unmoved', () => {
  it('AC 1: with no stored preference and no env var, the screen is still the 2D board', () => {
    // setup.ts clears both storage areas before every test, and no test in
    // this file sets VITE_BOARD_VIEW, so this is the untouched default path.
    expect(window.localStorage.getItem('board_view')).toBeNull();

    renderPlaying('RETAILER');

    // The 2D board's own content, rendered synchronously: the settlement
    // recap, the "what you have" panel and the order input. If the seam had
    // resolved to `Board3D` instead, React would have suspended on the lazy
    // chunk and this would be the loading card.
    expect(requireOrderInput()).toBeInTheDocument();
    expect(bodyText()).not.toMatch(/opening the warehouse/i);
    expect(document.querySelector('[aria-label="What you have"]')).not.toBeNull();
  });

  it('a 3D chunk that fails to load falls back to the 2D board, not the app-wide error screen', async () => {
    // What a tab left open across a redeploy sees: the old chunk hash is gone,
    // the SPA rewrite answers with index.html, and the dynamic import rejects.
    // `lazy()` rethrows that rejection where the lazy element renders, so a
    // stub that throws on render reaches the same boundary. (A throwing mock
    // *factory* is not the same test: vitest then falls back to the real
    // module, whose own WebGL fallback renders the 2D board and passes this
    // whether or not anything catches a failed import.)
    //
    // `lazy()` caches its first resolution for the life of the module, so this
    // test must run before the one below stubs the chunk differently.
    let chunkRendered = false;
    vi.doMock('../components/game/views/Board3D', () => ({
      default: (): never => {
        chunkRendered = true;
        throw new Error('Failed to fetch dynamically imported module');
      },
    }));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const user = userEvent.setup();
      renderPlaying('RETAILER');

      await user.click(controlMatching(/switch to the 3d warehouse/i, 'the 2D/3D toggle'));
      // The stubbed chunk takes a while to resolve, and React retries a
      // throwing render before it gives up. Until the error has been reported
      // the screen is still the pre-click board, and the assertions below
      // would pass whether or not anything caught the throw.
      await waitFor(() => expect(chunkRendered).toBe(true));
      await waitFor(
        () =>
          expect(
            consoleError.mock.calls.some((args) =>
              args.some((arg) => String(arg).includes('Failed to fetch dynamically imported module')),
            ),
          ).toBe(true),
        { timeout: 3000 },
      );
      expect(window.localStorage.getItem('board_view')).toBe('3D');

      // The player keeps their week: the 2D board, with its order input, and
      // not the outermost boundary's "Something went wrong".
      await waitFor(() => expect(requireOrderInput()).toBeInTheDocument());
      expect(bodyText()).not.toMatch(/something went wrong/i);
    } finally {
      consoleError.mockRestore();
      vi.doUnmock('../components/game/views/Board3D');
    }
  });

  it('AC 2 / AC 3: the toggle is a real button, and pressing it stores "3D"', async () => {
    // The lazy chunk, stubbed. `vi.doMock` is not hoisted, so it applies to
    // the dynamic `import()` inside `GameRoomPlaying`'s `lazy()` call — which
    // has not run yet, because nothing in this file has ever asked for 3D.
    // Without it, flipping the switch would load `@react-three/fiber` and
    // mount a `<Canvas>` into a jsdom with no WebGL context.
    vi.doMock('../components/game/views/Board3D', () => ({
      default: (): null => null,
    }));

    try {
      const user = userEvent.setup();
      renderPlaying('RETAILER');

      const toggle = controlMatching(/switch to the 3d warehouse/i, 'the 2D/3D toggle');
      // A real `<button>`, keyboard-operable — not a div with a click handler
      // (24 §2.4, AC 2).
      expect(toggle.tagName).toBe('BUTTON');
      expect(isDisabled(toggle)).toBe(false);

      await user.click(toggle);

      // localStorage, deliberately, and nothing in sessionStorage: section 7
      // of `CLAUDE.md` reserves that area for authority, and a rendering
      // preference grants nothing (24 §2.3, AC 3).
      expect(window.localStorage.getItem('board_view')).toBe('3D');
      expect(window.sessionStorage.getItem('board_view')).toBeNull();
    } finally {
      vi.doUnmock('../components/game/views/Board3D');
    }
  });
});
