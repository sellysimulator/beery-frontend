/**
 * `20-frontend-host-console.md` — `HostConsole`, the host's live view of the
 * whole chain.
 *
 * Covers acceptance criteria 1, 2, 3, 4, 5, 13, 14, 18, 19, 20, 21, 22, 23 and
 * 24, and failure modes 5, 6 (the "it renders" half), 7, 10, 11 and 12.
 * Criteria 6–12 and failure modes 3, 4 and 6 (the "what it emits" half) are in
 * `HostControls.test.tsx`; criteria 15–17 and failure modes 1, 2, 8, 9 and 13
 * are in `PresentationMode.test.tsx`.
 *
 * Harness notes:
 *  - `socket.io-client` is replaced by a recorder, so `src/api/socket.ts`,
 *    `src/api/socketHandlers.ts` and `src/api/games.ts` run as real,
 *    un-mocked code while nothing touches transport. Server → client events
 *    are delivered by calling what registered for them, exactly as the
 *    transport would (`12 §2`); client → server emits are read back as wire
 *    payloads.
 *  - **`chart.js` and `react-chartjs-2` are never mocked** (`§2.1a`, failure
 *    mode 12). The two seams `§2.1a` freezes are used instead: the pure
 *    builder `buildDemandCurveConfig`, and the chart's visually hidden
 *    per-week table. `demandCurveConfig.ts` is *wrapped*, not replaced, so the real
 *    builder runs and its argument and result are recorded — which is what
 *    makes criterion 23's pass-through rule checkable.
 *  - `HostConsole` takes no props and reads everything from the store and
 *    `useParams` (`§2.0`), so every fixture below is delivered over the wire
 *    and the component is rendered inside a router at `/host/:roomCode`.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import type { ComponentType } from 'react';
import { render, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { useGameStore } from '../store/gameStore';
import { ROLE_ORDER } from '../types/game';
import type {
  GameFinishedPayload,
  HostRoleView,
  HostView,
  LobbyUpdatePayload,
  Participant,
  Role,
  RoleStats,
  RoleToAlias,
  RoomState,
} from '../types/game';
import { setHostSecret } from '../utils/storage';
import * as HostConsoleModule from '../pages/HostConsole';
import * as DemandCurveBuilder from '../components/host/demandCurveConfig';

// ---------------------------------------------------------------------------
// Harness — transport
// ---------------------------------------------------------------------------

type Listener = (...args: unknown[]) => void;

const rec = vi.hoisted(() => ({
  emits: [] as Array<{ event: string; payload: unknown }>,
  listeners: new Map<string, Listener[]>(),
  ioCalls: 0,
  connectCalls: 0,
}));

vi.mock('socket.io-client', () => {
  const add = (event: string, cb: Listener) => {
    rec.listeners.set(event, [...(rec.listeners.get(event) ?? []), cb]);
  };
  const socket: Record<string, unknown> = {
    id: 'host-sid',
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
    connect: () => {
      rec.connectCalls += 1;
      return socket;
    },
    disconnect: () => socket,
    io: { engine: { transport: { name: 'websocket' } } },
  };
  const io = () => {
    rec.ioCalls += 1;
    return socket;
  };
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

// ---------------------------------------------------------------------------
// Harness — the demandCurveConfig wrapper (§2.1a seam 1)
// ---------------------------------------------------------------------------

interface ChartLikeConfig {
  type?: unknown;
  data?: { labels?: unknown[]; datasets?: Array<Record<string, unknown>> };
  options?: Record<string, unknown>;
}

const curveRec = vi.hoisted(() => ({
  calls: [] as Array<{ series: number[]; week: number; config: unknown }>,
}));

vi.mock('../components/host/demandCurveConfig', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const build = actual.buildDemandCurveConfig;
  if (typeof build !== 'function') {
    throw new Error(
      '20 §2.1a: `src/components/host/demandCurveConfig.ts` must export ' +
        '`buildDemandCurveConfig(demandSeries: number[], currentWeek: number): ' +
        'ChartConfiguration<"line">`.',
    );
  }
  return {
    ...actual,
    buildDemandCurveConfig: (series: number[], week: number) => {
      const config = (build as (s: number[], w: number) => unknown)(series, week);
      curveRec.calls.push({ series, week, config });
      return config;
    },
  };
});

// ---------------------------------------------------------------------------
// The component under test
// ---------------------------------------------------------------------------

type Renderable = ComponentType<Record<string, never>>;

function componentFrom(mod: unknown, name: string): Renderable {
  const exported = mod as Record<string, unknown>;
  const found = exported[name] ?? exported.default;
  if (typeof found !== 'function') {
    throw new Error(
      `20 §2.0: \`src/pages/${name}.tsx\` must export \`${name}\` (and a default), ` +
        'a component taking no props.',
    );
  }
  return found as Renderable;
}

const HostConsole = componentFrom(HostConsoleModule, 'HostConsole');

// ---------------------------------------------------------------------------
// Fixtures
//
// Every number is unique across the whole view, so failure mode 7 ("a number
// with no source") and failure mode 11 ("in production vs queued") cannot pass
// on a coincidence. Display names carry no digits, for the same reason.
// ---------------------------------------------------------------------------

const ROOM = 'HST742';
const SECRET = 'host-secret-fixture';

const WEEK = 17;
const DURATION = 24;

/** The FULL series, 24 entries — including the seven weeks not yet played. */
const DEMAND_SERIES: number[] = Array.from({ length: DURATION }, (_, i) => 1001 + i);

const CHAIN_TOTAL_COST = 999.5;

