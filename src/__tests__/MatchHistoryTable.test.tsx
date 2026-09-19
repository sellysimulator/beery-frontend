/**
 * `22-frontend-profile.md` §2.3 and §3.2 — the match history table.
 *
 * Covers acceptance criteria 8, 9, 10 and 11, the "—" treatment §2.3 reuses
 * for a null ratio (criterion 6, failure mode 3), and failure modes 1, 9 and
 * 12. The rest of section 22 is in `ProfilePage.test.tsx`.
 *
 * Harness notes:
 *  - `MatchHistoryTable` has no frozen props — §2.0 freezes only
 *    `src/api/users.ts` — so the table is driven through `/profile`, exactly
 *    as `21 §2.0` says of `src/components/results/`. What is asserted is what
 *    `GET /users/me/games` puts on the screen, not how the component is
 *    factored.
 *  - `src/api/http.ts` is a recorder, so the page's requests are observed as
 *    wire calls; `src/auth/AuthContext.tsx` is a stub of the value `16 §3`
 *    freezes, which is the only declared way to put the page in its
 *    authenticated state.
 *  - The history is 25 games, so page 1 is full at 20 and page 2 has 5 — the
 *    shape failure modes 1 and 12 are about.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Component, type ReactNode } from 'react';
import { render, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { ROLE_ORDER, type Role } from '../types/game';
import type { RouteDescriptor } from '../routes/registry';
import * as ProfilePageModule from '../pages/ProfilePage';

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

const STATS = {
  games_played: 25,
  weeks_played: 393,
  total_cost: 41250.75,
  avg_cost_per_week: 104.96,
  bullwhip_avg: 2.35,
  best_game_id: 4007,
  games_as_retailer: 7,
  games_as_wholesaler: 7,
  games_as_distributor: 6,
  games_as_factory: 5,
};

/** `10 §2`'s alphabet excludes 0, O, 1, I and L. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function roomCodeFor(index: number): string {
  const a = CODE_ALPHABET;
  const n = a.length;
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

/** 25 games, newest first — `15 §3.5` orders by `finished_at` descending. */
const MATCHES: MatchFixture[] = Array.from({ length: 25 }, (_, i) => ({
  game_id: 4000 + i,
  room_code: roomCodeFor(i),
  // One month apart, so every row carries an unambiguous year in any format.
  finished_at: new Date(Date.UTC(2026, 8 - i, 15, 10, 30)).toISOString(),
  role: ROLE_ORDER[i % 4],
  weeks_played: 12 + (i % 9),
  total_cost: 1000 + i * 37.25,
  // Row index 3 is the null the "—" treatment is for (§2.3).
  bullwhip_ratio: i === 3 ? null : Number((1.05 + i * 0.37).toFixed(2)),
  chain_total_cost: 5000 + i * 111.5,
  preset_name: PRESETS[i % PRESETS.length],
}));

const PAGE_SIZE = 20;
const PAGE_ONE = MATCHES.slice(0, PAGE_SIZE);
const PAGE_TWO = MATCHES.slice(PAGE_SIZE);
const NULL_RATIO_MATCH = MATCHES[3];

function historyPage(page: number, pageSize = PAGE_SIZE) {
  const start = (page - 1) * pageSize;
  return {
    matches: MATCHES.slice(start, start + pageSize),
    total: MATCHES.length,
    page,
    page_size: pageSize,
  };
}

function yearOf(match: MatchFixture): string {
  return String(new Date(match.finished_at).getUTCFullYear());
}

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

function textOf(el: Element): string {
  return norm(el.textContent ?? '');
}

