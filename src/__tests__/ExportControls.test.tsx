/**
 * `21-frontend-results.md §2.4` — `ExportControls`, the full record's download.
 *
 * Since 2026-11-14 the export is open to anyone who can see the results
 * screen: host or player, signed in or guest, everybody downloads by the
 * game's permanent id (`GET /api/v1/games/id/{public_id}/export`) with no host
 * secret. Each format can be downloaded once per game per browser session
 * (a sessionStorage flag; a courtesy, the server's per-address limit is the
 * guard).
 *
 * Harness notes:
 *  - `src/api/http.ts` is replaced by a recorder, so the export request is
 *    asserted as a wire call.
 *  - `src/auth/AuthContext.tsx` is stubbed with the value `16 §3` freezes.
 *  - `chart.js` and `react-chartjs-2` are **not** mocked (failure mode 13).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { useGameStore } from '../store/gameStore';
import { ROLE_ORDER } from '../types/game';
import type { Role, RoleStats } from '../types/game';
import { setHostRoom, setHostSecret, wasExportDownloaded } from '../utils/storage';
import type { RouteDescriptor } from '../routes/registry';
import * as ResultsPageModule from '../pages/ResultsPage';
import * as ExportControlsModule from '../components/results/ExportControls';

// Rendering the whole screen in jsdom is slow, and slower still while the
// rest of the suite runs beside it.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

type Listener = (...args: unknown[]) => void;

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
    emit: () => socket,
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
    signInWithPopup: vi.fn(async () => ({ user: { uid: 'uid-1' } })),
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

const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => auth.value,
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ROOM = 'BEERYX';
const HOST_SECRET = 'host-secret-for-tests';
const PUBLIC_ID = 'f'.repeat(32);
const WEEKS = 6;

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

function resultsResponse() {
  return {
    public_id: PUBLIC_ID,
    room_code: ROOM,
    weeks_played: WEEKS,
    duration_weeks: WEEKS,
    ended_early: false,
    currency_symbol: '$',
    started_at: '2026-03-04T10:00:00Z',
    finished_at: '2026-03-04T10:42:00Z',
    demand_series: DEMAND,
    chain_total_cost: 3243,
    demand_variance: 16,
    per_role: ROLE_ORDER.map((role) => ({
      ...STATS[role],
      display_name: NAMES[role],
      is_bot: role === 'FACTORY',
      orders: ORDERS[role],
      inventory: [21, 17, 13, 9, 5, 3],
      backlog: [2, 3, 5, 6, 7, 4],
      cumulative_cost: [68.5, 137.25, 205.75, 274.5, 343.25, 412.5],
    })),
    preset_name: 'Classic MIT',
  };
}

const CSV_BODY = 'week,role,order\n1,RETAILER,5\n';

function axiosError(status: number, detail: string): unknown {
  return {
    isAxiosError: true,
    message: `Request failed with status code ${status}`,
    response: { status, data: { detail } },
  };
}

// ---------------------------------------------------------------------------
// DOM helpers
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

const CONTROL_SELECTOR = [
  'button',
  '[role="button"]',
  'a[href]',
  'input[type="button"]',
  'input[type="submit"]',
  '[role="menuitem"]',
].join(', ');

function accessibleName(el: HTMLElement): string {
  const parts: string[] = [];
  const aria = el.getAttribute('aria-label');
  if (aria) parts.push(aria);
  const title = el.getAttribute('title');
  if (title) parts.push(title);
  const download = el.getAttribute('download');
  if (download) parts.push(download);
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

function exportRegionText(): string {
  const holder = control(/csv/i, 'the CSV export control (§2.4)').closest('[data-print]');
  return norm((holder ?? document.body).textContent ?? '');
}

function exportCalls(): unknown[][] {
  return httpRec.get.mock.calls.filter((call) => /\/export(\?|$)/.test(String(call[0])));
}

function headerValue(config: unknown, name: string): string | null {
  const headers = (config as { headers?: Record<string, unknown> } | undefined)?.headers;
  if (!headers) return null;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) return String(value);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function descriptor(): RouteDescriptor {
  const exported = (ResultsPageModule as { route?: RouteDescriptor | RouteDescriptor[] }).route;
  if (!exported) throw new Error('ResultsPage.tsx exports no `route` descriptor (21 §3.0).');
  const all = Array.isArray(exported) ? exported : [exported];
  const found = all.find((d) => d.path.startsWith('/results'));
  if (!found) throw new Error('ResultsPage.tsx declares no `/results/:roomCode` route (21 §3.0).');
  return found;
}

async function renderResults(code: string = ROOM) {
  const route = descriptor();
  const result = render(
    <MemoryRouter initialEntries={[`/results/${code}`]}>
      <Routes>
        <Route path={route.path} element={route.element} />
        <Route path="*" element={<div data-testid="elsewhere" />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => {
    expect(bodyText()).toContain(NAMES.RETAILER);
  });
  return result;
}

function asHostTab(room: string = ROOM): void {
  setHostRoom(room);
  setHostSecret(room, HOST_SECRET);
}

beforeEach(() => {
  auth.value = {
    firebaseUser: null,
    mode: null,
    loading: false,
    signInWithGoogle: async () => {},
    continueAsGuest: () => {},
    logout: async () => {},
  };
  useGameStore.getState().reset();
  httpRec.get.mockReset();
  httpRec.post.mockReset();
  httpRec.get.mockImplementation(async (url: string) => {
    if (/\/results(\?|$)/.test(url)) return { data: resultsResponse(), status: 200 };
    if (/\/export(\?|$)/.test(url)) {
      return { data: CSV_BODY, status: 200, headers: { 'content-type': 'text/csv' } };
    }
    throw axiosError(404, `Unexpected GET ${url}`);
  });

  // jsdom has neither of these, and a download hands the browser a blob.
  const url = URL as unknown as Record<string, unknown>;
  if (typeof url.createObjectURL !== 'function') url.createObjectURL = () => 'blob:results';
  if (typeof url.revokeObjectURL !== 'function') url.revokeObjectURL = () => {};
});

// ---------------------------------------------------------------------------
// Open to every viewer of the results screen (2026-11-14)
// ---------------------------------------------------------------------------

describe('the export is open to anyone who can see the results', () => {
  it('is exported from src/components/results/ExportControls.tsx', () => {
    const exported = ExportControlsModule as Record<string, unknown>;
    const component =
      exported.default ??
      exported.ExportControls ??
      Object.values(exported).find((v) => typeof v === 'function');
    expect(typeof component === 'function' || typeof component === 'object').toBe(true);
  });

  it('renders both formats for a player with no host key and no account', async () => {
    await renderResults();

    expect(control(/csv/i, 'the CSV export control')).toBeEnabled();
    expect(control(/json/i, 'the JSON export control')).toBeEnabled();
  });

  it('renders both formats for the host too', async () => {
    asHostTab();
    await renderResults();

    expect(control(/csv/i, 'the CSV export control')).toBeEnabled();
    expect(control(/json/i, 'the JSON export control')).toBeEnabled();
  });

  it('says nothing about only the host being able to export', async () => {
    asHostTab();
    await renderResults();

    expect(exportRegionText()).not.toMatch(/only (the|a) (signed-in )?host/i);
    expect(exportRegionText()).toMatch(/once per browser session/i);
  });

  it('is absent when the results carry no permanent id', async () => {
    httpRec.get.mockImplementation(async (url: string) => {
      if (/\/results(\?|$)/.test(url)) {
        const { public_id: _omit, ...rest } = resultsResponse();
        void _omit;
        return { data: rest, status: 200 };
      }
      throw axiosError(404, `Unexpected GET ${url}`);
    });
    await renderResults();

    expect(controlsMatching(/csv|json/i)).toEqual([]);
  });

  it('issues no export request until a button is pressed, and never asks who hosted', async () => {
    auth.value = { ...auth.value, mode: 'authenticated' };
    await renderResults();

    expect(exportCalls()).toEqual([]);
    expect(httpRec.get.mock.calls.some((call) => /hosted-games/.test(String(call[0])))).toBe(false);
  });

  it('is print-omitted, like every other control (§3.3)', async () => {
    await renderResults();

    const holder = control(/csv/i, 'the CSV export control').closest('[data-print]');
    expect(holder?.getAttribute('data-print')).toBe('omit');
  });
});

// ---------------------------------------------------------------------------
// The request: by public_id, for everyone, host included
// ---------------------------------------------------------------------------

describe('every download goes by public_id, with no host secret', () => {
  it.each([
    ['a player', () => {}],
    ['the host', () => asHostTab()],
  ])('requests GET /games/id/{public_id}/export for %s', async (_who, arrange) => {
    arrange();
    const user = userEvent.setup();
    await renderResults();

    await user.click(control(/csv/i, 'the CSV export control'));

    await waitFor(() => expect(exportCalls()).toHaveLength(1));
    const [url, config] = exportCalls()[0];
    expect(url).toBe(`/games/id/${PUBLIC_ID}/export`);
    expect((config as { params?: unknown }).params).toEqual({ format: 'csv' });
    expect(headerValue(config, 'X-Host-Secret')).toBeNull();
    expect(JSON.stringify(exportCalls()[0])).not.toContain(HOST_SECRET);
  });

  it('asks for CSV and JSON distinctly', async () => {
    const user = userEvent.setup();
    await renderResults();

    await user.click(control(/csv/i, 'the CSV export control'));
    await waitFor(() => expect(exportCalls()).toHaveLength(1));
    await user.click(control(/json/i, 'the JSON export control'));
    await waitFor(() => expect(exportCalls()).toHaveLength(2));

    expect(exportCalls().map((call) => (call[1] as { params?: unknown }).params)).toEqual([
      { format: 'csv' },
      { format: 'json' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Once per game and format per browser session (UX only)
// ---------------------------------------------------------------------------

describe('each format downloads once per browser session', () => {
  it('disables a downloaded format and says so, leaving the other one', async () => {
    const user = userEvent.setup();
    await renderResults();

    await user.click(control(/csv/i, 'the CSV export control'));
    await waitFor(() =>
      expect(control(/csv/i, 'the CSV export control')).toHaveTextContent(
        'CSV already downloaded this session',
      ),
    );
    expect(control(/csv/i, 'the CSV export control')).toBeDisabled();
    expect(control(/json/i, 'the JSON export control')).toBeEnabled();
    expect(wasExportDownloaded(PUBLIC_ID, 'csv')).toBe(true);
    expect(wasExportDownloaded(PUBLIC_ID, 'json')).toBe(false);

    await user.click(control(/csv/i, 'the CSV export control'));
    expect(exportCalls()).toHaveLength(1);
  });

  it('keeps the flag in sessionStorage, so a reload of this tab still knows', async () => {
    const user = userEvent.setup();
    const first = await renderResults();
    await user.click(control(/json/i, 'the JSON export control'));
    await waitFor(() => expect(wasExportDownloaded(PUBLIC_ID, 'json')).toBe(true));
    first.unmount();

    expect(Object.keys(sessionStorage).some((key) => key.includes(PUBLIC_ID))).toBe(true);
    expect(Object.keys(localStorage).some((key) => key.includes(PUBLIC_ID))).toBe(false);

    await renderResults();
    expect(control(/json/i, 'the JSON export control')).toBeDisabled();
    expect(control(/json/i, 'the JSON export control')).toHaveTextContent(
      'JSON already downloaded this session',
    );
    expect(control(/csv/i, 'the CSV export control')).toBeEnabled();
  });

  it('counts per game: another game is still downloadable', async () => {
    sessionStorage.setItem(`export_downloaded_${'a'.repeat(32)}_csv`, '1');
    await renderResults();

    expect(control(/csv/i, 'the CSV export control')).toBeEnabled();
  });

  it('a refused download is not marked: the server limit says why, and the button stays', async () => {
    httpRec.get.mockImplementation(async (url: string) => {
      if (/\/results(\?|$)/.test(url)) return { data: resultsResponse(), status: 200 };
      throw axiosError(429, 'Too many requests. Please slow down and try again.');
    });
    const user = userEvent.setup();
    await renderResults();

    await user.click(control(/csv/i, 'the CSV export control'));

    await waitFor(() => expect(bodyText()).toContain('Too many requests.'));
    expect(bodyText()).not.toMatch(/AxiosError|Request failed/i);
    expect(wasExportDownloaded(PUBLIC_ID, 'csv')).toBe(false);
    expect(control(/csv/i, 'the CSV export control')).toBeEnabled();
  });
});