const ROLE_NUMBERS: Record<Role, Omit<HostRoleView, 'has_submitted' | 'is_bot'>> = {
  RETAILER: {
    inventory: 211,
    backlog: 212,
    supply_line: 213,
    orders_in_flight: 214,
    last_order: 215,
    incoming_order: 216,
    accumulated_cost: 217,
    production_queue: 0,
  },
  WHOLESALER: {
    inventory: 221,
    backlog: 222,
    supply_line: 223,
    orders_in_flight: 224,
    last_order: 225,
    incoming_order: 226,
    accumulated_cost: 227,
    production_queue: 0,
  },
  DISTRIBUTOR: {
    inventory: 231,
    backlog: 232,
    supply_line: 233,
    orders_in_flight: 234,
    last_order: 235,
    incoming_order: 236,
    accumulated_cost: 237,
    production_queue: 0,
  },
  FACTORY: {
    inventory: 241,
    backlog: 242,
    // `§2.1`: the production line IS the Factory's inbound pipeline.
    supply_line: 243,
    orders_in_flight: 244,
    last_order: 245,
    incoming_order: 246,
    accumulated_cost: 247,
    // Deliberately different from `supply_line` (failure mode 11).
    production_queue: 248,
  },
};

const NAMES: Record<Role, string> = {
  RETAILER: 'Ana',
  WHOLESALER: 'Ben',
  DISTRIBUTOR: 'Cleo',
  FACTORY: 'Dara',
};

const ALIASES: RoleToAlias = {
  RETAILER: 'P1',
  WHOLESALER: 'P2',
  DISTRIBUTOR: 'P3',
  FACTORY: 'P4',
};

function hostRole(role: Role, over: Partial<HostRoleView> = {}): HostRoleView {
  return {
    ...ROLE_NUMBERS[role],
    has_submitted: role === 'RETAILER' || role === 'WHOLESALER',
    is_bot: false,
    ...over,
  };
}

function hostView(over: Partial<HostView> = {}, roleOver: Partial<Record<Role, Partial<HostRoleView>>> = {}): HostView {
  return {
    week: WEEK,
    duration_weeks: DURATION,
    phase: 'DECISION',
    currency_symbol: '$',
    demand_series: [...DEMAND_SERIES],
    awaiting_roles: ['DISTRIBUTOR', 'FACTORY'],
    chain_total_cost: CHAIN_TOTAL_COST,
    roles: {
      RETAILER: hostRole('RETAILER', roleOver.RETAILER),
      WHOLESALER: hostRole('WHOLESALER', roleOver.WHOLESALER),
      DISTRIBUTOR: hostRole('DISTRIBUTOR', roleOver.DISTRIBUTOR),
      FACTORY: hostRole('FACTORY', roleOver.FACTORY),
    },
    ...over,
  };
}

function participantsFor(overrides: Partial<Record<Role, Partial<Participant> | null>> = {}): Participant[] {
  const out: Participant[] = [];
  for (const role of ROLE_ORDER) {
    const over = overrides[role];
    if (over === null) continue;
    out.push({
      alias: ALIASES[role] as string,
      display_name: NAMES[role],
      role,
      is_bot: false,
      connected: true,
      is_host: false,
      ...over,
    });
  }
  return out;
}

function lobbyUpdate(
  state: RoomState,
  participants: Participant[],
  roleToAlias: RoleToAlias = ALIASES,
): Omit<LobbyUpdatePayload, 'seq'> {
  return {
    state,
    host_display_name: 'Professor',
    participants,
    role_to_alias: roleToAlias,
    role_assignment_mode: 'HOST_ASSIGNS',
    seats_total: 4,
    config_locked: true,
    can_start: false,
    start_blocked_reason: 'The game is already running.',
  };
}

function roleStats(role: Role): RoleStats {
  return {
    role,
    total_cost: ROLE_NUMBERS[role].accumulated_cost,
    peak_inventory: 300,
    peak_backlog: 30,
    weeks_in_backlog: 3,
    order_variance: 4.5,
    bullwhip_ratio: 2.5,
    fill_rate: 0.9,
    average_order: 8,
  };
}

