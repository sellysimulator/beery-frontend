/**
 * `21-frontend-results.md` — `/results/:roomCode`, the debrief screen.
 *
 * Covers acceptance criteria 1, 2, 3, 8, 9, 14, 15, 16, 17, 18, 19, 20, 21,
 * 22 and 23, and failure modes 3, 4, 6, 7, 9, 10, 11, 12 and 14. Criteria 4, 5, 6,
 * 7 and 24 and failure modes 1, 2 and 8 are in `BullwhipChart.test.tsx`;
 * criteria 10, 11, 12 and 13 and failure mode 5 in `ExportControls.test.tsx`.
 *
 * Harness notes:
 *  - `src/api/http.ts` is replaced by a recorder, so every request the screen
 *    makes is observed as a wire call (`15 §2` names the two routes this
 *    screen uses). Nothing else about the HTTP layer is mocked.
 *  - `src/auth/AuthContext.tsx` is replaced by a stub of the value `16 §3`
 *    freezes, because `§2.5` gates the claim prompt on `useAuth().mode` and
 *    there is no other declared way to put the context into guest mode.
 *    `signInWithGoogle` resolves without changing `mode`, so the component's
 *    own post-sign-in flow (`§2.5`: sign in, *then* `POST /games/claim`) is
 *    what the test observes.
 *  - Store state is driven only through section 16's frozen actions, and
 *    browser state only through section 16's storage helpers.
 *  - `chart.js` and `react-chartjs-2` are **not** mocked (failure mode 13).
 *    The chart is read through its visually hidden per-week table (`§2.2a`).
 *  - Every figure is matched tolerantly (`$1,234.50`, `1234.5`, `92%` for
 *    `0.92`), because `00-conventions.md §5` forbids asserting on formatting
 *    the section does not specify — but a *different* number never matches.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { useGameStore } from '../store/gameStore';
import { ROLE_ORDER } from '../types/game';
import type {
  GameFinishedPayload,
  LobbyUpdatePayload,
  Participant,
  Role,
  RoleStats,
  RoleToAlias,
} from '../types/game';
import {
  getGuestId,
  getOrCreateGuestId,
  setHostRoom,
  setHostSecret,
  setSessionToken,
} from '../utils/storage';
import type { RouteDescriptor } from '../routes/registry';
import * as ResultsPageModule from '../pages/ResultsPage';

// Rendering the whole screen in jsdom is slow, and slower still while the
// rest of the suite runs beside it.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

// ---------------------------------------------------------------------------
// Harness — transport recorders
// ---------------------------------------------------------------------------

type Listener = (...args: unknown[]) => void;

const rec = vi.hoisted(() => ({ emits: [] as Array<{ event: string; payload: unknown }> }));

vi.mock('socket.io-client', () => {
  const listeners = new Map<string, Listener[]>();
  const socket: Record<string, unknown> = {
    id: 'test-sid',
    connected: false,
    on: (event: string, cb: Listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), cb]);
      return socket;
    },
    once: (event: string, cb: Listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), cb]);
      return socket;
    },
    off: () => socket,
    removeAllListeners: () => socket,
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
    onAuthStateChanged: vi.fn(() => () => {}),
    signInWithPopup: vi.fn(async () => ({ user: { uid: 'uid-1', displayName: 'Ana' } })),
    signOut: vi.fn(async () => undefined),
    GoogleAuthProvider: class {},
  }),
);

const httpRec = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  defaults: { baseURL: '/api/v1' },
}));

vi.mock('../api/http', () => ({
  default: httpRec,
  http: httpRec,
  errorMessage: (err: unknown, fallback: string) => {
    const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
    return typeof detail === 'string' ? detail : fallback;
  },
}));

const auth = vi.hoisted(() => ({
  signIn: vi.fn(async () => {}),
  value: {} as Record<string, unknown>,
}));

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => auth.value,
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** `10 §2`'s alphabet excludes 0, O, 1, I and L; these carry no digits at all. */
const ROOM = 'BEERYX';
const OTHER = 'MASHUP';
const HOST_SECRET = 'host-secret-for-tests';

const WEEKS = 6;
const WEEK_NUMBERS = [1, 2, 3, 4, 5, 6];

const DEMAND = [4, 4, 12, 12, 12, 12];

const ORDERS: Record<Role, number[]> = {
  RETAILER: [5, 7, 21, 18, 14, 11],
  WHOLESALER: [6, 13, 30, 24, 16, 9],
  DISTRIBUTOR: [8, 19, 41, 33, 20, 7],
  FACTORY: [10, 26, 55, 44, 25, 6],
};

const NAMES: Record<Role, string> = {
  RETAILER: 'Ana',
  WHOLESALER: 'Ben',
  DISTRIBUTOR: 'Cleo',
  FACTORY: 'Autopilot',
};

const IS_BOT: Record<Role, boolean> = {
  RETAILER: false,
  WHOLESALER: false,
  DISTRIBUTOR: false,
  FACTORY: true,
};

/**
 * Deliberately *not* derivable from `ORDERS`: `Var(retailer orders) / 16` is
 * 2.01, not 1.75, and the retailer's order variance is 32.2, not 31.25. A
 * screen that recomputes either renders a number that is not here (FM 4).
 */
