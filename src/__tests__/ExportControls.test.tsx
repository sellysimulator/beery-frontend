/**
 * `21-frontend-results.md §2.4` — `ExportControls`, the host's download.
 *
 * Covers acceptance criteria 10, 11, 12 and 13, and failure mode 5.
 *
 * Harness notes:
 *  - `src/api/http.ts` is replaced by a recorder, so the export request is
 *    asserted as a wire call: `15 §2` gives the route
 *    `GET /api/v1/games/{room_code}/export` and its `X-Host-Secret` auth.
 *  - Host authority is put in place only through `16 §3`'s storage helpers
 *    (`setHostRoom`, `setHostSecret`), which is what `§2.4`'s
 *    `isHostForRoom(roomCode)` reads.
 *  - `src/auth/AuthContext.tsx` is stubbed with the value `16 §3` freezes;
 *    export authority is a room capability, never an account (**D3**), so no
 *    test here signs anybody in.
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
import { getHostSecret, setHostRoom, setHostSecret } from '../utils/storage';
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
const OTHER = 'MASHUP';
const HOST_SECRET = 'host-secret-for-tests';
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
// Criterion 10 and failure mode 5 — host only, and absent otherwise
// ---------------------------------------------------------------------------

describe('CRITERION 10 and FAILURE MODE 5: export is the host’s, and nobody else sees it', () => {
  it('is exported from src/components/results/ExportControls.tsx', () => {
    const exported = ExportControlsModule as Record<string, unknown>;
    const component =
      exported.default ??
      exported.ExportControls ??
      Object.values(exported).find((v) => typeof v === 'function');
    expect(typeof component === 'function' || typeof component === 'object').toBe(true);
  });

  it('renders both formats for the host of that room', async () => {
    asHostTab();
    await renderResults();

    expect(control(/csv/i, 'the CSV export control (§2.4)')).toBeTruthy();
    expect(control(/json/i, 'the JSON export control (§2.4)')).toBeTruthy();
  });

  it('is absent from the DOM for a player, not merely disabled', async () => {
    await renderResults();

    expect(controlsMatching(/csv/i)).toEqual([]);
    expect(controlsMatching(/json/i)).toEqual([]);
    expect(controlsMatching(/export|download/i)).toEqual([]);
    expect(bodyText()).not.toMatch(/\bexport\b/i);
  });

  it('is absent for the host of some other room', async () => {
    asHostTab(OTHER);
    await renderResults();

    expect(controlsMatching(/csv|json|export|download/i)).toEqual([]);
  });

  it('issues no export request when nobody asked for one', async () => {
    asHostTab();
    await renderResults();

    expect(exportCalls()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Criterion 11 — the request
// ---------------------------------------------------------------------------

describe('CRITERION 11: the export carries the stored host_secret, in both formats', () => {
  it('requests GET /games/{code}/export when CSV is pressed', async () => {
    const user = userEvent.setup();
    asHostTab();
    await renderResults();

    await user.click(control(/csv/i, 'the CSV export control (§2.4)'));

    await waitFor(() => {
      expect(exportCalls()).toHaveLength(1);
    });
    expect(String(exportCalls()[0][0])).toContain(`/games/${ROOM}/export`);
  });

  it('sends the tab’s host secret in the X-Host-Secret header', async () => {
    const user = userEvent.setup();
    asHostTab();
    await renderResults();

    await user.click(control(/csv/i, 'the CSV export control (§2.4)'));

    await waitFor(() => {
      expect(exportCalls()).toHaveLength(1);
    });
    expect(getHostSecret(ROOM)).toBe(HOST_SECRET);
    expect(headerValue(exportCalls()[0][1], 'X-Host-Secret')).toBe(HOST_SECRET);
  });

  it('keeps the secret out of the URL', async () => {
    const user = userEvent.setup();
    asHostTab();
    await renderResults();

    await user.click(control(/csv/i, 'the CSV export control (§2.4)'));

    await waitFor(() => {
      expect(exportCalls()).toHaveLength(1);
    });
    expect(String(exportCalls()[0][0])).not.toContain(HOST_SECRET);
    const params = (exportCalls()[0][1] as { params?: unknown } | undefined)?.params;
    expect(JSON.stringify(params ?? {})).not.toContain(HOST_SECRET);
  });

  it('asks for CSV and JSON distinctly, each with the secret', async () => {
    const user = userEvent.setup();
    asHostTab();
    await renderResults();

    await user.click(control(/csv/i, 'the CSV export control (§2.4)'));
    await waitFor(() => {
      expect(exportCalls()).toHaveLength(1);
    });
    await user.click(control(/json/i, 'the JSON export control (§2.4)'));
    await waitFor(() => {
      expect(exportCalls()).toHaveLength(2);
    });

    const [csvCall, jsonCall] = exportCalls().map((call) => JSON.stringify(call));
    expect(csvCall).toMatch(/csv/i);
    expect(jsonCall).toMatch(/json/i);
    expect(csvCall).not.toBe(jsonCall);
    for (const call of exportCalls()) {
      expect(headerValue(call[1], 'X-Host-Secret')).toBe(HOST_SECRET);
    }
  });
});

// ---------------------------------------------------------------------------
// Criterion 12 — a 403 in plain language
// ---------------------------------------------------------------------------

describe('CRITERION 12: a 403 is explained, not dumped', () => {
  beforeEach(() => {
    httpRec.get.mockImplementation(async (url: string) => {
      if (/\/results(\?|$)/.test(url)) return { data: resultsResponse(), status: 200 };
      throw axiosError(403, 'Forbidden: host_secret mismatch');
    });
  });

  it('renders §2.4’s message', async () => {
    const user = userEvent.setup();
    asHostTab();
    await renderResults();

    await user.click(control(/csv/i, 'the CSV export control (§2.4)'));

    await waitFor(() => {
      expect(bodyText()).toContain('Only the host who created this room can export it.');
    });
  });

  it('shows no raw error and no status code', async () => {
    const user = userEvent.setup();
    asHostTab();
    await renderResults();

    await user.click(control(/csv/i, 'the CSV export control (§2.4)'));

    await waitFor(() => {
      expect(bodyText()).toContain('Only the host who created this room can export it.');
    });
    expect(bodyText()).not.toMatch(/403|AxiosError|Request failed|host_secret/i);
  });
});

// ---------------------------------------------------------------------------
// Criterion 13 — download now
// ---------------------------------------------------------------------------

describe('CRITERION 13: the host is told the data expires', () => {
  it('states the 24-hour expiry beside the buttons', async () => {
    asHostTab();
    await renderResults();

    const text = exportRegionText();
    expect(text).toMatch(/download now/i);
    expect(text).toContain('expires in 24 hours');
  });

  it('says a guest host cannot export afterwards', async () => {
    asHostTab();
    await renderResults();

    expect(exportRegionText()).toMatch(/guest host can't export/i);
  });

  it('is print-omitted, like every other control (§3.3)', async () => {
    asHostTab();
    await renderResults();

    const holder = control(/csv/i, 'the CSV export control (§2.4)').closest('[data-print]');
    expect(holder?.getAttribute('data-print')).toBe('omit');
  });
});