function gameFinished(weeksPlayed = WEEK): Omit<GameFinishedPayload, 'seq'> {
  return {
    weeks_played: weeksPlayed,
    stats: {
      weeks_played: weeksPlayed,
      demand_variance: 12.5,
      chain_total_cost: CHAIN_TOTAL_COST,
      per_role: {
        RETAILER: roleStats('RETAILER'),
        WHOLESALER: roleStats('WHOLESALER'),
        DISTRIBUTOR: roleStats('DISTRIBUTOR'),
        FACTORY: roleStats('FACTORY'),
      },
    },
    demand_series: DEMAND_SERIES.slice(0, weeksPlayed),
    orders_by_role: {
      RETAILER: [],
      WHOLESALER: [],
      DISTRIBUTOR: [],
      FACTORY: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Driving the wire
// ---------------------------------------------------------------------------

let seq = 0;

function nextSeq(): number {
  seq += 1;
  return seq;
}

/** Deliver a server → client event to whatever registered for it. */
function dispatch(event: string, payload?: unknown): void {
  const listeners = [...(rec.listeners.get(event) ?? [])];
  if (listeners.length === 0) {
    throw new Error(
      `Nothing is listening for "${event}". 12 §2 makes it a server → client event and ` +
        'section 16’s handlers are the only registrar.',
    );
  }
  act(() => {
    for (const cb of listeners) cb(payload);
  });
}

function seatRoom(
  state: RoomState = 'RUNNING',
  participants: Participant[] = participantsFor(),
  roleToAlias: RoleToAlias = ALIASES,
): void {
  act(() => {
    useGameStore.getState().setRoomCode(ROOM);
    useGameStore.getState().setIsHost(true);
  });
  dispatch('lobby_update', { seq: nextSeq(), ...lobbyUpdate(state, participants, roleToAlias) });
}

function deliverHostState(view: HostView = hostView(), at: number = nextSeq()): void {
  dispatch('host_state', { seq: at, ...view });
}

function renderConsole() {
  return render(
    <MemoryRouter initialEntries={[`/host/${ROOM}`]}>
      <Routes>
        <Route path="/host/:roomCode" element={<HostConsole />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** A running room, seated, with a fresh `host_state` applied. */
function renderRunning(view: HostView = hostView(), participants: Participant[] = participantsFor()) {
  seatRoom('RUNNING', participants);
  deliverHostState(view);
  return renderConsole();
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function norm(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Rendered text with element boundaries preserved as spaces. `textContent`
 * glues adjacent elements together ("Backlog" + "212" reads as "Backlog212"),
 * which silently defeats every word-anchored assertion.
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

function allElements(root: ParentNode = document.body): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('*'));
}

function smallest(predicate: (text: string, el: HTMLElement) => boolean, root: ParentNode = document.body) {
  return allElements(root)
    .filter((el) => predicate(textOf(el), el))
    .sort((a, b) => textOf(a).length - textOf(b).length)[0];
}

/**
 * Every standalone number in a piece of text. The lookbehind keeps the `1` of
 * an alias like `P1` out of the result: an alias is an identifier, not a
 * figure, and `00-conventions.md §2` makes it the one public id.
 */
function numbersIn(text: string): number[] {
  const found = text.match(/(?<![A-Za-z0-9.])-?\d[\d,]*(?:\.\d+)?/g) ?? [];
  return found.map((raw) => Number(raw.replace(/,/g, ''))).filter((n) => Number.isFinite(n));
}

function hasNumber(text: string, value: number): boolean {
  return numbersIn(text).some((n) => n === value);
}

/**
 * `§2.1`: one card per role, carrying that role's on hand, backlog, last order
 * and accumulated cost. The chain diagram also names the roles and shows
 * inventory and backlog, so the card is identified as the smallest element
 * carrying all four of those figures — which is what distinguishes it from a
 * chain link.
 */
function roleCard(role: Role): HTMLElement {
  const numbers = ROLE_NUMBERS[role];
  const wanted = [numbers.inventory, numbers.backlog, numbers.last_order as number, numbers.accumulated_cost];
  const found = smallest((text) => {
    if (!new RegExp(role, 'i').test(text)) return false;
    return wanted.every((value) => hasNumber(text, value));
  });
  if (!found) {
    throw new Error(
      `20 §2.1 / criterion 1: no card for ${role} carrying its on hand (${numbers.inventory}), ` +
        `backlog (${numbers.backlog}), last order (${numbers.last_order}) and accumulated cost ` +
        `(${numbers.accumulated_cost}). The console rendered: ${bodyText()}`,
    );
  }
  return found;
}

/** The card for a role, located by role name alone — for an empty seat. */
function cardByName(role: Role): HTMLElement {
  const numbers = ROLE_NUMBERS[role];
  const found = smallest(
    (text) => new RegExp(role, 'i').test(text) && hasNumber(text, numbers.inventory) && hasNumber(text, numbers.backlog),
  );
  if (!found) {
    throw new Error(`20 §2.1: no card naming ${role} and showing its figures. Rendered: ${bodyText()}`);
  }
  return found;
}

const CONNECTED_RE = /\bconnected\b|\bonline\b|\bhere\b/i;
const DISCONNECTED_RE = /disconnected|offline|dropped|lost connection|away/i;
const ANY_CONNECTION_RE = /connect|online|offline|dropped/i;

/**
 * `§2.1` and criterion 4: "a connection dot with a text label". The label is
 * read as text; the dot is whatever non-text mark sits beside it — an svg, an
 * empty element painted by CSS, or a bullet glyph. No private name is read.
 */
const DOT_GLYPHS = ['●', '○', '•', '⬤', '⚫', '⚪', '◉', '▪', '🟢', '🔴', '🟡'];

function hasConnectionDot(card: HTMLElement): boolean {
  const label = smallest((text) => ANY_CONNECTION_RE.test(text), card) ?? card;
  const scope = label.parentElement && card.contains(label.parentElement) ? label.parentElement : card;
  return allElements(scope).some((el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'svg' || tag === 'img') return true;
    if (el.children.length === 0 && textOf(el) === '') return true;
    return DOT_GLYPHS.some((glyph) => textOf(el).includes(glyph));
  });
}

/**
 * `§2.1a` seam 2 and criterion 24: the demand curve's visually hidden table,
 * one row per week of the FULL series. It is the table whose data-row count
 * matches the series and whose rows carry the series values.
 */
function demandTable(root: ParentNode = document.body): HTMLElement {
  const tables = Array.from(root.querySelectorAll<HTMLElement>('table, [role="table"]'));
  const found = tables.find((t) => {
    const text = textOf(t);
    return DEMAND_SERIES.every((value) => hasNumber(text, value));
  });
  if (!found) {
    throw new Error(
      '20 §2.1a / criterion 24: the demand curve must render a visually hidden table, one row ' +
        'per week of the full series, with the week number, the demand value and whether that ' +
        `week is the current one. No such table was rendered. The console rendered: ${bodyText()}`,
    );
  }
  return found;
}

/** The table's data rows: every row carrying at least one number. */
function dataRows(table: HTMLElement): HTMLElement[] {
  return Array.from(table.querySelectorAll<HTMLElement>('tr, [role="row"]')).filter(
    (row) => numbersIn(textOf(row)).length > 0,
  );
}

function latestCurveConfig(): ChartLikeConfig {
  const last = curveRec.calls[curveRec.calls.length - 1];
  if (!last) {
    throw new Error(
      '20 §2.1a and criterion 23: `DemandCurve` must pass `buildDemandCurveConfig`’s result ' +
        `straight through; the builder was never called. The console rendered: ${bodyText()}`,
    );
  }
  return last.config as ChartLikeConfig;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // The mocks above must be in place first, then the socket module builds the
  // client, then the handler module registers against it — `main.tsx`'s order.
  await import('../api/socket');
  await import('../api/socketHandlers');
});

beforeEach(() => {
  seq = 0;
  rec.emits.length = 0;
  curveRec.calls.length = 0;
  act(() => {
    useGameStore.getState().reset();
  });
  setHostSecret(ROOM, SECRET);
});

afterEach(() => {
  act(() => {
    useGameStore.getState().reset();
  });
});

// ---------------------------------------------------------------------------
// Criterion 1 — four roles, side by side
// ---------------------------------------------------------------------------

describe('CRITERION 1: all four roles, with inventory, backlog, last order, cost and submission status', () => {
  it.each(ROLE_ORDER)('%s shows its four figures', (role) => {
    renderRunning();

    const text = textOf(roleCard(role));
    const numbers = ROLE_NUMBERS[role];
    expect(hasNumber(text, numbers.inventory)).toBe(true);
    expect(hasNumber(text, numbers.backlog)).toBe(true);
    expect(hasNumber(text, numbers.last_order as number)).toBe(true);
    expect(hasNumber(text, numbers.accumulated_cost)).toBe(true);
  });

  it('renders the four cards as four distinct elements', () => {
    renderRunning();

    const cards = ROLE_ORDER.map((role) => roleCard(role));
    expect(new Set(cards).size).toBe(4);
    for (const card of cards) {
      for (const other of cards) {
        if (card !== other) expect(card.contains(other)).toBe(false);
      }
    }
  });

  it('names the week and the duration', () => {
    renderRunning();

    expect(bodyText()).toMatch(new RegExp(`week\\s*${WEEK}\\s*of\\s*${DURATION}`, 'i'));
  });

  it('distinguishes a role that has submitted from one that has not', () => {
    renderRunning();

    /** A card's non-numeric, non-name text: what is left is the tick state. */
    const signature = (role: Role): string =>
      textOf(roleCard(role))
        .replace(/(?<![A-Za-z0-9.])-?\d[\d,]*(?:\.\d+)?/g, '')
        .replace(new RegExp(role, 'gi'), '')
        .replace(new RegExp(NAMES[role], 'gi'), '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

    // RETAILER has submitted, DISTRIBUTOR has not; both are connected humans.
    expect(signature('DISTRIBUTOR')).not.toBe(signature('RETAILER'));
  });
});

// ---------------------------------------------------------------------------
// Criterion 2 and failure mode 11 — the Factory card
// ---------------------------------------------------------------------------

describe('CRITERION 2: the Factory card shows units in production and the production queue', () => {
  it('shows both figures', () => {
    renderRunning();

    const text = textOf(roleCard('FACTORY'));
    expect(hasNumber(text, ROLE_NUMBERS.FACTORY.supply_line)).toBe(true);
    expect(hasNumber(text, ROLE_NUMBERS.FACTORY.production_queue)).toBe(true);
  });
});

describe('FAILURE MODE 11: in production is supply_line, queued is production_queue', () => {
  function labelled(card: HTMLElement, re: RegExp, what: string): HTMLElement {
    const found = smallest((text) => re.test(text) && numbersIn(text).length > 0, card);
    if (!found) {
      throw new Error(
        `20 §2.1: the Factory card must label its "${what}" figure (${re}). ` +
          `The card rendered: ${textOf(card)}`,
      );
    }
    return found;
  }

  it('"in production" reads supply_line and never production_queue or a derived figure', () => {
    renderRunning();

    const { supply_line: line, production_queue: queued } = ROLE_NUMBERS.FACTORY;
    const text = textOf(labelled(roleCard('FACTORY'), /in production|producing|on the line/i, 'in production'));

    expect(hasNumber(text, line)).toBe(true);
    expect(hasNumber(text, queued)).toBe(false);
    expect(hasNumber(text, line + queued)).toBe(false);
  });

  it('"queued" reads production_queue and never supply_line or a derived figure', () => {
    renderRunning();

    const { supply_line: line, production_queue: queued } = ROLE_NUMBERS.FACTORY;
    const text = textOf(labelled(roleCard('FACTORY'), /queue/i, 'queued'));

    expect(hasNumber(text, queued)).toBe(true);
    expect(hasNumber(text, line)).toBe(false);
    expect(hasNumber(text, line + queued)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Criterion 3 — the Bot badge
// ---------------------------------------------------------------------------

describe('CRITERION 3: a bot-played role renders a Bot badge', () => {
  /**
   * The card's own text, with its controls' labels removed — every card
   * carries a *Swap in a bot* control (`§2.2`), so the badge has to be read
   * from what is left.
   */
  function badgeText(card: HTMLElement): string {
    const clone = card.cloneNode(true) as HTMLElement;
    for (const el of Array.from(
      clone.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]'),
    )) {
      el.remove();
    }
    return textOf(clone);
  }

  it('badges the role whose host_state entry says is_bot, and only that one', () => {
    renderRunning(
      hostView({}, { FACTORY: { is_bot: true } }),
      participantsFor({ FACTORY: { is_bot: true, display_name: 'Dara' } }),
    );

    expect(badgeText(roleCard('FACTORY'))).toMatch(/\bbot\b/i);
    for (const role of ['RETAILER', 'WHOLESALER', 'DISTRIBUTOR'] as Role[]) {
      expect(badgeText(roleCard(role))).not.toMatch(/\bbot\b/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Criterion 4 — connection state is a dot PLUS a text label
// ---------------------------------------------------------------------------

describe('CRITERION 4: connection state renders as a dot plus a text label', () => {
  it('labels a connected player in words', () => {
    renderRunning();

    const card = roleCard('RETAILER');
    expect(textOf(card)).toMatch(CONNECTED_RE);
    expect(hasConnectionDot(card)).toBe(true);
  });

  it('labels a disconnected player in words, not by colour alone', () => {
    renderRunning(hostView(), participantsFor({ WHOLESALER: { connected: false } }));

    const card = roleCard('WHOLESALER');
    expect(textOf(card)).toMatch(DISCONNECTED_RE);
    expect(hasConnectionDot(card)).toBe(true);
  });

  it('gives the two states different words', () => {
    renderRunning(hostView(), participantsFor({ WHOLESALER: { connected: false } }));

    const connected = textOf(roleCard('RETAILER'));
    const dropped = textOf(roleCard('WHOLESALER'));
    expect(connected).not.toBe(dropped);
    expect(DISCONNECTED_RE.test(connected)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Criteria 5, 23 and 24, and failure mode 12 — the demand curve
// ---------------------------------------------------------------------------

describe('CRITERION 23: buildDemandCurveConfig returns one dataset holding the full series, with the week marked', () => {
  const { buildDemandCurveConfig } = DemandCurveBuilder;

  function datasetsOf(config: ChartLikeConfig): Array<Record<string, unknown>> {
    return config.data?.datasets ?? [];
  }

  /**
   * Is the current week marked anywhere in the configuration? `§2.1a` leaves
   * *how* to the implementer — "in a way the object states" — so every way an
   * object can state it is accepted: a per-point array whose entry for that
   * week differs, a scriptable option that returns something different for
   * that point, or a plain value naming the week. What is not accepted is a
   * configuration that says nothing about it.
   */
  function marksWeek(config: unknown, series: number[], week: number): boolean {
    const n = series.length;
    const index = week - 1;
    let marked = false;

    /**
     * One entry stands out from an otherwise uniform run — a highlighted
     * point radius, colour or label. A per-point array that is all-distinct
     * (the data itself, or `1..n` labels) is not a mark.
     */
    const standsOut = (values: unknown[]): boolean => {
      const at = JSON.stringify(values[index] ?? null);
      const others = values.filter((_, i) => i !== index).map((v) => JSON.stringify(v ?? null));
      if (others.includes(at)) return false;
      return new Set(others).size <= 2;
    };

    const walk = (node: unknown, insideSeries: boolean): void => {
      if (marked || node === null || node === undefined) return;
      if (Array.isArray(node)) {
        if (node.length === n && standsOut(node)) {
          marked = true;
          return;
        }
        for (const item of node) walk(item, insideSeries || node.length === n);
        return;
      }
      if (typeof node === 'function') {
        const outputs: unknown[] = [];
        for (let i = 0; i < n; i += 1) {
          try {
            outputs.push(
              (node as (ctx: unknown) => unknown)({
                dataIndex: i,
                index: i,
                parsed: { x: i, y: series[i] },
                raw: series[i],
                dataset: { data: series },
                chart: { data: { labels: series.map((_, k) => k + 1), datasets: [{ data: series }] } },
              }),
            );
          } catch {
            return;
          }
        }
        if (standsOut(outputs)) marked = true;
        return;
      }
      if (typeof node === 'object') {
        for (const value of Object.values(node as Record<string, unknown>)) walk(value, insideSeries);
        return;
      }
      if (insideSeries) return;
      if (typeof node === 'number' && (node === week || node === index)) marked = true;
      if (typeof node === 'string' && new RegExp(`(?<!\\d)${week}(?!\\d)`).test(node)) marked = true;
    };

    walk(config, false);
    return marked;
  }

  it('holds the full series in exactly one dataset', () => {
    const config = buildDemandCurveConfig([...DEMAND_SERIES], WEEK) as unknown as ChartLikeConfig;

    expect(datasetsOf(config)).toHaveLength(1);
    expect(datasetsOf(config)[0].data).toEqual(DEMAND_SERIES);
  });

  it('marks the current week, and only the current week', () => {
    const config = buildDemandCurveConfig([...DEMAND_SERIES], WEEK);

    expect(marksWeek(config, DEMAND_SERIES, WEEK)).toBe(true);
    // A configuration built for week 17 must not equally "mark" week 23.
    expect(marksWeek(config, DEMAND_SERIES, 23)).toBe(false);
  });

  it('is a line chart over the full series, including the weeks not yet played', () => {
    const config = buildDemandCurveConfig([...DEMAND_SERIES], WEEK) as unknown as ChartLikeConfig;

    expect(config.type).toBe('line');
    expect((datasetsOf(config)[0].data as number[]).length).toBe(DURATION);
    expect((datasetsOf(config)[0].data as number[]).length).toBeGreaterThan(WEEK);
  });

  it('DemandCurve renders that object unchanged', () => {
    renderRunning();

    const call = curveRec.calls[curveRec.calls.length - 1];
    expect(call).toBeDefined();
    expect(call.series).toEqual(DEMAND_SERIES);
    expect(call.week).toBe(WEEK);
    // Seam 2 must agree with seam 1: the hidden table plots what the builder built.
    const plotted = (latestCurveConfig().data?.datasets ?? [])[0]?.data as number[];
    const fromTable = dataRows(demandTable()).map((row) => {
      const numbers = numbersIn(textOf(row));
      return numbers.find((n) => DEMAND_SERIES.includes(n));
    });
    expect(fromTable).toEqual(plotted);
  });
});

describe('CRITERION 5: the curve plots the full series, future weeks included, with the current week marked', () => {
  it('plots every week of the series, not just the weeks played', () => {
    renderRunning();

    const rows = dataRows(demandTable());
    expect(rows).toHaveLength(DURATION);

    const text = textOf(demandTable());
    // The seven weeks the players have not reached are on the host's chart.
    for (const value of DEMAND_SERIES.slice(WEEK)) expect(hasNumber(text, value)).toBe(true);
  });

  it('marks exactly one row as the current week, and it is this week’s', () => {
    renderRunning();

    const rows = dataRows(demandTable());
    /**
     * `§2.1a`: each row says "whether that week is the current one". How is
     * the implementer's — a word, a glyph, `aria-current` — so the mark is
     * read as "the one row that differs from all the others once its numbers
     * are removed". `class` and `style` are excluded: this table is what a
     * screen reader uses, and a mark only CSS can see is not one.
     */
    const signature = (row: HTMLElement): string => {
      const attrsOf = (el: Element): string =>
        Array.from(el.attributes)
          .filter((a) => a.name !== 'class' && a.name !== 'style')
          // Digits are stripped from values too: `data-week="1"` differs on
          // every row and would make each one look uniquely marked.
          .map((a) => `${a.name}=${a.value.replace(/\d+/g, '')}`)
          .sort()
          .join(',');
      const inner = Array.from(row.querySelectorAll('*')).map(attrsOf).join(';');
      const text = textOf(row)
        .replace(/(?<![A-Za-z0-9.])-?\d[\d,]*(?:\.\d+)?/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
      return `${text}##${attrsOf(row)}##${inner}`;
    };

    const signatures = rows.map(signature);
    const counts = new Map<string, number>();
    for (const s of signatures) counts.set(s, (counts.get(s) ?? 0) + 1);
    const singletons = signatures
      .map((s, i) => (counts.get(s) === 1 ? i : -1))
      .filter((i) => i >= 0);

    expect({ singletons, rows: rows.length }).toEqual({ singletons: [WEEK - 1], rows: DURATION });
    expect(hasNumber(textOf(rows[WEEK - 1]), DEMAND_SERIES[WEEK - 1])).toBe(true);
    expect(hasNumber(textOf(rows[WEEK - 1]), WEEK)).toBe(true);
  });
});

describe('CRITERION 24: the hidden table has one row per week of the full series', () => {
  it('has a row per week, carrying the week number and the demand value', () => {
    renderRunning();

    const rows = dataRows(demandTable());
    expect(rows).toHaveLength(DEMAND_SERIES.length);

    rows.forEach((row, index) => {
      const text = textOf(row);
      expect(hasNumber(text, index + 1)).toBe(true);
      expect(hasNumber(text, DEMAND_SERIES[index])).toBe(true);
    });
  });

  it('leaves the table in the accessibility tree', () => {
    renderRunning();

    const table = demandTable();
    expect(table.getAttribute('aria-hidden')).not.toBe('true');
    expect(table.hasAttribute('hidden')).toBe(false);
    expect(table.closest('[aria-hidden="true"]')).toBeNull();
  });
});

describe('FAILURE MODE 12: the chart is asserted through the builder and the table, never a mock', () => {
  it('runs the real charting library', async () => {
    const reactChartjs = await import('react-chartjs-2');
    const chartjs = await import('chart.js');

    // If either had been mocked, `vi.isMockFunction` would hold for its exports.
    expect(vi.isMockFunction((reactChartjs as Record<string, unknown>).Line)).toBe(false);
    expect(vi.isMockFunction((chartjs as unknown as Record<string, unknown>).Chart)).toBe(false);
  });

  it('reads the plotted values from the builder’s result and the hidden table, which agree', () => {
    renderRunning();

    const plotted = (latestCurveConfig().data?.datasets ?? [])[0]?.data as number[];
    expect(plotted).toEqual(DEMAND_SERIES);

    const tableText = textOf(demandTable());
    for (const value of DEMAND_SERIES) expect(hasNumber(tableText, value)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Criteria 13 and 14, and failure mode 5 — the pause banner
// ---------------------------------------------------------------------------

describe('CRITERION 13: the pause banner renders the server’s paused_reason verbatim', () => {
  const REASON = 'Wholesaler (Ben) disconnected';

  it('shows the reason exactly as the server sent it', () => {
    renderRunning();
    dispatch('game_paused', { seq: nextSeq(), reason: REASON });

    expect(bodyText()).toContain(REASON);
  });

  it('renders no banner while the game is running', () => {
    renderRunning();

    expect(bodyText()).not.toContain(REASON);
    expect(bodyText()).not.toMatch(/\bpaused\b/i);
  });
});

describe('CRITERION 14 / FAILURE MODE 5: the game never resumes itself', () => {
  const REASON = 'Distributor (Cleo) disconnected';

  it('keeps the banner and emits no resume_game across a disconnect, reconnect and resync', () => {
    renderRunning();

    dispatch('participant_disconnected', {
      seq: nextSeq(),
      alias: 'P3',
      display_name: NAMES.DISTRIBUTOR,
      role: 'DISTRIBUTOR',
    });
    dispatch('game_paused', { seq: nextSeq(), reason: REASON });
    expect(bodyText()).toContain(REASON);

    // The player comes back, the socket reconnects, the server resyncs.
    dispatch('connect');
    dispatch('participant_reconnected', {
      seq: nextSeq(),
      alias: 'P3',
      display_name: NAMES.DISTRIBUTOR,
      role: 'DISTRIBUTOR',
    });
    deliverHostState();

    expect(bodyText()).toContain(REASON);
    expect(rec.emits.filter((e) => e.event === 'resume_game')).toHaveLength(0);
    expect(useGameStore.getState().paused).toBe(true);
  });

  it('clears the banner only when the server says the game resumed', () => {
    renderRunning();
    dispatch('game_paused', { seq: nextSeq(), reason: REASON });
    dispatch('game_resumed', { seq: nextSeq() });

    expect(bodyText()).not.toContain(REASON);
  });
});

// ---------------------------------------------------------------------------
// Criterion 18 — the host holds no seat
// ---------------------------------------------------------------------------

describe('CRITERION 18: nothing implies the host has a seat', () => {
  it('renders no decision input', () => {
    renderRunning();

    expect(document.querySelectorAll('input[type="number"]')).toHaveLength(0);
    expect(document.querySelectorAll('form')).toHaveLength(0);
  });

  it('renders no first-person inventory, cost or order', () => {
    renderRunning();

    const text = bodyText();
    expect(text).not.toMatch(/\byour\s+(inventory|backlog|cost|order|supply)/i);
    expect(text).not.toMatch(/\bmy\s+(inventory|backlog|cost|order)/i);
    expect(text).not.toMatch(/place (an|your) order|submit (your )?order/i);
  });
});

// ---------------------------------------------------------------------------
// Criterion 19 — a refresh restores every figure from host_state
// ---------------------------------------------------------------------------

describe('CRITERION 19: a refresh restores every figure from host_state alone', () => {
  it('renders the same figures after the store has been emptied and resynced', () => {
    const first = renderRunning();
    const before = ROLE_ORDER.map((role) => numbersIn(textOf(roleCard(role))).sort((a, b) => a - b));
    first.unmount();

    // A refresh: nothing survives in memory, the server resyncs on `connect`.
    act(() => {
      useGameStore.getState().reset();
    });
    expect(useGameStore.getState().hostState).toBeNull();

    seq = 0;
    seatRoom('RUNNING');
    deliverHostState();
    renderConsole();

    const after = ROLE_ORDER.map((role) => numbersIn(textOf(roleCard(role))).sort((a, b) => a - b));
    expect(after).toEqual(before);
    expect(bodyText()).toMatch(new RegExp(`week\\s*${WEEK}\\s*of\\s*${DURATION}`, 'i'));
  });
});

// ---------------------------------------------------------------------------
// Criterion 20 and failure mode 6 (the rendering half) — D18
// ---------------------------------------------------------------------------

describe('CRITERION 20 / FAILURE MODE 6: no host_secret does not lock the host out (D18)', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('renders the whole console with host_state and lobby_update applied and no secret stored', () => {
    expect(window.sessionStorage.length).toBe(0);

    renderRunning();

    for (const role of ROLE_ORDER) {
      expect(hasNumber(textOf(roleCard(role)), ROLE_NUMBERS[role].inventory)).toBe(true);
    }
    expect(bodyText()).toMatch(new RegExp(`week\\s*${WEEK}\\s*of\\s*${DURATION}`, 'i'));
  });

  it('shows no recovery screen — that decision is section 17’s, and only after a join_error', () => {
    renderRunning();

    expect(bodyText()).not.toMatch(/not the host|no longer the host|recover|re-?claim/i);
  });

  it('still renders the controls', () => {
    renderRunning();

    const text = bodyText();
    expect(text).toMatch(/pause/i);
    expect(text).toMatch(/end the game now/i);
  });
});

// ---------------------------------------------------------------------------
// Criterion 21 — the person in the seat comes from participants
// ---------------------------------------------------------------------------

describe('CRITERION 21: display name and connection come from participants via roleToAlias', () => {
  it('shows each role’s display name', () => {
    renderRunning();

    for (const role of ROLE_ORDER) {
      expect(textOf(roleCard(role))).toContain(NAMES[role]);
    }
  });

  it('follows roleToAlias rather than the participants’ own role field', () => {
    // The seats are swapped in `role_to_alias`; the card must follow the map.
    const swapped: RoleToAlias = { ...ALIASES, RETAILER: 'P2', WHOLESALER: 'P1' };
    seatRoom('RUNNING', participantsFor(), swapped);
    deliverHostState();
    renderConsole();

    expect(textOf(roleCard('RETAILER'))).toContain(NAMES.WHOLESALER);
    expect(textOf(roleCard('WHOLESALER'))).toContain(NAMES.RETAILER);
  });

  it('an empty seat renders the role label and no connection dot, never a blank cell', () => {
    const empty: RoleToAlias = { ...ALIASES, DISTRIBUTOR: null };
    seatRoom('RUNNING', participantsFor({ DISTRIBUTOR: null }), empty);
    deliverHostState();
    renderConsole();

    const card = cardByName('DISTRIBUTOR');
    expect(textOf(card)).toMatch(/distributor/i);
    expect(textOf(card)).not.toMatch(ANY_CONNECTION_RE);
    // Not a blank cell: the role's own figures are still there.
    expect(hasNumber(textOf(card), ROLE_NUMBERS.DISTRIBUTOR.inventory)).toBe(true);
    expect(hasNumber(textOf(card), ROLE_NUMBERS.DISTRIBUTOR.backlog)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Criterion 22 — the finished console
// ---------------------------------------------------------------------------

describe('CRITERION 22: at FINISHED the console shows the final chain, the weeks played and a results link', () => {
  function renderFinished() {
    seatRoom('RUNNING');
    deliverHostState();
    dispatch('game_finished', { seq: nextSeq(), ...gameFinished(WEEK) });
    return renderConsole();
  }

  it('still renders the final chain state', () => {
    renderFinished();

    for (const role of ROLE_ORDER) {
      const text = textOf(cardByName(role));
      expect(hasNumber(text, ROLE_NUMBERS[role].inventory)).toBe(true);
      expect(hasNumber(text, ROLE_NUMBERS[role].backlog)).toBe(true);
    }
  });

  it('reads "Finished — {n} weeks played"', () => {
    renderFinished();

    const text = bodyText();
    expect(text).toMatch(/finished/i);
    expect(text).toMatch(new RegExp(`${WEEK}\\s*weeks played`, 'i'));
  });

  it('links to the results screen for this room', () => {
    renderFinished();

    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'));
    expect(links.map((a) => a.getAttribute('href'))).toContain(`/results/${ROOM}`);
  });

  it('removes every §2.2 control rather than disabling it', () => {
    renderFinished();

    // `§2.4a`: "Every control in §2.2 is gone, not disabled."
    const gone = [/pause/i, /resume/i, /close this week/i, /swap in a bot/i, /end the game now/i, /present/i];
    const controls = Array.from(
      document.querySelectorAll<HTMLElement>('button, [role="button"], input[type="button"], input[type="submit"]'),
    );
    for (const re of gone) {
      const matching = controls.filter(
        (el) => re.test(textOf(el)) || re.test(el.getAttribute('aria-label') ?? ''),
      );
      expect({ control: String(re), found: matching.map((el) => textOf(el)) }).toEqual({
        control: String(re),
        found: [],
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Failure mode 7 — every number traces to host_state
// ---------------------------------------------------------------------------

describe('FAILURE MODE 7: every number on a RoleCard comes from host_state', () => {
  it.each(ROLE_ORDER)('%s shows no figure the server did not send', (role) => {
    renderRunning();

    const source = ROLE_NUMBERS[role];
    const allowed = new Set<number>([
      source.inventory,
      source.backlog,
      source.supply_line,
      source.orders_in_flight,
      source.last_order as number,
      source.incoming_order,
      source.accumulated_cost,
      source.production_queue,
    ]);

    const rendered = numbersIn(textOf(roleCard(role)));
    const strays = rendered.filter((n) => !allowed.has(n));
    expect({ role, strays }).toEqual({ role, strays: [] });
  });

  it('shows no sum, difference or average of two host_state figures', () => {
    renderRunning();

    const source = ROLE_NUMBERS.RETAILER;
    const text = textOf(roleCard('RETAILER'));
    const derived = [
      source.inventory - source.backlog,
      source.inventory + source.backlog,
      source.supply_line + source.orders_in_flight,
      source.accumulated_cost / WEEK,
    ];
    for (const value of derived) expect(hasNumber(text, value)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Failure mode 10 — a stale host_state
// ---------------------------------------------------------------------------

describe('FAILURE MODE 10: an out-of-order host_state does not rewind the console', () => {
  it('keeps the newer figures when an older seq arrives afterwards', () => {
    seatRoom('RUNNING');

    const older = hostView({ week: 12 }, { RETAILER: { inventory: 700 } });
    const newer = hostView({ week: 18 }, { RETAILER: { inventory: 800 } });

    deliverHostState(newer, 50);
    renderConsole();
    expect(bodyText()).toMatch(new RegExp(`week\\s*18\\s*of\\s*${DURATION}`, 'i'));

    deliverHostState(older, 30);

    const text = bodyText();
    expect(text).toMatch(new RegExp(`week\\s*18\\s*of\\s*${DURATION}`, 'i'));
    expect(hasNumber(text, 800)).toBe(true);
    expect(hasNumber(text, 700)).toBe(false);
  });

  it('applies a newer seq that arrives after an older one', () => {
    seatRoom('RUNNING');

    deliverHostState(hostView({ week: 12 }, { RETAILER: { inventory: 700 } }), 30);
    renderConsole();
    deliverHostState(hostView({ week: 18 }, { RETAILER: { inventory: 800 } }), 50);

    const text = bodyText();
    expect(hasNumber(text, 800)).toBe(true);
    expect(hasNumber(text, 700)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §2.0 — what this module exports
// ---------------------------------------------------------------------------

describe('§2.0: the module’s shape', () => {
  it('exports HostConsole and a default, and no route descriptor', () => {
    const exported = HostConsoleModule as Record<string, unknown>;
    expect(typeof exported.HostConsole).toBe('function');
    expect(exported.default).toBe(exported.HostConsole);
    // `/host/:roomCode` belongs to section 17; a second descriptor would
    // register a duplicate route.
    expect(exported.route).toBeUndefined();
  });

  it('takes no props', () => {
    expect((HostConsole as unknown as { length: number }).length).toBeLessThanOrEqual(1);
    renderRunning();
    expect(bodyText().length).toBeGreaterThan(0);
  });
});
