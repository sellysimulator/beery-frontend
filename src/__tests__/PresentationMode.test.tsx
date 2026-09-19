/**
 * `20-frontend-host-console.md §2.4`, `§3.4`, `§3.4a` and `§3.5` —
 * presentation mode, the projector view.
 *
 * Covers acceptance criteria 15, 16 and 17, and failure modes 1, 2, 8, 9 and
 * 13.
 *
 * Harness notes:
 *  - `§3.4a` is the whole shape of this file: **the mode is state, and full
 *    screen is a side effect of entering it**. jsdom implements no Fullscreen
 *    API — `Element.prototype.requestFullscreen` is `undefined` and
 *    `document.fullscreenElement` is always `null` — so entering and exiting
 *    are read from `data-presenting="true"` on the view's root, and whether
 *    the browser was *asked* for full screen is asserted separately by
 *    stubbing the method.
 *  - `§2.4` says "the console keeps running underneath", so every assertion
 *    about what the room can see is scoped to the presenting root, never to
 *    `document.body`.
 *  - The mode is entered through `HostConsole`'s *Present* control (`§2.2`).
 *    `PresentationMode`'s own props are not declared anywhere in this
 *    section, so rendering it directly would be guessing at an unfrozen
 *    surface.
 *  - **`chart.js` and `react-chartjs-2` are never mocked** (`§2.1a`).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import type { ComponentType } from 'react';
import { render, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { useGameStore } from '../store/gameStore';
import { ROLE_ORDER } from '../types/game';
import type {
  HostRoleView,
  HostView,
  LobbyUpdatePayload,
  Participant,
  Role,
  RoleToAlias,
} from '../types/game';
import { setHostSecret } from '../utils/storage';
import * as HostConsoleModule from '../pages/HostConsole';

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
    onAuthStateChanged: vi.fn(() => () => {}),
    GoogleAuthProvider: class {},
  }),
);

vi.mock('../api/health', () => ({ checkHealth: vi.fn(async () => true) }));

// ---------------------------------------------------------------------------
// The component under test
// ---------------------------------------------------------------------------

type Renderable = ComponentType<Record<string, never>>;

function componentFrom(mod: unknown, name: string): Renderable {
  const exported = mod as Record<string, unknown>;
  const found = exported[name] ?? exported.default;
  if (typeof found !== 'function') {
    throw new Error(`20 §2.0: \`src/pages/${name}.tsx\` must export \`${name}\`, taking no props.`);
  }
  return found as Renderable;
}

const HostConsole = componentFrom(HostConsoleModule, 'HostConsole');

// ---------------------------------------------------------------------------
// Fixtures — four distinct orders and four distinct costs (failure modes 1, 2)
// ---------------------------------------------------------------------------

const ROOM = 'HST742';
const SECRET = 'host-secret-fixture';

const WEEK = 17;
const DURATION = 24;
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
    supply_line: 243,
    orders_in_flight: 244,
    last_order: 245,
    incoming_order: 246,
    accumulated_cost: 247,
    production_queue: 248,
  },
};

/** `§2.4`: no order quantity may reach the projector. */
const ORDER_QUANTITIES = ROLE_ORDER.map((role) => ROLE_NUMBERS[role].last_order as number);

/** The quantities the neighbours demanded — also orders, also private. */
const UPSTREAM_INCOMING = (['WHOLESALER', 'DISTRIBUTOR', 'FACTORY'] as Role[]).map(
  (role) => ROLE_NUMBERS[role].incoming_order,
);

/** `§2.4`: no cost may reach the projector either. */
const COSTS = [...ROLE_ORDER.map((role) => ROLE_NUMBERS[role].accumulated_cost), CHAIN_TOTAL_COST];

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

const AWAITED: Role[] = ['DISTRIBUTOR', 'FACTORY'];

function hostRole(role: Role, over: Partial<HostRoleView> = {}): HostRoleView {
  return {
    ...ROLE_NUMBERS[role],
    has_submitted: !AWAITED.includes(role),
    is_bot: false,
    ...over,
  };
}

function hostView(roleOver: Partial<Record<Role, Partial<HostRoleView>>> = {}): HostView {
  return {
    week: WEEK,
    duration_weeks: DURATION,
    phase: 'DECISION',
    currency_symbol: '$',
    demand_series: [...DEMAND_SERIES],
    awaiting_roles: [...AWAITED],
    chain_total_cost: CHAIN_TOTAL_COST,
    roles: {
      RETAILER: hostRole('RETAILER', roleOver.RETAILER),
      WHOLESALER: hostRole('WHOLESALER', roleOver.WHOLESALER),
      DISTRIBUTOR: hostRole('DISTRIBUTOR', roleOver.DISTRIBUTOR),
      FACTORY: hostRole('FACTORY', roleOver.FACTORY),
    },
  };
}

