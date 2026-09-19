/**
 * `22-frontend-profile.md` — `/profile` and `/profile/games/:gameId`.
 *
 * Covers acceptance criteria 1, 2, 3, 4, 5, 6, 7, 9b, 12, 13, 14, 15, 16, 17
 * and 18, and failure modes 2, 3, 4, 5, 6, 7, 8, 10, 11 and 12.
 * Criteria 8, 9, 10 and 11 and failure modes 1, 3 (the table's column), 9 and
 * 12 (the request shape) are in `MatchHistoryTable.test.tsx`.
 *
 * Harness notes:
 *  - `src/api/http.ts` is replaced by a recorder, so every request the screen
 *    makes is observed as a wire call. `src/api/users.ts` (§2.0) is exercised
 *    *through* the page rather than imported, so the assertions are about the
 *    two routes `15 §2` freezes and not about how the module is factored.
 *  - `src/auth/AuthContext.tsx` is replaced by a stub of the value `16 §3`
 *    freezes, because §3.1 gates the guest treatment on `useAuth().mode`,
 *    §3.4 makes sign-out `useAuth().logout()`, and there is no other declared
 *    way to put the context into either state. `signInWithGoogle` resolves
 *    without changing `mode`, so the claim flow §3.1 describes — sign in,
 *    *then* `POST /games/claim` — is what the test observes.
 *  - The page element is rendered from its own `route` descriptor (§3.0), not
 *    wrapped in section 16's guards: criterion 18 asserts the guard the
 *    descriptor declares, and the guards themselves are section 16's to test.
 *  - The components under `src/components/profile/` have no frozen props —
 *    §2.0 freezes only `src/api/users.ts` — so every one of them is driven
 *    through the page, exactly as `21 §2.0` says of `src/components/results/`.
 *  - `chart.js` and `react-chartjs-2` are **not** mocked: `21 §2.2a` is read
 *    through the chart's visually hidden per-week table.
 *  - Figures are matched tolerantly (`$1,234.50`, `1234.5`, `92%` for `0.92`)
 *    because `00-conventions.md §5` forbids asserting on formatting this
 *    section does not specify — but a *different* number never matches.
 *  - Copy is asserted only where §2.1, §2.4 or §3.1 fix it, and is looked for
 *    in text *and* in the attributes a tooltip is carried in.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Component, type ReactNode } from 'react';
import { render, act, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { ROLE_ORDER, type Role } from '../types/game';
import { getGuestId, getOrCreateGuestId, getSessionToken, setSessionToken } from '../utils/storage';
import type { RouteDescriptor } from '../routes/registry';
import * as ProfilePageModule from '../pages/ProfilePage';
import * as ResultsPageModule from '../pages/ResultsPage';

// Rendering whole screens in jsdom is slow, and slower still while the rest of
// the suite runs beside it.
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
    signInWithPopup: vi.fn(async () => ({ user: { uid: 'uid-1', displayName: 'Ada Lovelace' } })),
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
  logout: vi.fn(async () => {}),
  value: {} as Record<string, unknown>,
}));

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => auth.value,
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const UID = 'uid-1';
const DISPLAY_NAME = 'Ada Lovelace';
const PHOTO_URL = 'https://lh3.googleusercontent.com/a/profile-photo';

/** `15 §2`'s `UserStatsResponse`. Every figure is distinct from every other. */
const STATS = {
  games_played: 11,
  weeks_played: 214,
  total_cost: 18342.5,
  avg_cost_per_week: 85.71,
  bullwhip_avg: 2.35,
  best_game_id: 4007,
  games_as_retailer: 5,
  games_as_wholesaler: 3,
  games_as_distributor: 2,
  games_as_factory: 1,
};

const ROLE_COUNT_FIELD: Record<Role, keyof typeof STATS> = {
  RETAILER: 'games_as_retailer',
  WHOLESALER: 'games_as_wholesaler',
  DISTRIBUTOR: 'games_as_distributor',
  FACTORY: 'games_as_factory',
};

const ZERO_STATS = {
  games_played: 0,
  weeks_played: 0,
  total_cost: 0,
  avg_cost_per_week: 0,
  bullwhip_avg: null,
  best_game_id: null,
  games_as_retailer: 0,
  games_as_wholesaler: 0,
  games_as_distributor: 0,
  games_as_factory: 0,
};

/** `10 §2`'s alphabet excludes 0, O, 1, I and L. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function roomCodeFor(index: number): string {
  const a = CODE_ALPHABET;
  const n = a.length;
  // `index % n` is unique for the 25 fixtures, so every code is unique.
  return [
    'R',
    a[index % n],
    a[(index * 7 + 3) % n],
    a[(index * 13 + 5) % n],
    a[(index * 3 + 11) % n],
    a[(index * 17 + 2) % n],
  ].join('');
}

const PRESETS = ['Classic MIT', 'Volatile demand', 'Long lead times', 'Steady state'];

interface MatchFixture {
  game_id: number;
  room_code: string;
  finished_at: string;
  role: Role;
  weeks_played: number;
  total_cost: number;
  bullwhip_ratio: number | null;
  chain_total_cost: number;
  preset_name: string | null;
}

/** 25 games, newest first — the history `15 §3.5` orders by `finished_at` desc. */
const MATCHES: MatchFixture[] = Array.from({ length: 25 }, (_, i) => ({
  game_id: 4000 + i,
  room_code: roomCodeFor(i),
  // One month apart, so a row is identifiable by its year in any date format.
  finished_at: new Date(Date.UTC(2026, 8 - i, 15, 10, 30)).toISOString(),
  role: ROLE_ORDER[i % 4],
  weeks_played: 12 + (i % 9),
  total_cost: 1000 + i * 37.25,
  // Row index 3 is the null the "—" treatment is for (§2.3).
  bullwhip_ratio: i === 3 ? null : Number((1.05 + i * 0.37).toFixed(2)),
  chain_total_cost: 5000 + i * 111.5,
  preset_name: PRESETS[i % PRESETS.length],
}));