const STATS: Record<Role, RoleStats> = {
  RETAILER: {
    role: 'RETAILER',
    total_cost: 412.5,
    peak_inventory: 23,
    peak_backlog: 9,
    weeks_in_backlog: 4,
    order_variance: 31.25,
    bullwhip_ratio: 1.75,
    fill_rate: 0.92,
    average_order: 12.5,
  },
  WHOLESALER: {
    role: 'WHOLESALER',
    total_cost: 638.25,
    peak_inventory: 34,
    peak_backlog: 11,
    weeks_in_backlog: 3,
    order_variance: 62.5,
    bullwhip_ratio: 3.5,
    fill_rate: 0.81,
    average_order: 16.25,
  },
  DISTRIBUTOR: {
    role: 'DISTRIBUTOR',
    total_cost: 907.75,
    peak_inventory: 46,
    peak_backlog: 15,
    weeks_in_backlog: 4,
    order_variance: 121.75,
    bullwhip_ratio: 6.25,
    fill_rate: 0.74,
    average_order: 21.75,
  },
  FACTORY: {
    role: 'FACTORY',
    total_cost: 1284.5,
    peak_inventory: 58,
    peak_backlog: 19,
    weeks_in_backlog: 5,
    order_variance: 244.5,
    bullwhip_ratio: 12.5,
    fill_rate: 0.63,
    average_order: 27.5,
  },
};

const CHAIN_TOTAL = 3243;
const DEMAND_VARIANCE = 16;

/** Deliberately unlike every other figure on the screen. */
const CLAIMED = 37;

/** Per-week series only the by-URL path carries (`§2.0`). */
const INVENTORY: Record<Role, number[]> = {
  RETAILER: [21, 17, 13, 9, 5, 3],
  WHOLESALER: [31, 27, 22, 18, 13, 8],
  DISTRIBUTOR: [43, 38, 32, 27, 21, 16],
  FACTORY: [57, 51, 44, 38, 31, 24],
};
const BACKLOG: Record<Role, number[]> = {
  RETAILER: [2, 3, 5, 6, 7, 4],
  WHOLESALER: [3, 5, 8, 9, 11, 6],
  DISTRIBUTOR: [4, 7, 10, 13, 15, 9],
  FACTORY: [5, 9, 13, 17, 19, 12],
};
const CUMULATIVE: Record<Role, number[]> = {
  RETAILER: [68.5, 137.25, 205.75, 274.5, 343.25, 412.5],
  WHOLESALER: [106.5, 212.75, 319.25, 425.5, 531.75, 638.25],
  DISTRIBUTOR: [151.25, 302.5, 453.75, 605, 756.25, 907.75],
  FACTORY: [214, 428.25, 642.5, 856.75, 1070.75, 1284.5],
};

interface RoleResultFixture extends RoleStats {
  display_name: string;
  is_bot: boolean;
  orders: number[];
  inventory: number[];
  backlog: number[];
  cumulative_cost: number[];
}

function roleResult(role: Role, over: Partial<RoleResultFixture> = {}): RoleResultFixture {
  return {
    ...STATS[role],
    display_name: NAMES[role],
    is_bot: IS_BOT[role],
    orders: ORDERS[role],
    inventory: INVENTORY[role],
    backlog: BACKLOG[role],
    cumulative_cost: CUMULATIVE[role],
    ...over,
  };
}

/** `15 §2`'s `ResultsResponse`. */
function resultsResponse(over: Record<string, unknown> = {}) {
  return {
    room_code: ROOM,
    weeks_played: WEEKS,
    duration_weeks: WEEKS,
    ended_early: false,
    currency_symbol: '$',
    started_at: '2026-03-04T10:00:00Z',
    finished_at: '2026-03-04T10:42:00Z',
    demand_series: DEMAND,
    chain_total_cost: CHAIN_TOTAL,
    demand_variance: DEMAND_VARIANCE,
    per_role: ROLE_ORDER.map((role) => roleResult(role)),
    preset_name: 'Classic MIT',
    ...over,
  };
}

const PARTICIPANTS: Participant[] = ROLE_ORDER.map((role, index) => ({
  alias: `P${index + 1}`,
  display_name: NAMES[role],
  role,
  is_bot: IS_BOT[role],
  connected: true,
  is_host: false,
}));

const ROLE_TO_ALIAS = ROLE_ORDER.reduce((acc, role, index) => {
  acc[role] = `P${index + 1}`;
  return acc;
}, {} as RoleToAlias);

const LOBBY: LobbyUpdatePayload = {
  seq: 1,
  state: 'FINISHED',
  host_display_name: 'Ana',
  participants: PARTICIPANTS,
  role_to_alias: ROLE_TO_ALIAS,
  role_assignment_mode: 'HOST_ASSIGNS',
  seats_total: 4,
  config_locked: true,
  can_start: false,
  start_blocked_reason: 'The game has finished.',
};

const FINISHED: GameFinishedPayload = {
  seq: 2,
  weeks_played: WEEKS,
  stats: {
    weeks_played: WEEKS,
    demand_variance: DEMAND_VARIANCE,
    chain_total_cost: CHAIN_TOTAL,
    per_role: STATS,
  },
  demand_series: DEMAND,
  orders_by_role: ORDERS,
};

function axiosError(status: number, detail: string): unknown {
  return {
    isAxiosError: true,
    message: `Request failed with status code ${status}`,
    response: { status, data: { detail } },
  };
}

// ---------------------------------------------------------------------------
// Text and value helpers
// ---------------------------------------------------------------------------