function participantsFor(): Participant[] {
  return ROLE_ORDER.map((role) => ({
    alias: ALIASES[role] as string,
    display_name: NAMES[role],
    role,
    is_bot: false,
    connected: true,
    is_host: false,
  }));
}

function lobbyUpdate(): Omit<LobbyUpdatePayload, 'seq'> {
  return {
    state: 'RUNNING',
    host_display_name: 'Professor',
    participants: participantsFor(),
    role_to_alias: ALIASES,
    role_assignment_mode: 'HOST_ASSIGNS',
    seats_total: 4,
    config_locked: true,
    can_start: false,
    start_blocked_reason: 'The game is already running.',
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

function dispatch(event: string, payload?: unknown): void {
  const listeners = [...(rec.listeners.get(event) ?? [])];
  if (listeners.length === 0) {
    throw new Error(`Nothing is listening for "${event}" (12 §2, registered by section 16).`);
  }
  act(() => {
    for (const cb of listeners) cb(payload);
  });
}

function renderRunning(view: HostView = hostView()) {
  act(() => {
    useGameStore.getState().setRoomCode(ROOM);
    useGameStore.getState().setIsHost(true);
  });
  dispatch('lobby_update', { seq: nextSeq(), ...lobbyUpdate() });
  dispatch('host_state', { seq: nextSeq(), ...view });
  return render(
    <MemoryRouter initialEntries={[`/host/${ROOM}`]}>
      <Routes>
        <Route path="/host/:roomCode" element={<HostConsole />} />
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

function allElements(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('*'));
}

function smallest(predicate: (text: string, el: HTMLElement) => boolean, root: ParentNode) {
  return allElements(root)
    .filter((el) => predicate(textOf(el), el))
    .sort((a, b) => textOf(a).length - textOf(b).length)[0];
}

function numbersIn(text: string): number[] {
  const found = text.match(/(?<![A-Za-z0-9.])-?\d[\d,]*(?:\.\d+)?/g) ?? [];
  return found.map((raw) => Number(raw.replace(/,/g, ''))).filter((n) => Number.isFinite(n));
}

function hasNumber(text: string, value: number): boolean {
  return numbersIn(text).some((n) => n === value);
}

function depth(el: Element): number {
  let n = 0;
  let node: Element | null = el.parentElement;
  while (node) {
    n += 1;
    node = node.parentElement;
  }
  return n;
}

function presenting(): boolean {
  return document.querySelector('[data-presenting="true"]') !== null;
}

/**
 * `§3.4a`: "The view carries `data-presenting="true"` on its root", which is
 * both the plain-CSS fallback's hook and what criterion 15 reads. The deepest
 * such element is taken, so nesting the projector view inside a presenting
 * wrapper still scopes the assertions to the view itself.
 */
function presentingRoot(): HTMLElement {
  const roots = Array.from(document.querySelectorAll<HTMLElement>('[data-presenting="true"]')).sort(
    (a, b) => depth(b) - depth(a),
  );
  if (roots.length === 0) {
    throw new Error(
      '20 §3.4a and criterion 15: entering presentation mode must render the projector view ' +
        `with \`data-presenting="true"\` on its root. The page rendered: ${bodyText()}`,
    );
  }
  return roots[0];
}

function presentingText(): string {
  return textOf(presentingRoot());
}

const CONTROL_SELECTOR = 'button, [role="button"], input[type="button"], input[type="submit"], a[href]';

function nameOf(el: HTMLElement): string {
  const own = textOf(el);
  if (own) return own;
  return norm(el.getAttribute('aria-label') ?? el.getAttribute('title') ?? '');
}

function control(re: RegExp, what: string, root: ParentNode = document.body): HTMLElement {
  const matches = Array.from(root.querySelectorAll<HTMLElement>(CONTROL_SELECTOR))
    .filter((el) => re.test(nameOf(el)))
    .sort((a, b) => nameOf(a).length - nameOf(b).length);
  if (matches.length === 0) {
    throw new Error(`20 §2.2: no control named "${what}" (${re}). The page rendered: ${bodyText()}`);
  }
  return matches[0];
}

async function enterPresentation(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(control(/present/i, 'Present'));
}

/** The demand curve's visually hidden table, inside a given root (`§2.1a`). */
function demandTable(root: ParentNode): HTMLElement {
  const tables = Array.from(root.querySelectorAll<HTMLElement>('table, [role="table"]'));
  const found = tables.find((t) => {
    const text = textOf(t);
    return DEMAND_SERIES.every((value) => hasNumber(text, value));
  });
  if (!found) {
    throw new Error(
      '20 §2.4 and criterion 15: presentation mode must show the demand curve, which renders a ' +
        'visually hidden table of the full series (§2.1a). None was found inside the projector ' +
        `view, which rendered: ${textOf(root as Node)}`,
    );
  }
  return found;
}

function dataRows(table: HTMLElement): HTMLElement[] {
  return Array.from(table.querySelectorAll<HTMLElement>('tr, [role="row"]')).filter(
    (row) => numbersIn(textOf(row)).length > 0,
  );
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await import('../api/socket');
  await import('../api/socketHandlers');
});

beforeEach(() => {
  seq = 0;
  rec.emits.length = 0;
  act(() => {
    useGameStore.getState().reset();
  });
  setHostSecret(ROOM, SECRET);
});

afterEach(() => {
  delete (Element.prototype as unknown as Record<string, unknown>).requestFullscreen;
  delete (Document.prototype as unknown as Record<string, unknown>).exitFullscreen;
  act(() => {
    useGameStore.getState().reset();
  });
});

// ---------------------------------------------------------------------------
// Failure mode 13 — full screen is not the mechanism
// ---------------------------------------------------------------------------

describe('FAILURE MODE 13: presentation mode enters and exits with no Fullscreen API at all', () => {
  it('jsdom really has none — the premise of §3.4a', () => {
    expect((Element.prototype as unknown as Record<string, unknown>).requestFullscreen).toBeUndefined();
    // `§3.4a` says `document.fullscreenElement` "is always null"; jsdom does
    // not define the property at all, which is the same thing for any code
    // that reads it — so the assertion is "never an element".
    expect(document.fullscreenElement).toBeFalsy();
  });

  it('enters with requestFullscreen absent', async () => {
    const user = userEvent.setup();
    renderRunning();

    expect(presenting()).toBe(false);
    await enterPresentation(user);

    expect(presenting()).toBe(true);
  });

  it('exits with requestFullscreen absent, and with no fullscreenchange ever fired', async () => {
    const user = userEvent.setup();
    renderRunning();
    await enterPresentation(user);

    await user.keyboard('{Escape}');

    expect(presenting()).toBe(false);
  });

  it('exits through the exit affordance as well', async () => {
    const user = userEvent.setup();
    renderRunning();
    await enterPresentation(user);

    await user.click(control(/exit|close|leave|stop present|back to (the )?console/i, 'the exit affordance', presentingRoot()));

    expect(presenting()).toBe(false);
  });

  it('leaves the console running underneath, so exiting is instant', async () => {
    const user = userEvent.setup();
    renderRunning();
    await enterPresentation(user);
    await user.keyboard('{Escape}');

    // The console is back, with its figures, without a resync.
    expect(hasNumber(bodyText(), ROLE_NUMBERS.RETAILER.accumulated_cost)).toBe(true);
    expect(bodyText()).toMatch(new RegExp(`week\\s*${WEEK}\\s*of\\s*${DURATION}`, 'i'));
  });
});

// ---------------------------------------------------------------------------
// Criterion 15 — what the projector shows, and how it is left
// ---------------------------------------------------------------------------

describe('CRITERION 15: presentation mode enters full screen and renders the chain, the week, the curve and the tracker', () => {
  it('asks the browser for full screen when the API exists', async () => {
    const asked: Element[] = [];
    Object.defineProperty(Element.prototype, 'requestFullscreen', {
      value: function requestFullscreen(this: Element) {
        asked.push(this);
        return Promise.resolve();
      },
      configurable: true,
      writable: true,
    });

    const user = userEvent.setup();
    renderRunning();
    await enterPresentation(user);

    expect(presenting()).toBe(true);
    expect(asked.length).toBeGreaterThan(0);
  });

  it('still enters when the browser refuses the request', async () => {
    Object.defineProperty(Element.prototype, 'requestFullscreen', {
      value: function requestFullscreen() {
        return Promise.reject(new Error('refused outside a user gesture'));
      },
      configurable: true,
      writable: true,
    });

    const user = userEvent.setup();
    renderRunning();
    await enterPresentation(user);

    expect(presenting()).toBe(true);
  });

  it('renders the whole chain', async () => {
    const user = userEvent.setup();
    renderRunning();
    await enterPresentation(user);

    const text = presentingText();
    for (const role of ROLE_ORDER) expect(text).toMatch(new RegExp(role, 'i'));
  });

  it('renders the week', async () => {
    const user = userEvent.setup();
    renderRunning();
    await enterPresentation(user);

    expect(presentingText()).toMatch(new RegExp(`week\\s*${WEEK}\\s*of\\s*${DURATION}`, 'i'));
  });

  it('renders the demand curve with the current week marked', async () => {
    const user = userEvent.setup();
    renderRunning();
    await enterPresentation(user);

    const rows = dataRows(demandTable(presentingRoot()));
    expect(rows).toHaveLength(DURATION);
    expect(hasNumber(textOf(rows[WEEK - 1]), DEMAND_SERIES[WEEK - 1])).toBe(true);
  });

  it('renders the submission tracker', async () => {
    const user = userEvent.setup();
    renderRunning();
    await enterPresentation(user);

    const text = presentingText();
    for (const role of ROLE_ORDER) expect(text).toContain(NAMES[role]);
  });

  it('offers no control except an exit affordance (§2.4)', async () => {
    const user = userEvent.setup();
    renderRunning();
    await enterPresentation(user);

    const controls = Array.from(presentingRoot().querySelectorAll<HTMLElement>(CONTROL_SELECTOR));
    const notExit = controls.filter(
      (el) => !/exit|close|leave|stop present|back to (the )?console|×/i.test(nameOf(el)),
    );
    expect(notExit.map((el) => nameOf(el))).toEqual([]);
  });

  it('exits on Escape', async () => {
    const user = userEvent.setup();
    renderRunning();
    await enterPresentation(user);
    expect(presenting()).toBe(true);

    await user.keyboard('{Escape}');

    expect(presenting()).toBe(false);
  });

  it('can be re-entered after exiting', async () => {
    const user = userEvent.setup();
    renderRunning();
    await enterPresentation(user);
    await user.keyboard('{Escape}');
    await enterPresentation(user);

    expect(presenting()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Criterion 16 and failure modes 1 and 2 — what the room must never see
// ---------------------------------------------------------------------------

describe('CRITERION 16 / FAILURE MODE 1: no order quantity reaches the projector', () => {
  it('shows none of the four orders placed this week', async () => {
    const user = userEvent.setup();
    renderRunning();
    await enterPresentation(user);

    const text = presentingText();
    const leaked = ORDER_QUANTITIES.filter((value) => hasNumber(text, value));
    expect(leaked).toEqual([]);
  });

  it('shows none of the quantities a role’s neighbour demanded of it', async () => {
    const user = userEvent.setup();
    renderRunning();
    await enterPresentation(user);

    const text = presentingText();
    const leaked = UPSTREAM_INCOMING.filter((value) => hasNumber(text, value));
    expect(leaked).toEqual([]);
  });

  it('shows no order quantity in an attribute either', async () => {
    const user = userEvent.setup();
    renderRunning();
    await enterPresentation(user);

    const attributes = allElements(presentingRoot())
      .flatMap((el) => Array.from(el.attributes))
      .filter((a) => a.name !== 'class' && a.name !== 'style')
      .map((a) => a.value)
      .join(' ');
    for (const value of ORDER_QUANTITIES) expect(hasNumber(attributes, value)).toBe(false);
  });
});

describe('CRITERION 16 / FAILURE MODE 2: no cost reaches the projector', () => {
  it('shows no currency symbol', async () => {
    const user = userEvent.setup();
    renderRunning();
    await enterPresentation(user);

    expect(presentingText()).not.toContain('$');
    expect(presentingText()).not.toMatch(/\bcost\b|\bspent\b|\bbalance\b/i);
  });

  it('shows none of the accumulated costs and not the chain total', async () => {
    const user = userEvent.setup();
    renderRunning();
    await enterPresentation(user);

    const text = presentingText();
    const leaked = COSTS.filter((value) => hasNumber(text, value));
    expect(leaked).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Criterion 17 — the submission tracker
// ---------------------------------------------------------------------------

describe('CRITERION 17: the submission tracker shows names and tick state only', () => {
  /** The smallest element naming a player, plus whatever marks it. */
  function trackerRow(role: Role): HTMLElement {
    const leaf = smallest((text) => text.includes(NAMES[role]), presentingRoot());
    if (!leaf) {
      throw new Error(`20 §2.4: the submission tracker must name ${NAMES[role]}.`);
    }
    // Widen to the parent only while it still belongs to this player alone,
    // so the tick beside the name is included but the whole list is not.
    const others = ROLE_ORDER.filter((r) => r !== role).map((r) => NAMES[r]);
    const parent = leaf.parentElement;
    if (parent && presentingRoot().contains(parent) && !others.some((n) => textOf(parent).includes(n))) {
      return parent;
    }
    return leaf;
  }

  function tickState(role: Role): string {
    return textOf(trackerRow(role))
      .replace(new RegExp(NAMES[role], 'gi'), '')
      .replace(new RegExp(role, 'gi'), '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  it('names all four players', async () => {
    const user = userEvent.setup();
    renderRunning();
    await enterPresentation(user);

    for (const role of ROLE_ORDER) expect(presentingText()).toContain(NAMES[role]);
  });

  it('ticks the two who have decided and not the two who have not', async () => {
    const user = userEvent.setup();
    renderRunning();
    await enterPresentation(user);

    expect(tickState('RETAILER')).toBe(tickState('WHOLESALER'));
    expect(tickState('DISTRIBUTOR')).toBe(tickState('FACTORY'));
    expect(tickState('RETAILER')).not.toBe(tickState('DISTRIBUTOR'));
  });

  it('puts no quantity beside a name', async () => {
    const user = userEvent.setup();
    renderRunning();
    await enterPresentation(user);

    for (const role of ROLE_ORDER) {
      const text = textOf(trackerRow(role));
      expect(hasNumber(text, ROLE_NUMBERS[role].last_order as number)).toBe(false);
      expect(hasNumber(text, ROLE_NUMBERS[role].accumulated_cost)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Failure mode 8 — no second socket
// ---------------------------------------------------------------------------

describe('FAILURE MODE 8: entering presentation mode opens no additional connection', () => {
  it('creates no new client and calls connect() no more times', async () => {
    const user = userEvent.setup();
    renderRunning();

    const clientsBefore = rec.ioCalls;
    const connectsBefore = rec.connectCalls;

    await enterPresentation(user);

    expect(rec.ioCalls).toBe(clientsBefore);
    expect(rec.connectCalls).toBe(connectsBefore);
  });

  it('polls nothing: presenting emits no request_state of its own', async () => {
    const user = userEvent.setup();
    renderRunning();

    rec.emits.length = 0;
    await enterPresentation(user);

    expect(rec.emits.filter((e) => e.event === 'request_state')).toHaveLength(0);
  });

  it('reads the same store as the console — a new host_state updates the projector', async () => {
    const user = userEvent.setup();
    renderRunning();
    await enterPresentation(user);

    dispatch('host_state', { seq: nextSeq(), ...hostView(), week: 18 });

    expect(presentingText()).toMatch(new RegExp(`week\\s*18\\s*of\\s*${DURATION}`, 'i'));
  });
});

// ---------------------------------------------------------------------------
// Failure mode 9 — backlog is never conveyed by colour alone
// ---------------------------------------------------------------------------

describe('FAILURE MODE 9: the chain diagram’s backlog indicator carries a non-colour signal', () => {
  const GLYPHS = ['⚠', '!', '▲', '✖', '✗', '✘', '▨', '▩', '░', '▒'];

  /**
   * `§3.5`: "no information conveyed by colour alone — backlog carries a
   * pattern or an icon as well". Any of: words, a figure, an icon element, a
   * glyph, an accessible description, or a declared pattern. Only a bare
   * change of colour fails.
   */
  function nonColourSignal(el: HTMLElement): boolean {
    const text = textOf(el);
    if (/backlog|short|owed|behind|unfulfilled|waiting|owes/i.test(text)) return true;
    if (GLYPHS.some((glyph) => text.includes(glyph))) return true;
    if (el.tagName.toLowerCase() === 'svg' || el.querySelector('svg, img')) return true;
    for (const attr of Array.from(el.attributes)) {
      if (attr.name === 'style') continue;
      if (/backlog|pattern|stripe|hatch|hash|icon|warn|alert/i.test(`${attr.name} ${attr.value}`)) return true;
    }
    return false;
  }

  it('signals a backlogged link with more than a colour', async () => {
    const user = userEvent.setup();
    // The Retailer is clear; the Distributor is deep in backlog.
    renderRunning(hostView({ RETAILER: { backlog: 0 } }));
    await enterPresentation(user);

    const others = ROLE_ORDER.filter((r) => r !== 'DISTRIBUTOR');
    const links = allElements(presentingRoot()).filter((el) => {
      const text = textOf(el);
      return /distributor/i.test(text) && !others.some((o) => new RegExp(o, 'i').test(text));
    });

    if (links.length === 0) {
      throw new Error(
        '20 §2.4 and criterion 15: the projector must render the chain diagram, naming each ' +
          `link. Nothing named the Distributor alone. The view rendered: ${presentingText()}`,
      );
    }

    expect(links.some(nonColourSignal)).toBe(true);
  });
});