function asNumber(text: string): number | null {
  const cleaned = text.replace(/[\s,$€£¥%]/g, '');
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

function matchesValue(text: string, v: number): boolean {
  const n = asNumber(text);
  if (n === null) return false;
  const rate = v > 0 && v < 1;
  const candidates = rate ? [v, v * 100] : [v];
  const decimals = /\.(\d+)/.exec(text)?.[1].length ?? 0;
  const tolerance = 0.5 * 10 ** -decimals + 1e-9;
  return candidates.some((c) => Math.abs(c - n) < tolerance);
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

function controls(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(CONTROL_SELECTOR));
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

function cellValues(row: HTMLElement): string[] {
  return cellsOf(row).map(textOf);
}

function rowHasValue(row: HTMLElement, v: number): boolean {
  return cellValues(row).some((cell) => matchesValue(cell, v));
}

/** The table holding the match history: the one that names the page's rooms. */
function historyTable(expected: MatchFixture[]): HTMLElement | undefined {
  return tables().find((table) => {
    const text = textOf(table);
    return expected.slice(0, 3).every((match) => text.includes(match.room_code));
  });
}

/** Every row that names one of the 25 fixture rooms, in document order. */
function matchRows(): Array<{ row: HTMLElement; match: MatchFixture }> {
  const found: Array<{ row: HTMLElement; match: MatchFixture }> = [];
  for (const table of tables()) {
    for (const row of rowsOf(table)) {
      const text = textOf(row);
      const match = MATCHES.find((m) => text.includes(m.room_code));
      if (match && !found.some((entry) => entry.match.room_code === match.room_code)) {
        found.push({ row, match });
      }
    }
  }
  return found;
}

function rowFor(match: MatchFixture): HTMLElement {
  const found = matchRows().find((entry) => entry.match.room_code === match.room_code);
  if (!found) {
    throw new Error(
      `§2.3 renders a row per match; none names ${match.room_code}. The screen rendered: ${bodyText()}`,
    );
  }
  return found.row;
}

function headerCellCount(table: HTMLElement): number {
  const headerRow = rowsOf(table).find(
    (row) => row.querySelectorAll('th, [role="columnheader"]').length > 0,
  );
  return headerRow ? headerRow.querySelectorAll('th, [role="columnheader"]').length : 0;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function profileDescriptors(): RouteDescriptor[] {
  const exported = (ProfilePageModule as { route?: RouteDescriptor | RouteDescriptor[] }).route;
  if (!exported) {
    throw new Error('ProfilePage.tsx exports no `route` descriptor (22 §3.0, 16 §3 registry).');
  }
  return Array.isArray(exported) ? exported : [exported];
}

function profileRoute(): RouteDescriptor {
  const found = profileDescriptors().find((d) => d.path === '/profile');
  if (!found) throw new Error('ProfilePage.tsx registers no /profile route (22 §3.0).');
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

function currentSearch(): string {
  return seen[seen.length - 1]?.search ?? '';
}

function currentPageParam(): number {
  return Number(new URLSearchParams(currentSearch()).get('page') ?? 1);
}

function renderAt(entry: string) {
  const profile = profileRoute();
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

/** Renders `/profile` (optionally with a query) and waits for the rows. */
async function renderHistory(entry = '/profile', expected: MatchFixture[] = PAGE_ONE) {
  const result = renderAt(entry);
  await waitFor(() => {
    expect(historyTable(expected)).toBeTruthy();
  });
  return result;
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

function urlOf(call: unknown[]): string {
  return String(call[0] ?? '');
}

function pathOf(call: unknown[]): string {
  return urlOf(call).split('?')[0];
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

/** §3.3: only the requests under `/users/me/` are this section's. */
function mineCalls(): unknown[][] {
  return httpRec.get.mock.calls.filter((call) => pathOf(call).startsWith('/users/me/'));
}

function gamesCalls(): unknown[][] {
  return mineCalls().filter((call) => /\/users\/me\/games$/.test(pathOf(call)));
}

function detailCalls(): unknown[][] {
  return mineCalls().filter((call) => /\/users\/me\/games\/\d+$/.test(pathOf(call)));
}

function pagesRequested(): number[] {
  return gamesCalls().map((call) => Number(paramsOf(call).page ?? 1));
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  seen.length = 0;
  rec.emits.length = 0;
  auth.value = {
    firebaseUser: {
      uid: 'uid-1',
      displayName: 'Ada Lovelace',
      email: 'ada@example.com',
      photoURL: 'https://lh3.googleusercontent.com/a/profile-photo',
      getIdToken: async () => 'id-token',
    },
    mode: 'authenticated',
    loading: false,
    signInWithGoogle: auth.signIn,
    continueAsGuest: () => {},
    logout: auth.logout,
  };

  httpRec.get.mockReset();
  httpRec.post.mockReset();

  httpRec.get.mockImplementation(async (url: string, config?: { params?: Record<string, unknown> }) => {
    const path = String(url).split('?')[0];
    const params = paramsOf([url, config]);
    if (/\/users\/me\/stats$/.test(path)) return { data: { ...STATS }, status: 200 };
    if (/\/users\/me\/games\/\d+$/.test(path)) throw axiosError(404, 'Not found');
    if (/\/users\/me\/games$/.test(path)) {
      const size = Number(params.page_size ?? PAGE_SIZE);
      return { data: historyPage(Number(params.page ?? 1), size), status: 200 };
    }
    if (/health/.test(path)) return { data: { status: 'ok' }, status: 200 };
    throw axiosError(404, `Unexpected GET ${url}`);
  });

  httpRec.post.mockImplementation(async (url: string) => {
    const path = String(url).split('?')[0];
    if (/\/users\/upsert$/.test(path)) return { data: { ok: true }, status: 200 };
    throw axiosError(404, `Unexpected POST ${url}`);
  });
});

// ---------------------------------------------------------------------------
// Criterion 8 — the rows and the columns
// ---------------------------------------------------------------------------

describe('CRITERION 8: rows newest first, with all eight columns', () => {
  it('renders page 1 in the order the server returned it, newest first', async () => {
    await renderHistory();

    const rendered = matchRows().map((entry) => entry.match.room_code);
    expect(rendered).toEqual(PAGE_ONE.map((match) => match.room_code));

    const times = matchRows().map((entry) => Date.parse(entry.match.finished_at));
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i - 1], 'the newest game is rendered first (§2.3)').toBeGreaterThan(times[i]);
    }
  });

  it('renders at least eight columns', async () => {
    await renderHistory();

    const table = historyTable(PAGE_ONE) as HTMLElement;
    expect(
      headerCellCount(table),
      '§2.3: Date, Room, Role, Weeks, Your cost, Bullwhip, Chain total, Preset',
    ).toBeGreaterThanOrEqual(8);
  });

  it('renders every column’s value in each row', async () => {
    await renderHistory();

    for (const match of PAGE_ONE) {
      const row = rowFor(match);
      const text = textOf(row);

      expect(text, `${match.room_code}: no room code`).toContain(match.room_code);
      expect(text, `${match.room_code}: no date`).toContain(yearOf(match));
      expect(text, `${match.room_code}: no role`).toMatch(new RegExp(match.role, 'i'));
      expect(text, `${match.room_code}: no preset`).toContain(match.preset_name as string);
      expect(rowHasValue(row, match.weeks_played), `${match.room_code}: no weeks played`).toBe(true);
      expect(rowHasValue(row, match.total_cost), `${match.room_code}: no cost`).toBe(true);
      expect(rowHasValue(row, match.chain_total_cost), `${match.room_code}: no chain total`).toBe(
        true,
      );
      if (match.bullwhip_ratio !== null) {
        expect(rowHasValue(row, match.bullwhip_ratio), `${match.room_code}: no ratio`).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Criterion 6 and failure mode 3 — the bullwhip column's "—"
// ---------------------------------------------------------------------------

describe('CRITERION 6 and FAILURE MODE 3: a null ratio in the table is "—"', () => {
  it('renders a dash, and never 0 or 0.00', async () => {
    await renderHistory();

    const row = rowFor(NULL_RATIO_MATCH);
    const cells = cellValues(row);
    // A dash, optionally followed by the cell's own explanation — but never
    // followed by a digit, which would make it a negative number.
    expect(
      cells.some((cell) => /^[-–—](?![\d.])/.test(cell.trim())),
      `§2.3 reuses the "—" treatment for a null ratio; the row rendered ${cells.join(' | ')}`,
    ).toBe(true);
    expect(textOf(row)).not.toMatch(/NaN|Infinity|∞|null|undefined/);

    // Every 0 in that row would have to be a server value; none of this
    // fixture's columns is 0, so a 0 can only be the null rendered as one.
    const zeroes = cells.filter((cell) => asNumber(cell) === 0);
    expect(zeroes, 'a null ratio rendered as 0 (failure mode 3)').toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Criterion 9 — opening a row
// ---------------------------------------------------------------------------

describe('CRITERION 9: a row opens /results/:roomCode', () => {
  it('navigates to the public results screen for that room', async () => {
    await renderHistory();

    const match = PAGE_ONE[2];
    const row = rowFor(match);
    const href = `/results/${match.room_code}`;
    const anchor = Array.from(row.querySelectorAll<HTMLAnchorElement>('a[href]')).find(
      (a) => (a.getAttribute('href') ?? '').split('?')[0] === href,
    );

    const user = userEvent.setup();
    await user.click(anchor ?? row);
    await flush();

    expect(
      currentPath(),
      `§2.3: a row opens ${href}. The row rendered: ${textOf(row)}`,
    ).toBe(href);
  });

  it('opens the room it names, not another one', async () => {
    await renderHistory();

    const match = PAGE_ONE[7];
    const row = rowFor(match);
    const anchor = Array.from(row.querySelectorAll<HTMLAnchorElement>('a[href]')).find((a) =>
      (a.getAttribute('href') ?? '').startsWith('/results/'),
    );

    const user = userEvent.setup();
    await user.click(anchor ?? row);
    await flush();

    expect(currentPath()).toBe(`/results/${match.room_code}`);
  });
});

// ---------------------------------------------------------------------------
// Criteria 10 and 11 — pagination
// ---------------------------------------------------------------------------

describe('CRITERION 10: paging replaces the table and writes the page into the URL', () => {
  function nextPageControl(): HTMLElement {
    const named = (re: RegExp) => controls().filter((el) => re.test(accessibleName(el)));
    const found =
      named(/^next\b/i)[0] ??
      named(/\bnext\b/i)[0] ??
      controls().find((el) => norm(accessibleName(el)) === '2') ??
      named(/page 2/i)[0] ??
      named(/[›»→⟩>]/)[0];
    if (!found) {
      throw new Error(
        `§3.2 pages the history at 20; no control moves to page 2. The screen rendered: ${bodyText()}`,
      );
    }
    return found;
  }

  it('replaces page 1’s rows with page 2’s', async () => {
    await renderHistory();
    expect(matchRows()).toHaveLength(PAGE_ONE.length);

    const user = userEvent.setup();
    await user.click(nextPageControl());
    await waitFor(() => {
      expect(historyTable(PAGE_TWO)).toBeTruthy();
    });
    await flush();

    const rendered = matchRows().map((entry) => entry.match.room_code);
    expect(rendered, '§3.2: loading a page replaces the table rather than appending').toEqual(
      PAGE_TWO.map((match) => match.room_code),
    );
    expect(pagesRequested()).toContain(2);
  });

  it('writes the page number into the URL query', async () => {
    await renderHistory();

    const user = userEvent.setup();
    await user.click(nextPageControl());
    await waitFor(() => {
      expect(historyTable(PAGE_TWO)).toBeTruthy();
    });
    await flush();

    expect(currentPath()).toBe('/profile');
    expect(
      currentPageParam(),
      `§3.2 puts the page number in the URL query; the location was "${currentSearch()}"`,
    ).toBe(2);
  });
});

describe('CRITERION 11: a reload on ?page=2 returns to page 2', () => {
  it('requests page 2 and renders its rows', async () => {
    await renderHistory('/profile?page=2', PAGE_TWO);
    await flush();

    expect(pagesRequested(), 'the mount fetch must honour ?page=2').toEqual([2]);
    const rendered = matchRows().map((entry) => entry.match.room_code);
    expect(rendered).toEqual(PAGE_TWO.map((match) => match.room_code));
  });
});

// ---------------------------------------------------------------------------
// Failure mode 9 — a page beyond the end
// ---------------------------------------------------------------------------

describe('FAILURE MODE 9: a page beyond the end', () => {
  it('renders an empty table and a "no more results" state, and does not crash', async () => {
    renderAt('/profile?page=99');

    await waitFor(() => {
      expect(gamesCalls().length).toBeGreaterThan(0);
    });
    await flush();

    expect(document.querySelector('[data-testid="boundary"]')).toBeNull();
    expect(matchRows(), 'page 99 of a one-and-a-bit-page history has no rows').toEqual([]);
    expect(bodyText()).not.toMatch(/NaN|undefined|something went wrong/i);
    expect(
      /no (more )?(results|games|matches)|nothing (more )?(to show|here)|that page is empty|no rows|empty/i.test(
        bodyText(),
      ),
      `failure mode 9 wants a "no more results" state, not a bare empty table. The screen rendered: ${bodyText()}`,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Failure modes 1 and 12 — what a 25-game history costs
// ---------------------------------------------------------------------------

describe('FAILURE MODES 1 and 12: two requests for a 25-game history', () => {
  it('issues exactly two /users/me/ requests on mount and no per-row detail', async () => {
    // Section 16's providers are mounted around this page; their traffic is
    // not this section's (§3.3), so it is simulated here to prove the count
    // is of `/users/me/*` rather than of the axios instance.
    void httpRec.post('/users/upsert', { display_name: 'Ada Lovelace' });
    void httpRec.get('/health');

    await renderHistory();
    await flush();

    expect(
      mineCalls().map(urlOf),
      'a client that fetches each game to fill a column undoes 15 §3.5’s single-query guarantee',
    ).toHaveLength(2);
    expect(detailCalls()).toHaveLength(0);
    expect(httpRec.get.mock.calls.length).toBeGreaterThan(mineCalls().length);
  });

  it('asks for one page of 20, and never a second page on mount', async () => {
    await renderHistory();
    await flush();

    expect(gamesCalls()).toHaveLength(1);
    const params = paramsOf(gamesCalls()[0]);
    expect(Number(params.page ?? 1)).toBe(1);
    expect(
      Number(params.page_size ?? PAGE_SIZE),
      '§3.2 fixes the page size at 20; the client never asks for more',
    ).toBe(20);
    expect(Number(params.page_size ?? PAGE_SIZE)).toBeLessThanOrEqual(20);
  });
});