function norm(text: string): string {
  return text
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[—–]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function bodyText(): string {
  return norm(document.body.textContent ?? '');
}

/**
 * The text of every leaf element, separated. Adjacent table cells run their
 * numbers together in `textContent` (`23` and `7` become `237`), so every
 * assertion about *figures* reads this instead of the raw body text.
 */
function figuresText(): string {
  return Array.from(document.body.querySelectorAll<HTMLElement>('*'))
    .filter((el) => el.children.length === 0)
    .map((el) => norm(el.textContent ?? ''))
    .join(' | ');
}

function textOf(el: Element): string {
  return norm(el.textContent ?? '');
}

/** Numeric tokens, with thousands separators removed. */
function numericTokens(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((t) => t.replace(/,/g, ''));
}

function asNumber(text: string): number | null {
  const cleaned = text.replace(/[\s,$€£¥%]/g, '');
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

/**
 * Whether `text` renders the server value `v`. A rate may legitimately be
 * shown as a percentage, and anything may be rounded for display, so both are
 * accepted — a *different* server number never is.
 */
function matchesValue(text: string, v: number): boolean {
  const n = asNumber(text);
  if (n === null) return false;
  const rate = v > 0 && v < 1;
  const candidates = rate ? [v, v * 100] : [v];
  // Half of the last displayed digit: `16.3` renders 16.25, `13` renders 12.5,
  // but no rendering of one server figure is ever another one.
  const decimals = /\.(\d+)/.exec(text)?.[1].length ?? 0;
  const tolerance = 0.5 * 10 ** -decimals + 1e-9;
  return candidates.some((c) => Math.abs(c - n) < tolerance);
}

function textHasValue(text: string, v: number): boolean {
  return numericTokens(text).some((token) => matchesValue(token, v));
}

function cellValues(row: HTMLElement): string[] {
  return cellsOf(row).map(textOf);
}

function rowHasValue(row: HTMLElement, v: number): boolean {
  return cellValues(row).some((cell) => matchesValue(cell, v));
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

const CONTROL_SELECTOR = [
  'button',
  '[role="button"]',
  'a[href]',
  'summary',
  'input[type="button"]',
  'input[type="submit"]',
  'input[type="checkbox"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="tab"]',
  '[role="menuitem"]',
].join(', ');

function accessibleName(el: HTMLElement): string {
  const parts: string[] = [];
  const aria = el.getAttribute('aria-label');
  if (aria) parts.push(aria);
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    for (const id of labelledBy.split(/\s+/)) {
      const target = document.getElementById(id);
      if (target) parts.push(target.textContent ?? '');
    }
  }
  if (el.id) {
    for (const label of Array.from(document.querySelectorAll(`label[for="${el.id}"]`))) {
      parts.push(label.textContent ?? '');
    }
  }
  const wrapping = el.closest('label');
  if (wrapping) parts.push(wrapping.textContent ?? '');
  const title = el.getAttribute('title');
  if (title) parts.push(title);
  if (el instanceof HTMLInputElement && el.value) parts.push(el.value);
  parts.push(el.textContent ?? '');
  return norm(parts.join(' '));
}

function controlsMatching(re: RegExp): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(CONTROL_SELECTOR))
    .filter((el) => re.test(accessibleName(el)))
    .sort((a, b) => accessibleName(a).length - accessibleName(b).length);
}

function control(re: RegExp, what: string): HTMLElement {
  const found = controlsMatching(re);
  if (found.length === 0) {
    throw new Error(`No control for ${what} (${re}). The screen rendered: ${bodyText()}`);
  }
  return found[0];
}

function tables(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('table, [role="table"]'));
}

function rowsOf(table: HTMLElement): HTMLElement[] {
  return Array.from(table.querySelectorAll<HTMLElement>('tr, [role="row"]'));
}

function cellsOf(row: HTMLElement): HTMLElement[] {
  return Array.from(
    row.querySelectorAll<HTMLElement>(
      'td, th, [role="cell"], [role="rowheader"], [role="columnheader"]',
    ),
  );
}

function numericCells(row: HTMLElement): number[] {
  return cellsOf(row)
    .map((cell) => asNumber(textOf(cell)))
    .filter((n): n is number => n !== null);
}

/** `§2.2a`: the chart's visually hidden table — one row per week, five series. */
function chartTable(): HTMLElement {
  const found = tables().find(
    (t) => rowsOf(t).filter((row) => numericCells(row).length >= 5).length === WEEKS,
  );
  if (!found) {
    throw new Error(
      '§2.2a requires the chart to render a visually hidden table as well, one row per ' +
        `week with a column for demand and one per role; no such table was rendered. The ` +
        `screen rendered: ${bodyText()}`,
    );
  }
  return found;
}

/** The chart table's columns, with the week column dropped. */
function chartSeries(): number[][] {
  const rows = rowsOf(chartTable())
    .map(numericCells)
    .filter((cells) => cells.length >= 5);
  const width = Math.min(...rows.map((r) => r.length));
  const columns: number[][] = [];
  for (let i = 0; i < width; i += 1) columns.push(rows.map((r) => r[i]));
  return columns.filter((col) => col.join(',') !== WEEK_NUMBERS.join(','));
}

/** `§2.3`: the per-role statistics table. */
function ratioTable(): HTMLElement {
  const found = tables().find((t) => {
    const text = textOf(t);
    const cells = rowsOf(t).flatMap(cellValues);
    const namesAllRoles = ROLE_ORDER.every((role) => new RegExp(role, 'i').test(text));
    const carriesPeaks = ROLE_ORDER.every((role) =>
      cells.some((cell) => matchesValue(cell, STATS[role].peak_inventory)),
    );
    return namesAllRoles && carriesPeaks;
  });
  if (!found) {
    throw new Error(
      `§2.3 requires a per-role statistics table; none was rendered. The screen rendered: ${bodyText()}`,
    );
  }
  return found;
}