function historyPage(page: number, pageSize = 20) {
  const start = (page - 1) * pageSize;
  return {
    matches: MATCHES.slice(start, start + pageSize),
    total: MATCHES.length,
    page,
    page_size: pageSize,
  };
}

/** The game `best_game_id` points at, and the one `MatchDetail` opens. */
const DETAIL_GAME_ID = STATS.best_game_id;
const DETAIL_ROOM = 'BEERYX';
const DETAIL_WEEKS = 6;
const DETAIL_DEMAND = [4, 4, 12, 12, 12, 12];

const DETAIL_ORDERS: Record<Role, number[]> = {
  RETAILER: [5, 7, 21, 18, 14, 11],
  WHOLESALER: [6, 13, 30, 24, 16, 9],
  DISTRIBUTOR: [8, 19, 41, 33, 20, 7],
  FACTORY: [10, 26, 55, 44, 25, 6],
};

const DETAIL_ROLE_STATS: Record<Role, Record<string, number | null>> = {
  RETAILER: {
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

const DETAIL_NAMES: Record<Role, string> = {
  RETAILER: 'Ana',
  WHOLESALER: 'Ben',
  DISTRIBUTOR: 'Cleo',
  FACTORY: 'Autopilot',
};

const DETAIL_SERIES: Record<Role, { inventory: number[]; backlog: number[]; cumulative: number[] }> =
  {
    RETAILER: {
      inventory: [21, 17, 13, 9, 5, 3],
      backlog: [2, 3, 5, 6, 7, 4],
      cumulative: [68.5, 137.25, 205.75, 274.5, 343.25, 412.5],
    },
    WHOLESALER: {
      inventory: [31, 27, 22, 18, 13, 8],
      backlog: [3, 5, 8, 9, 11, 6],
      cumulative: [106.5, 212.75, 319.25, 425.5, 531.75, 638.25],
    },
    DISTRIBUTOR: {
      inventory: [43, 38, 32, 27, 21, 16],
      backlog: [4, 7, 10, 13, 15, 9],
      cumulative: [151.25, 302.5, 453.75, 605, 756.25, 907.75],
    },
    FACTORY: {
      inventory: [57, 51, 44, 38, 31, 24],
      backlog: [5, 9, 13, 17, 19, 12],
      cumulative: [214, 428.25, 642.5, 856.75, 1070.75, 1284.5],
    },
  };

/** `15 §2`'s `ResultsResponse` — what `GET /users/me/games/{id}` returns. */
function resultsResponse(over: Record<string, unknown> = {}) {
  return {
    room_code: DETAIL_ROOM,
    weeks_played: DETAIL_WEEKS,
    duration_weeks: DETAIL_WEEKS,
    ended_early: false,
    currency_symbol: '$',
    started_at: '2026-03-04T10:00:00Z',
    finished_at: '2026-03-04T10:42:00Z',
    demand_series: DETAIL_DEMAND,
    chain_total_cost: 3243,
    demand_variance: 16,
    per_role: ROLE_ORDER.map((role) => ({
      role,
      display_name: DETAIL_NAMES[role],
      is_bot: role === 'FACTORY',
      ...DETAIL_ROLE_STATS[role],
      orders: DETAIL_ORDERS[role],
      inventory: DETAIL_SERIES[role].inventory,
      backlog: DETAIL_SERIES[role].backlog,
      cumulative_cost: DETAIL_SERIES[role].cumulative,
    })),
    preset_name: 'Classic MIT',
    ...over,
  };
}

/** Deliberately unlike every other figure on the screen. */
const CLAIMED = 37;

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

/** Text *and* the attributes a tooltip or an explanation is carried in. */
function everythingRendered(): string[] {
  const attributes = Array.from(document.querySelectorAll<HTMLElement>('*')).flatMap((el) =>
    ['title', 'aria-label', 'aria-description', 'aria-describedby', 'data-tooltip', 'content'].map(
      (name) => norm(el.getAttribute(name) ?? ''),
    ),
  );
  const described = Array.from(document.querySelectorAll<HTMLElement>('[aria-describedby]')).flatMap(
    (el) =>
      (el.getAttribute('aria-describedby') ?? '')
        .split(/\s+/)
        .map((id) => norm(document.getElementById(id)?.textContent ?? '')),
  );
  return [...attributes, ...described, bodyText(), figuresText()];
}

function rendersCopy(copy: string): boolean {
  const wanted = norm(copy);
  return everythingRendered().some((text) => text.includes(wanted));
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
  const decimals = /\.(\d+)/.exec(text)?.[1].length ?? 0;
  const tolerance = 0.5 * 10 ** -decimals + 1e-9;
  return candidates.some((c) => Math.abs(c - n) < tolerance);
}

function textHasValue(text: string, v: number): boolean {
  return numericTokens(text).some((token) => matchesValue(token, v));
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
  '[role="menuitem"]',
  '[role="tab"]',
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
  const title = el.getAttribute('title');
  if (title) parts.push(title);
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

function links(): HTMLAnchorElement[] {
  return Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'));
}

function linkTo(href: string): HTMLAnchorElement | undefined {
  return links().find((a) => (a.getAttribute('href') ?? '').split('?')[0].replace(/\/$/, '') === href);
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

/**
 * The smallest region whose text matches — the deepest element that still
 * carries the whole label, so a figure can be read next to the label it
 * belongs to rather than anywhere on the page.
 */
function regionFor(re: RegExp, what: string): HTMLElement {
  const all = Array.from(document.body.querySelectorAll<HTMLElement>('*')).filter((el) =>
    re.test(textOf(el)),
  );
  const deepest = all.filter((el) => !all.some((other) => other !== el && el.contains(other)));
  if (deepest.length === 0) {
    throw new Error(`Nothing on the screen renders ${what} (${re}). It rendered: ${bodyText()}`);
  }
  // Walk out one or two levels so the label's own figure is inside the region.
  let region = deepest[0];
  for (let i = 0; i < 2 && region.parentElement && region.parentElement !== document.body; i += 1) {
    region = region.parentElement;
  }
  return region;
}

/** `21 §2.2a`: the chart's visually hidden table — one row per week, five series. */
function chartTable(weeks: number): HTMLElement | undefined {
  return tables().find(
    (t) => rowsOf(t).filter((row) => numericCells(row).length >= 5).length === weeks,
  );
}

function chartSeries(weeks: number): number[][] {
  const table = chartTable(weeks);
  if (!table) return [];
  const rows = rowsOf(table)
    .map(numericCells)
    .filter((cells) => cells.length >= 5);
  const width = Math.min(...rows.map((r) => r.length));
  const columns: number[][] = [];
  for (let i = 0; i < width; i += 1) columns.push(rows.map((r) => r[i]));
  const weekColumn = Array.from({ length: weeks }, (_, i) => i + 1).join(',');
  return columns.filter((col) => col.join(',') !== weekColumn);
}

/** `21 §2.3`'s per-role statistics table: names all four roles, carries their peaks. */
function roleStatsTable(): HTMLElement | undefined {
  return tables().find((t) => {
    const text = textOf(t);
    const cells = rowsOf(t).flatMap((row) => cellsOf(row).map(textOf));
    const namesAllRoles = ROLE_ORDER.every((role) => new RegExp(role, 'i').test(text));
    const carriesPeaks = ROLE_ORDER.every((role) =>
      cells.some((cell) => matchesValue(cell, DETAIL_ROLE_STATS[role].peak_inventory as number)),
    );
    return namesAllRoles && carriesPeaks;
  });
}

function columnHeadings(table: HTMLElement): string[] {
  return Array.from(table.querySelectorAll<HTMLElement>('th, [role="columnheader"]'))
    .map(textOf)
    .filter((text) => text.length > 0);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function descriptors(module: unknown, what: string): RouteDescriptor[] {
  const exported = (module as { route?: RouteDescriptor | RouteDescriptor[] }).route;
  if (!exported) {
    throw new Error(`${what} exports no \`route\` descriptor (22 §3.0, 16 §3 registry).`);
  }
  return Array.isArray(exported) ? exported : [exported];
}

function profileDescriptors(): RouteDescriptor[] {
  return descriptors(ProfilePageModule, 'ProfilePage.tsx');
}

function descriptorFor(prefix: string): RouteDescriptor {
  const found = profileDescriptors().find((d) => d.path.startsWith(prefix));
  if (!found) {
    throw new Error(
      `ProfilePage.tsx registers no route at ${prefix} (22 §3.0). It registers: ${profileDescriptors()
        .map((d) => d.path)
        .join(', ')}`,
    );
  }
  return found;
}

class TestBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render(): ReactNode {
    return this.state.failed ? <div data-testid="boundary">BOUNDARY</div> : this.props.children;
  }
}

const seen: Array<{ pathname: string; search: string }> = [];

function LocationProbe() {
  const location = useLocation();
  seen.push({ pathname: location.pathname, search: location.search });
  return null;
}

function currentPath(): string {
  return seen[seen.length - 1]?.pathname ?? '';
}

function renderAt(entry: string) {
  const profile = descriptorFor('/profile');
  const detail = profileDescriptors().find((d) => d.path.startsWith('/profile/games'));
  return render(
    <TestBoundary>
      <MemoryRouter initialEntries={[entry]}>
        <LocationProbe />
        <Routes>
          <Route path={profile.path} element={profile.element} />
          {detail ? <Route path={detail.path} element={detail.element} /> : null}
          <Route path="/results/:roomCode" element={<div data-testid="results" />} />
          <Route path="/home" element={<div data-testid="home" />} />
          <Route path="*" element={<div data-testid="elsewhere" />} />
        </Routes>
      </MemoryRouter>
    </TestBoundary>,
  );
}

async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** Renders `/profile` and waits for the statistics to have arrived. */
async function renderProfileReady() {
  const result = renderAt('/profile');
  await waitFor(() => {
    expect(textHasValue(figuresText(), STATS.games_played)).toBe(true);
  });
  return result;
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

function urlOf(call: unknown[]): string {
  return String(call[0] ?? '');
}

function paramsOf(call: unknown[]): Record<string, unknown> {
  const config = call[1] as { params?: Record<string, unknown> } | undefined;
  const fromConfig = config?.params ?? {};
  const query = urlOf(call).split('?')[1];
  const fromUrl: Record<string, unknown> = {};
  if (query) {
    for (const [key, value] of new URLSearchParams(query)) fromUrl[key] = value;
  }
  return { ...fromUrl, ...fromConfig };
}

function pathOf(call: unknown[]): string {
  return urlOf(call).split('?')[0];
}

/** §3.3: the requests this section owns are the ones under `/users/me/`. */
function mineCalls(): unknown[][] {
  return httpRec.get.mock.calls.filter((call) => pathOf(call).startsWith('/users/me/'));
}

function statsCalls(): unknown[][] {
  return mineCalls().filter((call) => /\/users\/me\/stats$/.test(pathOf(call)));
}

function gamesCalls(): unknown[][] {
  return mineCalls().filter((call) => /\/users\/me\/games$/.test(pathOf(call)));
}

function detailCalls(): unknown[][] {
  return mineCalls().filter((call) => /\/users\/me\/games\/\d+$/.test(pathOf(call)));
}

function claimCalls(): unknown[][] {
  return httpRec.post.mock.calls.filter((call) => /\/games\/claim$/.test(pathOf(call)));
}

function pageOf(call: unknown[]): number {
  const params = paramsOf(call);
  return Number(params.page ?? 1);
}

// ---------------------------------------------------------------------------
// Auth states
// ---------------------------------------------------------------------------

function asSignedIn(): void {
  auth.value = {
    firebaseUser: {
      uid: UID,
      displayName: DISPLAY_NAME,
      email: 'ada@example.com',
      photoURL: PHOTO_URL,
      getIdToken: async () => 'id-token',
    },
    mode: 'authenticated',
    loading: false,
    signInWithGoogle: auth.signIn,
    continueAsGuest: () => {},
    logout: auth.logout,
  };
}

function asGuest(): void {
  auth.value = {
    firebaseUser: null,
    mode: 'guest',
    loading: false,
    signInWithGoogle: auth.signIn,
    continueAsGuest: () => {},
    logout: auth.logout,
  };
}

/**
 * Clicks whatever the screen offers that could start a claim, and reports
 * whether a claim was issued. Copy for the offer is not fixed by §3.1 — only
 * the flow is (sign in with Google, then `POST /games/claim` with
 * `{guest_identity}` in the body) — so the prompt is identified by the flow it
 * runs rather than by words this document does not specify.
 */
async function sweepForClaim(user: ReturnType<typeof userEvent.setup>): Promise<boolean> {
  const tried = new Set<string>();
  for (let i = 0; i < 6; i += 1) {
    if (claimCalls().length > 0) return true;
    const candidate = Array.from(document.querySelectorAll<HTMLElement>(CONTROL_SELECTOR))
      .filter((el) => !/sign out|log out/i.test(accessibleName(el)))
      .filter((el) => /claim|keep|sign in|save|link|import|bring/i.test(accessibleName(el)))
      .find((el) => !tried.has(accessibleName(el)));
    if (!candidate) break;
    tried.add(accessibleName(candidate));
    await user.click(candidate);
    await flush();
  }
  return claimCalls().length > 0;
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  seen.length = 0;
  rec.emits.length = 0;
  auth.signIn.mockClear();
  auth.logout.mockClear();
  asSignedIn();

  httpRec.get.mockReset();
  httpRec.post.mockReset();

  httpRec.get.mockImplementation(async (url: string, config?: { params?: Record<string, unknown> }) => {
    const path = String(url).split('?')[0];
    const params = paramsOf([url, config]);
    if (/\/users\/me\/stats$/.test(path)) return { data: { ...STATS }, status: 200 };
    if (/\/users\/me\/games\/\d+$/.test(path)) return { data: resultsResponse(), status: 200 };
    if (/\/users\/me\/games$/.test(path)) {
      const size = Number(params.page_size ?? 20);
      return { data: historyPage(Number(params.page ?? 1), size), status: 200 };
    }
    if (/\/games\/[A-Z0-9]+\/results$/.test(path)) return { data: resultsResponse(), status: 200 };
    if (/health/.test(path)) return { data: { status: 'ok' }, status: 200 };
    throw axiosError(404, `Unexpected GET ${url}`);
  });

  httpRec.post.mockImplementation(async (url: string) => {
    const path = String(url).split('?')[0];
    if (/\/games\/claim$/.test(path)) return { data: { claimed: CLAIMED }, status: 200 };
    if (/\/users\/upsert$/.test(path)) return { data: { ok: true }, status: 200 };
    throw axiosError(404, `Unexpected POST ${url}`);
  });
});

// ---------------------------------------------------------------------------
// Criteria 1, 18 and §3.0 — the routes this module registers
// ---------------------------------------------------------------------------

describe('CRITERIA 1 and 18: the two routes and their guard', () => {
  it('registers /profile and /profile/games/:gameId from one page module', () => {
    const paths = profileDescriptors().map((d) => d.path);
    expect(paths).toContain('/profile');
    expect(paths).toContain('/profile/games/:gameId');
  });

  it('carries the auth+backend guard on both (criterion 18)', () => {
    for (const descriptor of profileDescriptors()) {
      expect(
        descriptor.guard,
        `${descriptor.path} must be behind the auth+backend guard (§3.0)`,
      ).toBe('auth+backend');
    }
  });

  it('shows a guest §3.1’s sign-in prompt instead of the profile body', async () => {
    asGuest();
    getOrCreateGuestId();
    renderAt('/profile');
    await flush();

    expect(rendersCopy('Sign in to keep your results.')).toBe(true);
    // The body belongs to a signed-in user; a guest gets the prompt, not the
    // figures, and the profile routes are never called for them.
    expect(textHasValue(figuresText(), STATS.games_played)).toBe(false);
    expect(mineCalls()).toEqual([]);
  });

  it('offers a Google sign-in control to a guest', async () => {
    asGuest();
    getOrCreateGuestId();
    renderAt('/profile');
    await flush();

    const button = control(/sign in|google/i, 'the Google sign-in button (§3.1)');
    const user = userEvent.setup();
    await user.click(button);
    await flush();

    expect(auth.signIn).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Criteria 2 and 17, failure modes 7 and 11 — ProfileClaimPrompt
// ---------------------------------------------------------------------------

describe('CRITERIA 2 and 17 and FAILURE MODE 11: the claim offer', () => {
  it('appears for a guest with a guest id and NO session token, and runs the claim', async () => {
    // Failure mode 11 in full: section 21's `GuestClaimPrompt` is eligible only
    // when this browser holds a `session_token` for the room on screen, and the
    // profile has no room — so reusing it here renders nothing at all. The
    // assertion is therefore that the offer IS there and DOES claim.
    asGuest();
    const guestId = getOrCreateGuestId();
    expect(window.localStorage.getItem('session_token_ABC234')).toBeNull();

    renderAt('/profile');
    await flush();

    const user = userEvent.setup();
    const claimed = await sweepForClaim(user);
    expect(
      claimed,
      'a guest with a guest id and no session token was offered no claim (§3.1, criterion 17, failure mode 11). ' +
        `The screen rendered: ${bodyText()}`,
    ).toBe(true);

    expect(auth.signIn, 'the claim signs in with Google first (§3.1)').toHaveBeenCalled();
    const claim = claimCalls()[0];
    expect(claim?.[1]).toMatchObject({ guest_identity: guestId });
  });

  it('reports the claimed count afterwards', async () => {
    asGuest();
    getOrCreateGuestId();
    renderAt('/profile');
    await flush();

    const user = userEvent.setup();
    expect(await sweepForClaim(user)).toBe(true);
    await waitFor(() => {
      expect(textHasValue(figuresText(), CLAIMED)).toBe(true);
    });
  });

  it('is never offered to an authenticated user (criterion 17)', async () => {
    asSignedIn();
    getOrCreateGuestId();
    await renderProfileReady();

    const user = userEvent.setup();
    const claimed = await sweepForClaim(user);
    expect(claimed, 'an authenticated user was offered a guest claim (criterion 17)').toBe(false);
    expect(rendersCopy('Sign in to keep your results.')).toBe(false);
  });

  it('is not offered to a guest with no guest id (criterion 2)', async () => {
    asGuest();
    expect(getGuestId()).toBeNull();
    renderAt('/profile');
    await flush();

    const user = userEvent.setup();
    expect(await sweepForClaim(user)).toBe(false);
  });

  it('puts the guest id in the claim body and nowhere else (failure mode 7)', async () => {
    asGuest();
    const guestId = getOrCreateGuestId();
    const logs: string[] = [];
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logs.push(args.map((a) => String(a)).join(' '));
      });
    }

    renderAt('/profile');
    await flush();
    const user = userEvent.setup();
    expect(await sweepForClaim(user)).toBe(true);

    for (const call of httpRec.get.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(guestId);
    }
    for (const call of httpRec.post.mock.calls) {
      expect(urlOf(call)).not.toContain(guestId);
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
// Criteria 3, 4, 6, 9b — StatsSummary
// ---------------------------------------------------------------------------

describe('CRITERION 3: StatsSummary renders all five figures', () => {
  it('renders games played, weeks played, average cost per week and the average ratio', async () => {
    await renderProfileReady();

    const figures = figuresText();
    for (const [what, value] of [
      ['games played', STATS.games_played],
      ['weeks played', STATS.weeks_played],
      ['average cost per week', STATS.avg_cost_per_week],
      ['average bullwhip ratio', STATS.bullwhip_avg],
    ] as Array<[string, number]>) {
      expect(
        textHasValue(figures, value),
        `${what} (${value}) is not on the screen. It rendered: ${figures}`,
      ).toBe(true);
    }
  });

  it('renders the best game as the fifth figure, linked by id', async () => {
    await renderProfileReady();

    const link = linkTo(`/profile/games/${STATS.best_game_id}`);
    expect(
      link,
      `§2.1 links the best game by id: /profile/games/${STATS.best_game_id}. ` +
        `The screen rendered these links: ${links()
          .map((a) => a.getAttribute('href'))
          .join(', ')}`,
    ).toBeTruthy();
  });
});

describe('CRITERION 4: every figure carries its explanatory line', () => {
  const EXPLANATIONS = [
    'Games you finished.',
    'Simulated weeks across all of them.',
    'Your total cost divided by the weeks you played. Lower is better.',
    'How much you amplified customer demand, averaged across games. Closer to 1 is better.',
    // §2.1's fifth line also describes where it links; only the sentence that
    // is copy is asserted.
    'Your lowest cost per week.',
  ];

  it('renders §2.1’s five explanations', async () => {
    await renderProfileReady();

    for (const line of EXPLANATIONS) {
      expect(rendersCopy(line), `§2.1's explanation "${line}" is nowhere on the screen`).toBe(true);
    }
  });
});

describe('CRITERION 6 and FAILURE MODE 3: a null average ratio is a dash', () => {
  beforeEach(() => {
    httpRec.get.mockImplementation(async (url: string, config?: { params?: Record<string, unknown> }) => {
      const path = String(url).split('?')[0];
      const params = paramsOf([url, config]);
      if (/\/users\/me\/stats$/.test(path)) {
        return { data: { ...STATS, bullwhip_avg: null }, status: 200 };
      }
      if (/\/users\/me\/games$/.test(path)) {
        return { data: historyPage(Number(params.page ?? 1)), status: 200 };
      }
      throw axiosError(404, `Unexpected GET ${url}`);
    });
  });

  it('renders "—" and never 0 or 0.00 for it', async () => {
    await renderProfileReady();

    const region = regionFor(/bullwhip/i, 'the average bullwhip ratio (§2.1)');
    const text = textOf(region);
    expect(text, `the average ratio region rendered: ${text}`).toMatch(/[-–—]/);
    expect(text).not.toMatch(/NaN|Infinity|∞|null|undefined/);
    const zeroes = numericTokens(text).filter((token) => asNumber(token) === 0);
    expect(zeroes, 'a null average ratio rendered as 0 (failure mode 3)').toEqual([]);
  });

  it('explains the dash with §2.1’s tooltip', async () => {
    await renderProfileReady();

    expect(
      rendersCopy(
        "None of your games had customer demand that varied, so there's nothing to amplify.",
      ),
      `§2.1's tooltip is nowhere on the screen. It rendered: ${bodyText()}`,
    ).toBe(true);
  });
});

describe('CRITERION 9b: a null best_game_id renders the empty treatment', () => {
  beforeEach(() => {
    httpRec.get.mockImplementation(async (url: string, config?: { params?: Record<string, unknown> }) => {
      const path = String(url).split('?')[0];
      const params = paramsOf([url, config]);
      if (/\/users\/me\/stats$/.test(path)) {
        return { data: { ...STATS, best_game_id: null }, status: 200 };
      }
      if (/\/users\/me\/games$/.test(path)) {
        return { data: historyPage(Number(params.page ?? 1)), status: 200 };
      }
      throw axiosError(404, `Unexpected GET ${url}`);
    });
  });

  it('links nowhere and renders no null, and does not crash', async () => {
    await renderProfileReady();

    const detailLinks = links().filter((a) =>
      (a.getAttribute('href') ?? '').startsWith('/profile/games'),
    );
    expect(
      detailLinks.map((a) => a.getAttribute('href')),
      'the best game linked somewhere although `best_game_id` is null (§2.1)',
    ).toEqual([]);
    expect(bodyText()).not.toMatch(/\bnull\b|\bundefined\b|\bNaN\b/);
    expect(document.querySelector('[data-testid="boundary"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Criterion 5 and failure mode 2 — the empty profile
// ---------------------------------------------------------------------------

describe('CRITERION 5 and FAILURE MODE 2: a user with no games', () => {
  beforeEach(() => {
    httpRec.get.mockImplementation(async (url: string) => {
      const path = String(url).split('?')[0];
      if (/\/users\/me\/stats$/.test(path)) return { data: { ...ZERO_STATS }, status: 200 };
      if (/\/users\/me\/games$/.test(path)) {
        return { data: { matches: [], total: 0, page: 1, page_size: 20 }, status: 200 };
      }
      throw axiosError(404, `Unexpected GET ${url}`);
    });
  });

  it('renders §2.1’s empty state and a link to /home', async () => {
    renderAt('/profile');

    await waitFor(() => {
      expect(rendersCopy("You haven't finished a game yet.")).toBe(true);
    });
    expect(linkTo('/home'), 'the empty state links to /home (§2.1)').toBeTruthy();
  });

  it('is not an error and not a spinner, and hits no error boundary', async () => {
    renderAt('/profile');

    await waitFor(() => {
      expect(rendersCopy("You haven't finished a game yet.")).toBe(true);
    });
    await flush();

    expect(document.querySelector('[data-testid="boundary"]')).toBeNull();
    expect(bodyText()).not.toMatch(/something went wrong|couldn't load|failed to load|try again/i);
    expect(document.querySelectorAll('[role="status"][aria-busy="true"]')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Criterion 7 — RoleBreakdown
// ---------------------------------------------------------------------------

describe('CRITERION 7: RoleBreakdown renders four counts', () => {
  it('renders each role with its own count', async () => {
    await renderProfileReady();

    for (const role of ROLE_ORDER) {
      const count = STATS[ROLE_COUNT_FIELD[role]] as number;
      const found = Array.from(document.body.querySelectorAll<HTMLElement>('*')).some((el) => {
        const text = textOf(el);
        if (text.length > 80) return false;
        const rolesNamed = ROLE_ORDER.filter((r) => new RegExp(r, 'i').test(text));
        if (rolesNamed.length !== 1 || rolesNamed[0] !== role) return false;
        return numericTokens(text).some((token) => matchesValue(token, count));
      });
      expect(
        found,
        `§2.2 renders one count per role; ${role} does not render ${count}. The screen rendered: ${figuresText()}`,
      ).toBe(true);
    }
  });

  it('renders four counts that sum to at most games_played', async () => {
    await renderProfileReady();

    const total = ROLE_ORDER.reduce((sum, role) => sum + (STATS[ROLE_COUNT_FIELD[role]] as number), 0);
    expect(total).toBeLessThanOrEqual(STATS.games_played);
  });
});

// ---------------------------------------------------------------------------
// Criterion 12 and failure modes 1, 4 and 12 — what the page asks for
// ---------------------------------------------------------------------------

describe('CRITERION 12 and FAILURE MODE 12: exactly two /users/me/ requests on mount', () => {
  it('issues stats and page 1 of games, and nothing else under /users/me/', async () => {
    // §3.3: section 16's providers are mounted around this page and their
    // traffic is not this section's. They are simulated here so the count is
    // demonstrably of `/users/me/*` and not of the axios instance.
    void httpRec.post('/users/upsert', { display_name: DISPLAY_NAME });
    void httpRec.get('/health');

    await renderProfileReady();
    await flush();

    expect(
      mineCalls().map(urlOf),
      'the page must issue exactly two /users/me/ requests on mount (§3.3)',
    ).toHaveLength(2);
    expect(statsCalls()).toHaveLength(1);
    expect(gamesCalls()).toHaveLength(1);
    expect(detailCalls(), 'no per-row detail fetch belongs on the profile (§3.3)').toHaveLength(0);
  });

  it('asks for page 1 at page_size 20 and never a second page', async () => {
    await renderProfileReady();
    await flush();

    const params = paramsOf(gamesCalls()[0]);
    expect(Number(params.page ?? 1)).toBe(1);
    expect(Number(params.page_size ?? 20), '§3.2 fixes the page size at 20').toBe(20);
    expect(gamesCalls().map(pageOf)).toEqual([1]);
  });

  it('counts section 16’s /users/upsert and health probe as none of its own', async () => {
    void httpRec.post('/users/upsert', { display_name: DISPLAY_NAME });
    void httpRec.get('/health');
    void httpRec.get('/health');

    await renderProfileReady();
    await flush();

    expect(httpRec.get.mock.calls.length).toBeGreaterThan(mineCalls().length);
    expect(mineCalls()).toHaveLength(2);
  });
});

describe('FAILURE MODE 4: no request carries a user id', () => {
  it('asks only for /users/me/* and never names the caller', async () => {
    await renderProfileReady();
    await flush();

    for (const call of httpRec.get.mock.calls) {
      const path = pathOf(call);
      expect(
        path.startsWith('/users/me/'),
        `the profile asked for ${path}; §2.0's routes are all /users/me/*`,
      ).toBe(true);
    }
    const everything = JSON.stringify([...httpRec.get.mock.calls, ...httpRec.post.mock.calls]);
    expect(everything).not.toContain(UID);
    expect(everything).not.toContain('ada@example.com');
  });
});

// ---------------------------------------------------------------------------
// Criteria 15, failure mode 6 — sign out
// ---------------------------------------------------------------------------

describe('CRITERION 15 and FAILURE MODE 6: sign out', () => {
  it('calls useAuth().logout() rather than re-implementing it', async () => {
    await renderProfileReady();

    const user = userEvent.setup();
    await user.click(control(/sign out|log out/i, 'the sign-out control (§2 layout)'));
    await flush();

    expect(auth.logout, '§3.4: sign out is useAuth().logout(), which section 16 owns').toHaveBeenCalled();
  });

  it('leaves a per-room session token in place', async () => {
    setSessionToken('ABC234', 'seat-token-ABC234');
    await renderProfileReady();

    const user = userEvent.setup();
    await user.click(control(/sign out|log out/i, 'the sign-out control (§2 layout)'));
    await flush();

    expect(
      getSessionToken('ABC234'),
      'signing out cleared a per-room session token, which loses the seat (§3.4)',
    ).toBe('seat-token-ABC234');
  });
});

// ---------------------------------------------------------------------------
// Criterion 16 and failure mode 10 — the avatar
// ---------------------------------------------------------------------------

describe('CRITERION 16 and FAILURE MODE 10: the avatar', () => {
  function avatarImage(): HTMLImageElement {
    const image = Array.from(document.querySelectorAll('img')).find((img) =>
      (img.getAttribute('src') ?? '').includes('googleusercontent.com'),
    );
    if (!image) {
      throw new Error(
        `§3.5 renders section 16's Avatar with the user's photo; no such image was rendered. The screen rendered: ${bodyText()}`,
      );
    }
    return image as HTMLImageElement;
  }

  it('requests the photo with referrerPolicy="no-referrer"', async () => {
    await renderProfileReady();

    const image = avatarImage();
    const policy =
      image.getAttribute('referrerpolicy') ?? image.getAttribute('referrerPolicy') ?? '';
    expect(policy.toLowerCase()).toBe('no-referrer');
  });

  it('falls back to the initial when the image fails (a 429 from lh3)', async () => {
    await renderProfileReady();

    const image = avatarImage();
    await act(async () => {
      fireEvent.error(image);
    });

    await waitFor(() => {
      const initials = Array.from(document.body.querySelectorAll<HTMLElement>('*'))
        .filter((el) => el.children.length === 0)
        .map(textOf);
      expect(
        initials.some((text) => /^A[A-Za-z]?$/.test(text)),
        `no initial fallback rendered after the avatar failed. The screen rendered: ${bodyText()}`,
      ).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Criteria 13 and 14, failure modes 5 and 8 — MatchDetail
// ---------------------------------------------------------------------------

describe('CRITERION 13 and FAILURE MODE 8: MatchDetail renders through section 21', () => {
  async function renderDetail(gameId: number = DETAIL_GAME_ID) {
    const result = renderAt(`/profile/games/${gameId}`);
    await waitFor(() => {
      expect(detailCalls().length).toBeGreaterThan(0);
    });
    return result;
  }

  it('fetches GET /users/me/games/{id} for the id in the path', async () => {
    await renderDetail();

    expect(pathOf(detailCalls()[0])).toBe(`/users/me/games/${DETAIL_GAME_ID}`);
  });

  it('renders section 21’s per-role statistics table with the payload’s figures', async () => {
    await renderDetail();

    await waitFor(() => {
      expect(roleStatsTable()).toBeTruthy();
    });
    const table = roleStatsTable() as HTMLElement;
    const cells = rowsOf(table).flatMap((row) => cellsOf(row).map(textOf));
    for (const role of ROLE_ORDER) {
      for (const field of [
        'peak_inventory',
        'peak_backlog',
        'weeks_in_backlog',
        'order_variance',
        'bullwhip_ratio',
        'fill_rate',
        'average_order',
      ]) {
        const value = DETAIL_ROLE_STATS[role][field] as number;
        expect(
          cells.some((cell) => matchesValue(cell, value)),
          `${role}'s ${field} (${value}) is not in the statistics table: ${cells.join(' | ')}`,
        ).toBe(true);
      }
    }
  });

  it('renders the payload’s costs through section 21’s cost components', async () => {
    // §2.4 imports `CostSummary` and `ChainCostBar` as well; the per-role
    // costs and the chain total are theirs, not the statistics table's.
    await renderDetail();

    await waitFor(() => {
      expect(roleStatsTable()).toBeTruthy();
    });
    const figures = figuresText();
    for (const role of ROLE_ORDER) {
      const cost = DETAIL_ROLE_STATS[role].total_cost as number;
      expect(textHasValue(figures, cost), `${role}'s total cost (${cost}) is not on the screen`).toBe(
        true,
      );
    }
    expect(textHasValue(figures, resultsResponse().chain_total_cost as number)).toBe(true);
  });

  it('renders section 21’s chart, read through its hidden per-week table (21 §2.2a)', async () => {
    await renderDetail();

    await waitFor(() => {
      expect(chartTable(DETAIL_WEEKS)).toBeTruthy();
    });
    const series = chartSeries(DETAIL_WEEKS).map((col) => col.join(','));
    expect(
      series,
      'the chart plots true demand as well as the four roles (21 §2.2a)',
    ).toContain(DETAIL_DEMAND.join(','));
    for (const role of ROLE_ORDER) {
      expect(series, `${role}'s orders are not plotted`).toContain(DETAIL_ORDERS[role].join(','));
    }
  });

  it('renders the same column headings the results screen does (failure mode 8)', async () => {
    // A second renderer, or a second mapper from the same payload, drifts the
    // moment either changes. Both screens are handed the identical
    // `ResultsResponse`, so section 21's table must come out the same.
    const resultsRoute = descriptors(ResultsPageModule, 'ResultsPage.tsx').find((d) =>
      d.path.startsWith('/results'),
    ) as RouteDescriptor;

    const results = render(
      <MemoryRouter initialEntries={[`/results/${DETAIL_ROOM}`]}>
        <Routes>
          <Route path={resultsRoute.path} element={resultsRoute.element} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(roleStatsTable()).toBeTruthy();
    });
    const expected = columnHeadings(roleStatsTable() as HTMLElement);
    results.unmount();

    await renderDetail();
    await waitFor(() => {
      expect(roleStatsTable()).toBeTruthy();
    });
    const actual = columnHeadings(roleStatsTable() as HTMLElement);

    for (const heading of expected) {
      expect(
        actual,
        `§2.4 renders through section 21's components; the results screen's "${heading}" column is missing`,
      ).toContain(heading);
    }
  });
});

describe('CRITERION 14 and FAILURE MODE 5: a game that is not the caller’s', () => {
  beforeEach(() => {
    httpRec.get.mockImplementation(async (url: string) => {
      const path = String(url).split('?')[0];
      if (/\/users\/me\/games\/\d+$/.test(path)) throw axiosError(404, 'Not found');
      if (/\/users\/me\/stats$/.test(path)) return { data: { ...STATS }, status: 200 };
      throw axiosError(404, `Unexpected GET ${url}`);
    });
  });

  it('renders §2.4’s not-found copy', async () => {
    renderAt(`/profile/games/${DETAIL_GAME_ID}`);

    await waitFor(() => {
      expect(rendersCopy("That game isn't in your history.")).toBe(true);
    });
  });

  it('never says the caller lacks permission', async () => {
    renderAt(`/profile/games/${DETAIL_GAME_ID}`);

    await waitFor(() => {
      expect(rendersCopy("That game isn't in your history.")).toBe(true);
    });
    // A 403-flavoured message would confirm the game exists (15 §3.6).
    expect(bodyText()).not.toMatch(
      /permission|forbidden|not allowed|access denied|aren't allowed|you don't have/i,
    );
    expect(currentPath()).toBe(`/profile/games/${DETAIL_GAME_ID}`);
  });
});