/** The statistics table's four data rows, in the order they are rendered. */
function ratioRows(): Array<{ role: Role; row: HTMLElement }> {
  const out: Array<{ role: Role; row: HTMLElement }> = [];
  for (const row of rowsOf(ratioTable())) {
    const text = textOf(row);
    const role = ROLE_ORDER.find((r) => new RegExp(r, 'i').test(text));
    if (role && !out.some((entry) => entry.role === role)) out.push({ role, row });
  }
  return out;
}

function rowFor(role: Role): HTMLElement {
  const found = ratioRows().find((entry) => entry.role === role);
  if (!found) throw new Error(`§2.3 requires a row for ${role}; the table has none.`);
  return found.row;
}

/** The deepest element whose text contains `needle`, in document order. */
function smallestContaining(needle: string): HTMLElement {
  const all = Array.from(document.body.querySelectorAll<HTMLElement>('*')).filter((el) =>
    textOf(el).includes(needle),
  );
  const deepest = all.filter((el) => !all.some((other) => other !== el && el.contains(other)));
  if (deepest.length === 0) {
    throw new Error(`Nothing on the screen renders "${needle}". It rendered: ${bodyText()}`);
  }
  return deepest[0];
}

function precedes(a: Element, b: Element): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/** `§3.3`: the print disposition of the region a node sits in. */
function printDisposition(el: Element): string | null {
  const holder = el.closest('[data-print]');
  return holder ? holder.getAttribute('data-print') : null;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function descriptor(): RouteDescriptor {
  const exported = (ResultsPageModule as { route?: RouteDescriptor | RouteDescriptor[] }).route;
  if (!exported) {
    throw new Error('ResultsPage.tsx exports no `route` descriptor (21 §3.0, 16 §3 registry).');
  }
  const all = Array.isArray(exported) ? exported : [exported];
  const found = all.find((d) => d.path.startsWith('/results'));
  if (!found) throw new Error('ResultsPage.tsx declares no `/results/:roomCode` route (21 §3.0).');
  return found;
}

const seen: string[] = [];

function LocationProbe() {
  seen.push(useLocation().pathname);
  return null;
}

function currentPath(): string {
  return seen[seen.length - 1] ?? '';
}

function renderResults(code: string = ROOM) {
  const route = descriptor();
  return render(
    <MemoryRouter initialEntries={[`/results/${code}`]}>
      <LocationProbe />
      <Routes>
        <Route path={route.path} element={route.element} />
        <Route path="/home" element={<div data-testid="home" />} />
        <Route path="/profile" element={<div data-testid="profile" />} />
        <Route path="*" element={<div data-testid="elsewhere" />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Renders and waits for the screen to have its figures. */
async function renderReady(code: string = ROOM) {
  const result = renderResults(code);
  await waitFor(() => {
    expect(ratioRows().length).toBe(4);
  });
  return result;
}

function seedLiveStore(room: string = ROOM): void {
  act(() => {
    const store = useGameStore.getState();
    store.setRoomCode(room);
    store.applyLobbyUpdate(LOBBY);
    store.applyGameFinished(FINISHED);
  });
}

function asHostTab(room: string = ROOM): void {
  setHostRoom(room);
  setHostSecret(room, HOST_SECRET);
}

function asGuestWhoPlayed(room: string = ROOM): string {
  auth.value = { ...auth.value, mode: 'guest' };
  const guestId = getOrCreateGuestId();
  setSessionToken(room, 'session-token-for-tests');
  return guestId;
}

function resultsCalls(): unknown[][] {
  return httpRec.get.mock.calls.filter((call) => /\/results(\?|$)/.test(String(call[0])));
}

beforeEach(() => {
  seen.length = 0;
  rec.emits.length = 0;
  auth.signIn.mockClear();
  auth.value = {
    firebaseUser: null,
    mode: null,
    loading: false,
    signInWithGoogle: auth.signIn,
    continueAsGuest: () => {},
    logout: async () => {},
  };
  act(() => {
    useGameStore.getState().reset();
  });
  httpRec.get.mockReset();
  httpRec.post.mockReset();
  httpRec.get.mockImplementation(async (url: string) => {
    if (/\/results(\?|$)/.test(url)) return { data: resultsResponse(), status: 200 };
    if (/\/export(\?|$)/.test(url)) return { data: 'week,role\n1,RETAILER\n', status: 200 };
    throw axiosError(404, `Unexpected GET ${url}`);
  });
  httpRec.post.mockImplementation(async (url: string) => {
    if (/\/games\/claim$/.test(url)) return { data: { claimed: CLAIMED }, status: 200 };
    throw axiosError(404, `Unexpected POST ${url}`);
  });
});

// ---------------------------------------------------------------------------
// Criterion 16 and §3.0 — the route
// ---------------------------------------------------------------------------

describe('CRITERION 16: /results/:roomCode is public and self-sufficient', () => {
  it('declares a public route descriptor for /results/:roomCode', () => {
    expect(descriptor().path).toBe('/results/:roomCode');
    expect(descriptor().guard).toBe('public');
  });

  it('renders for a visitor with no auth mode and an empty store', async () => {
    await renderReady();

    expect(currentPath()).toBe(`/results/${ROOM}`);
    expect(ratioRows().map((entry) => entry.role)).toEqual([...ROLE_ORDER]);
    expect(chartSeries()).toHaveLength(5);
  });

  it('fetches the results for the room code in the URL', async () => {
    await renderReady();

    expect(resultsCalls()).toHaveLength(1);
    expect(String(resultsCalls()[0][0])).toContain(ROOM);
  });
});

// ---------------------------------------------------------------------------
// Criterion 1 — the five regions, in the §2 order
// ---------------------------------------------------------------------------

describe('CRITERION 1: the debrief order is the specification', () => {
  it('renders the costs, then the chart, then the ratios, then the controls', async () => {
    await renderReady();

    const costs = smallestContaining(NAMES.RETAILER);
    const chart = chartTable();
    const ratios = ratioTable();
    const playAgain = control(/play again/i, 'Play again (§3.4)');

    expect(precedes(costs, chart)).toBe(true);
    expect(precedes(chart, ratios)).toBe(true);
    expect(precedes(ratios, playAgain)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Criterion 2 — the cost cards
// ---------------------------------------------------------------------------

describe('CRITERION 2: four role cards and the chain total', () => {
  it('renders every role’s display name and total cost', async () => {
    await renderReady();

    for (const role of ROLE_ORDER) {
      expect(bodyText()).toContain(NAMES[role]);
      expect(textHasValue(figuresText(), STATS[role].total_cost)).toBe(true);
    }
  });

  it('renders the chain total', async () => {
    await renderReady();

    expect(textHasValue(figuresText(), CHAIN_TOTAL)).toBe(true);
  });

  it('badges the bot, and only the bot', async () => {
    await renderReady();

    const botCard = smallestContaining(NAMES.FACTORY).parentElement ?? document.body;
    expect(textOf(botCard)).toMatch(/bot/i);

    for (const role of ['RETAILER', 'WHOLESALER', 'DISTRIBUTOR'] as Role[]) {
      const card = smallestContaining(NAMES[role]).parentElement ?? document.body;
      expect(textOf(card)).not.toMatch(/bot/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Criterion 3 — Reveal
// ---------------------------------------------------------------------------

describe('CRITERION 3: Reveal defaults to hidden exactly for the host tab', () => {
  function costsAreVisible(): boolean {
    return (
      textHasValue(figuresText(), STATS.RETAILER.total_cost) &&
      textHasValue(figuresText(), CHAIN_TOTAL)
    );
  }

  it('hides the costs when this tab is the host of that room', async () => {
    asHostTab();
    await renderReady();

    expect(costsAreVisible()).toBe(false);
  });

  it('shows them once the Reveal control is pressed', async () => {
    const user = userEvent.setup();
    asHostTab();
    await renderReady();

    await user.click(control(/reveal/i, 'Reveal (§2.1)'));

    expect(costsAreVisible()).toBe(true);
  });

  it('shows the costs immediately for anyone who is not the host of that room', async () => {
    await renderReady();

    expect(costsAreVisible()).toBe(true);
  });

  it('shows the costs to a host of some other room', async () => {
    asHostTab(OTHER);
    await renderReady();

    expect(costsAreVisible()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Criteria 8 and 21, failure modes 3 and 4 — the statistics table
// ---------------------------------------------------------------------------

describe('CRITERION 8: one row per role, in ROLE_ORDER, with all seven columns', () => {
  it('renders exactly four data rows, Retailer first and Factory last', async () => {
    await renderReady();

    expect(ratioRows().map((entry) => entry.role)).toEqual([...ROLE_ORDER]);
  });

  it('renders all seven statistics for every role', async () => {
    await renderReady();

    for (const role of ROLE_ORDER) {
      const cells = cellsOf(rowFor(role)).map(textOf);
      const stats = STATS[role];
      const expected: Array<[string, number]> = [
        ['bullwhip_ratio', stats.bullwhip_ratio as number],
        ['order_variance', stats.order_variance],
        ['peak_inventory', stats.peak_inventory],
        ['peak_backlog', stats.peak_backlog],
        ['weeks_in_backlog', stats.weeks_in_backlog],
        ['fill_rate', stats.fill_rate as number],
        ['average_order', stats.average_order],
      ];
      for (const [field, value] of expected) {
        expect(
          cells.some((cell) => matchesValue(cell, value)),
          `${role} row is missing ${field} (${value}); it rendered ${cells.join(' | ')}`,
        ).toBe(true);
      }
    }
  });

  it('heads the seven columns', async () => {
    await renderReady();

    const heading = textOf(ratioTable());
    for (const re of [
      /bullwhip|ratio/i,
      /variance/i,
      /inventory/i,
      /backlog/i,
      /fill/i,
      /average|avg|mean/i,
    ]) {
      expect(heading).toMatch(re);
    }
  });
});

describe('CRITERION 21 and FAILURE MODE 4: every figure comes from the server', () => {
  it('renders no number in a role’s row that the server did not send for that role', async () => {
    await renderReady();

    for (const role of ROLE_ORDER) {
      const stats = STATS[role];
      const allowed = [
        stats.bullwhip_ratio as number,
        stats.order_variance,
        stats.peak_inventory,
        stats.peak_backlog,
        stats.weeks_in_backlog,
        stats.fill_rate as number,
        stats.average_order,
        stats.total_cost,
      ];
      for (const cell of cellsOf(rowFor(role)).map(textOf)) {
        if (asNumber(cell) === null) continue;
        expect(
          allowed.some((value) => matchesValue(cell, value)),
          `${role}'s row renders "${cell}", which is not one of the server's figures for it`,
        ).toBe(true);
      }
    }
  });

  it('renders the payload’s ratio, not one recomputed from the orders', async () => {
    await renderReady();

    const row = rowFor('RETAILER');
    expect(rowHasValue(row, 1.75)).toBe(true);
    // Every ratio a client could arrive at from this row's own data, and the
    // variances behind them. FM 14's note: none of these shares a prefix with
    // a legitimate figure in the row (the nearest is the count 4), so a
    // correctly rendered integer cell can never be read as one of them.
    for (const recomputed of [
      2.014, // Var(orders) / the payload's demand_variance
      2.266, // Var(orders) / Var(demand_series), both population (D12)
      2.417, // the same two, both sample
      32.22, // Var(orders), population
      38.67, // Var(orders), sample
    ]) {
      expect(
        rowHasValue(row, recomputed),
        `the Retailer row renders ${recomputed}, which no server field carries`,
      ).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Failure mode 14 — a count is a count
// ---------------------------------------------------------------------------

describe('FAILURE MODE 14: counts render as plain integers', () => {
  const COUNTS = ['peak_inventory', 'peak_backlog', 'weeks_in_backlog'] as const;

  it('renders every count without a decimal point', async () => {
    await renderReady();

    for (const role of ROLE_ORDER) {
      const cells = cellValues(rowFor(role));
      for (const field of COUNTS) {
        const value = STATS[role][field];
        const cell = cells.find((c) => matchesValue(c, value));
        expect(
          cell,
          `${role}'s row renders no ${field} (${value}); it rendered ${cells.join(' | ')}`,
        ).toBeDefined();
        expect(
          cell,
          `${role}'s ${field} is a count (00-conventions.md §4), not a rate: ` +
            `"2.00 weeks in backlog" is wrong on a projected screen`,
        ).toMatch(/^\d+$/);
      }
    }
  });

  it('keeps the three rates as they are — the counts are the exception', async () => {
    await renderReady();

    // FM 14 is about `peak_inventory`, `peak_backlog` and `weeks_in_backlog`
    // only; a formatter that fixed them by rounding everything would take the
    // ratio and the fill rate with it.
    for (const role of ROLE_ORDER) {
      const row = rowFor(role);
      expect(rowHasValue(row, STATS[role].bullwhip_ratio as number)).toBe(true);
      expect(rowHasValue(row, STATS[role].fill_rate as number)).toBe(true);
      expect(rowHasValue(row, STATS[role].order_variance)).toBe(true);
    }
  });
});

describe('CRITERION 9 and FAILURE MODE 3: a null ratio is a dash, never a number', () => {
  const CONSTANT_DEMAND = [8, 8, 8, 8, 8, 8];

  beforeEach(() => {
    httpRec.get.mockImplementation(async (url: string) => {
      if (/\/results(\?|$)/.test(url)) {
        return {
          data: resultsResponse({
            demand_series: CONSTANT_DEMAND,
            demand_variance: 0,
            per_role: ROLE_ORDER.map((role) => roleResult(role, { bullwhip_ratio: null })),
          }),
          status: 200,
        };
      }
      throw axiosError(404, `Unexpected GET ${url}`);
    });
  });

  it('renders a dash in every ratio cell', async () => {
    await renderReady();

    for (const role of ROLE_ORDER) {
      const cells = cellsOf(rowFor(role)).map((cell) => (cell.textContent ?? '').trim());
      expect(
        cells.some((cell) => /^[—–-](?![\d.])/.test(cell)),
        `${role}'s row renders no "—" for its null ratio; it rendered ${cells.join(' | ')}`,
      ).toBe(true);
    }
  });

  it('renders no 0, no infinity and no NaN for it', async () => {
    await renderReady();

    const text = textOf(ratioTable());
    expect(text).not.toMatch(/NaN|Infinity|∞/);
    for (const role of ROLE_ORDER) {
      const cells = cellsOf(rowFor(role)).map(textOf);
      const zeroes = cells.filter((cell) => asNumber(cell) === 0);
      expect(zeroes, `${role}'s row renders a 0 where a ratio is null`).toEqual([]);
    }
  });

  it('explains the dash with §2.3’s tooltip', async () => {
    await renderReady();

    const wanted = "Customer demand never varied, so there's nothing to amplify.";
    const attributes = Array.from(document.querySelectorAll<HTMLElement>('*')).flatMap((el) =>
      ['title', 'aria-label', 'aria-description', 'data-tooltip', 'content'].map(
        (name) => el.getAttribute(name) ?? '',
      ),
    );
    const everywhere = [...attributes.map(norm), bodyText()];
    expect(
      everywhere.some((text) => text.includes(norm(wanted))),
      `§2.3's tooltip is nowhere on the screen. It rendered: ${bodyText()}`,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Criteria 14 and 15, failure modes 6 and 7 — the guest claim prompt
// ---------------------------------------------------------------------------

describe('CRITERION 14: the claim prompt is for a guest who played this game', () => {
  const OFFER = /sign in to keep this result/i;

  it('renders for a guest with a guest id and a session token for this room', async () => {
    asGuestWhoPlayed();
    await renderReady();

    expect(controlsMatching(OFFER).length + (OFFER.test(bodyText()) ? 1 : 0)).toBeGreaterThan(0);
    expect(bodyText()).toMatch(OFFER);
  });

  it('is absent for a signed-in user (failure mode 7)', async () => {
    asGuestWhoPlayed();
    auth.value = { ...auth.value, mode: 'authenticated' };
    await renderReady();

    expect(bodyText()).not.toMatch(OFFER);
    expect(controlsMatching(OFFER)).toEqual([]);
  });

  it('is absent when this browser holds no guest id', async () => {
    auth.value = { ...auth.value, mode: 'guest' };
    setSessionToken(ROOM, 'session-token-for-tests');
    await renderReady();

    expect(getGuestId()).toBeNull();
    expect(bodyText()).not.toMatch(OFFER);
  });

  it('is absent when this browser never joined that room', async () => {
    auth.value = { ...auth.value, mode: 'guest' };
    getOrCreateGuestId();
    await renderReady();

    expect(bodyText()).not.toMatch(OFFER);
  });
});

describe('CRITERION 15 and FAILURE MODE 6: claiming posts the guest id, and nothing else does', () => {
  it('signs in and posts the guest id to /games/claim', async () => {
    const user = userEvent.setup();
    const guestId = asGuestWhoPlayed();
    await renderReady();

    await user.click(control(/sign in|claim/i, 'the claim control (§2.5)'));
    await waitFor(() => {
      expect(httpRec.post).toHaveBeenCalled();
    });

    expect(auth.signIn).toHaveBeenCalled();
    const claim = httpRec.post.mock.calls.find((call) => /\/games\/claim$/.test(String(call[0])));
    expect(claim, 'no POST to /games/claim was issued (§2.5)').toBeTruthy();
    expect(claim?.[1]).toMatchObject({ guest_identity: guestId });
  });

  it('shows the claimed count and a link to /profile', async () => {
    const user = userEvent.setup();
    asGuestWhoPlayed();
    await renderReady();

    await user.click(control(/sign in|claim/i, 'the claim control (§2.5)'));
    await waitFor(() => {
      expect(textHasValue(figuresText(), CLAIMED)).toBe(true);
    });

    const link = Array.from(document.querySelectorAll('a[href]')).find(
      (a) => (a.getAttribute('href') ?? '').replace(/\/$/, '') === '/profile',
    );
    expect(link, `no link to /profile after claiming. The screen rendered: ${bodyText()}`).toBeTruthy();
  });

  it('puts the guest id in the claim body and nowhere else', async () => {
    const user = userEvent.setup();
    const guestId = asGuestWhoPlayed();
    const logs: string[] = [];
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logs.push(args.map((a) => String(a)).join(' '));
      });
    }
    await renderReady();

    await user.click(control(/sign in|claim/i, 'the claim control (§2.5)'));
    await waitFor(() => {
      expect(httpRec.post).toHaveBeenCalled();
    });

    for (const call of httpRec.get.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(guestId);
    }
    for (const call of httpRec.post.mock.calls) {
      expect(String(call[0])).not.toContain(guestId);
      expect(JSON.stringify(call[2] ?? {})).not.toContain(guestId);
    }
    for (const emit of rec.emits) {
      expect(JSON.stringify(emit)).not.toContain(guestId);
    }
    for (const line of logs) expect(line).not.toContain(guestId);

    vi.restoreAllMocks();
  });
});

// ---------------------------------------------------------------------------
// Criteria 17 and 18, failure mode 9 — the two entry paths
// ---------------------------------------------------------------------------

describe('CRITERION 17: a 404 is retried twice before the unavailable message', () => {
  it(
    'issues three requests and then says results are not available yet',
    async () => {
      httpRec.get.mockImplementation(async (url: string) => {
        throw axiosError(404, `No results for ${url}`);
      });

      renderResults();

      await waitFor(
        () => {
          expect(resultsCalls().length).toBe(3);
        },
        { timeout: 15000 },
      );
      await waitFor(
        () => {
          expect(bodyText()).toContain("Results aren't available yet.");
        },
        { timeout: 15000 },
      );
      expect(resultsCalls()).toHaveLength(3);
    },
    30000,
  );
});

describe('CRITERION 18 and FAILURE MODE 9: the store is used only for its own room', () => {
  it('issues no fetch when the store already holds this room’s finished payload', async () => {
    seedLiveStore(ROOM);
    await renderReady(ROOM);

    expect(resultsCalls()).toEqual([]);
  });

  it('fetches for the requested room when the store holds another room’s payload', async () => {
    seedLiveStore(OTHER);
    await renderReady(ROOM);

    expect(resultsCalls()).toHaveLength(1);
    expect(String(resultsCalls()[0][0])).toContain(ROOM);
    expect(String(resultsCalls()[0][0])).not.toContain(OTHER);
  });
});

// ---------------------------------------------------------------------------
// Criterion 19 — the debrief notes
// ---------------------------------------------------------------------------

describe('CRITERION 19: DebriefNotes is host-only and collapsed', () => {
  const CLOSING = /no one was incompetent/i;

  function expander(): HTMLElement {
    const summary = document.querySelector<HTMLElement>('summary');
    if (summary) return summary;
    const collapsed = document.querySelector<HTMLElement>('[aria-expanded="false"]');
    if (collapsed) return collapsed;
    return control(/debrief|talking point|notes|script/i, 'the DebriefNotes expander (§2.6)');
  }

  it('is absent for anyone who is not the host of that room', async () => {
    await renderReady();

    expect(bodyText()).not.toMatch(CLOSING);
    expect(controlsMatching(/debrief|talking point/i)).toEqual([]);
  });

  it('is collapsed by default for the host', async () => {
    asHostTab();
    await renderReady();

    const shown = Array.from(document.querySelectorAll<HTMLElement>('*')).filter(
      (el) => CLOSING.test(textOf(el)) && el.children.length === 0,
    );
    for (const el of shown) expect(el).not.toBeVisible();
  });

  it('carries the closing point about structure once expanded', async () => {
    const user = userEvent.setup();
    asHostTab();
    await renderReady();

    await user.click(expander());

    const text = bodyText();
    expect(text).toMatch(/no one was incompetent/i);
    expect(text).toMatch(/no one was acting in bad faith/i);
    expect(text).toMatch(/structure produced the outcome/i);
  });
});

// ---------------------------------------------------------------------------
// Criteria 20 and 23 — the print contract
// ---------------------------------------------------------------------------

describe('CRITERION 23: every region declares what print keeps', () => {
  it('keeps the chart and the ratio table', async () => {
    await renderReady();

    expect(printDisposition(chartTable())).toBe('keep');
    expect(printDisposition(ratioTable())).toBe('keep');
  });

  it('omits the reveal control, the claim prompt, the notes and Play again', async () => {
    const user = userEvent.setup();
    asHostTab();
    asGuestWhoPlayed();
    await renderReady();

    expect(printDisposition(control(/reveal/i, 'Reveal (§2.1)'))).toBe('omit');
    expect(printDisposition(control(/play again/i, 'Play again (§3.4)'))).toBe('omit');
    expect(
      printDisposition(control(/sign in|claim/i, 'the claim control (§2.5)')),
    ).toBe('omit');

    await user.click(control(/reveal/i, 'Reveal (§2.1)'));
    expect(printDisposition(smallestContaining(NAMES.RETAILER))).not.toBeNull();
  });

  it('uses only keep and omit', async () => {
    await renderReady();

    const values = Array.from(document.querySelectorAll('[data-print]')).map((el) =>
      el.getAttribute('data-print'),
    );
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) expect(['keep', 'omit']).toContain(value);
  });
});

// ---------------------------------------------------------------------------
// Criterion 22, failure modes 11 and 12 — the live path
// ---------------------------------------------------------------------------

describe('CRITERION 22 and FAILURE MODES 11 and 12: the live path renders what it has', () => {
  beforeEach(() => {
    // §3.1: the live path is available before persistence has completed.
    httpRec.get.mockImplementation(async (url: string) => {
      throw axiosError(404, `Not persisted yet: ${url}`);
    });
    auth.value = { ...auth.value, mode: 'authenticated' };
    seedLiveStore(ROOM);
  });

  it('renders the cost cards with display names and bot badges from participants', async () => {
    await renderReady();

    for (const role of ROLE_ORDER) {
      expect(bodyText()).toContain(NAMES[role]);
      expect(textHasValue(figuresText(), STATS[role].total_cost)).toBe(true);
    }
    expect(textHasValue(figuresText(), CHAIN_TOTAL)).toBe(true);
    expect(textOf(smallestContaining(NAMES.FACTORY).parentElement ?? document.body)).toMatch(/bot/i);
  });

  it('renders the chart and the ratios', async () => {
    await renderReady();

    expect(chartSeries()).toHaveLength(5);
    expect(ratioRows().map((entry) => entry.role)).toEqual([...ROLE_ORDER]);
    for (const role of ROLE_ORDER) {
      expect(rowHasValue(rowFor(role), STATS[role].bullwhip_ratio as number)).toBe(true);
    }
  });

  it('renders Play again, which the live path can always offer', async () => {
    await renderReady();

    expect(control(/play again/i, 'Play again (§3.4)')).toBeTruthy();
  });

  it('renders no figure the live payload does not carry', async () => {
    await renderReady();

    const allowed = new Set<string>();
    const add = (v: number) => {
      for (const candidate of [v, v * 100]) {
        allowed.add(String(candidate));
        allowed.add(candidate.toFixed(0));
        allowed.add(candidate.toFixed(1));
        allowed.add(candidate.toFixed(2));
      }
    };
    for (const week of WEEK_NUMBERS) add(week);
    for (const value of DEMAND) add(value);
    for (const role of ROLE_ORDER) {
      for (const value of ORDERS[role]) add(value);
      const stats = STATS[role];
      for (const value of [
        stats.total_cost,
        stats.peak_inventory,
        stats.peak_backlog,
        stats.weeks_in_backlog,
        stats.order_variance,
        stats.bullwhip_ratio as number,
        stats.fill_rate as number,
        stats.average_order,
      ]) {
        add(value);
      }
    }
    add(CHAIN_TOTAL);
    add(DEMAND_VARIANCE);
    add(WEEKS);

    // §2.0: `inventory`, `backlog`, `cumulative_cost`, the timestamps, the
    // preset name and `ended_early` are absent on this path. A zero, a dash or
    // a re-derivation would each be a figure the server never sent.
    const offenders = numericTokens(figuresText()).filter((token) => !allowed.has(token));
    expect(
      offenders,
      `the live path rendered figures the server never sent: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('renders no per-week inventory, backlog or cumulative-cost series', async () => {
    await renderReady();

    // The only per-week table is the chart's own (§2.2a); a second one would
    // be a series this path does not have.
    const perWeekTables = tables().filter(
      (t) => rowsOf(t).filter((row) => numericCells(row).length >= 2).length >= WEEKS,
    );
    expect(perWeekTables).toHaveLength(1);
    expect(perWeekTables[0]).toBe(chartTable());
  });
});

// ---------------------------------------------------------------------------
// Failure mode 10 and §3.4 — Play again
// ---------------------------------------------------------------------------

describe('FAILURE MODE 10: Play again promises no clone', () => {
  it('says the game has to be set up again', async () => {
    await renderReady();

    const region = control(/play again/i, 'Play again (§3.4)').closest('[data-print]');
    const text = norm((region ?? document.body).textContent ?? '');
    expect(text).toContain('set up the game again');
  });

  it('does not promise the configuration is carried over', async () => {
    await renderReady();

    const region = control(/play again/i, 'Play again (§3.4)').closest('[data-print]');
    const text = norm((region ?? document.body).textContent ?? '');
    expect(text).not.toMatch(/clone|same (settings|configuration|config|setup)/i);
    expect(text).not.toMatch(/(keep|carry|reuse)\w*\s+(your\s+)?(settings|configuration|config)/i);
  });

  it('returns to /home', async () => {
    const user = userEvent.setup();
    await renderReady();

    await user.click(control(/play again/i, 'Play again (§3.4)'));

    await waitFor(() => {
      expect(currentPath()).toBe('/home');
    });
  });
});
