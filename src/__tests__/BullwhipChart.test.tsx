/**
 * `21-frontend-results.md §2.2` and `§2.2a` — `BullwhipChart`, the reveal.
 *
 * Covers acceptance criteria 4, 5, 6, 7 and 24, and failure modes 1, 2 and 8.
 *
 * Harness notes:
 *  - **`chart.js` and `react-chartjs-2` are never mocked** (failure mode 13).
 *    `§2.2a` freezes the two seams a jsdom test may use instead: the pure
 *    builder `buildBullwhipConfig`, and the chart's visually hidden per-week
 *    table. Everything below is asserted through one of those two.
 *  - `chartSetup.ts` is wrapped — not replaced — so the *real* builder runs and
 *    its argument and result are recorded. That is what makes criterion 24
 *    checkable: the configuration the test asserts on is the very object the
 *    component was handed, and the hidden table is compared against it.
 *  - `ResultsView` is not declared anywhere in a frozen public surface, so no
 *    test constructs one. Every view here is the one the screen itself built
 *    from `15 §2`'s `ResultsResponse`, captured through that wrapper.
 *  - `src/api/http.ts` is replaced by a recorder and `src/auth/AuthContext.tsx`
 *    by a stub of the value `16 §3` freezes; the screen is otherwise real.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { useGameStore } from '../store/gameStore';
import { ROLE_ORDER } from '../types/game';
import type { Role, RoleStats } from '../types/game';
import type { RouteDescriptor } from '../routes/registry';
import * as ResultsPageModule from '../pages/ResultsPage';
import * as BullwhipChartModule from '../components/results/BullwhipChart';

// Rendering the whole screen in jsdom is slow, and slower still while the
// rest of the suite runs beside it.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

// ---------------------------------------------------------------------------
// Harness — the chartSetup wrapper (§2.2a seam 1)
// ---------------------------------------------------------------------------

interface Dataset {
  label?: unknown;
  data?: unknown;
  borderColor?: unknown;
  backgroundColor?: unknown;
  borderDash?: unknown;
  borderWidth?: unknown;
  hidden?: unknown;
}

interface ChartLikeConfig {
  type?: unknown;
  data?: { labels?: unknown[]; datasets?: Dataset[] };
  options?: {
    scales?: Record<string, { axis?: unknown; beginAtZero?: unknown; position?: unknown } | undefined>;
  };
}

const chartRec = vi.hoisted(() => ({
  calls: [] as Array<{ view: unknown; config: unknown }>,
}));

vi.mock('../components/charts/chartSetup', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const build = actual.buildBullwhipConfig;
  if (typeof build !== 'function') {
    throw new Error(
      '21 §2.2a: `src/components/charts/chartSetup.ts` must export ' +
        '`buildBullwhipConfig(view: ResultsView): ChartConfiguration<"line">`.',
    );
  }
  return {
    ...actual,
    buildBullwhipConfig: (view: unknown) => {
      const config = (build as (v: unknown) => unknown)(view);
      chartRec.calls.push({ view, config });
      return config;
    },
  };
});

// ---------------------------------------------------------------------------
// Harness — transport
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
const WEEKS = 6;
const WEEK_NUMBERS = [1, 2, 3, 4, 5, 6];

/** Five pairwise distinct series, so no assertion can pass on a coincidence. */
const DEMAND = [4, 4, 12, 12, 12, 12];
const ORDERS: Record<Role, number[]> = {
  RETAILER: [5, 7, 21, 18, 14, 11],
  WHOLESALER: [6, 13, 30, 24, 16, 9],
  DISTRIBUTOR: [8, 19, 41, 33, 20, 7],
  FACTORY: [10, 26, 55, 44, 25, 6],
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

const NAMES: Record<Role, string> = {
  RETAILER: 'Ana',
  WHOLESALER: 'Ben',
  DISTRIBUTOR: 'Cleo',
  FACTORY: 'Autopilot',
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

// ---------------------------------------------------------------------------
// Reading the two seams
// ---------------------------------------------------------------------------

function norm(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function bodyText(): string {
  return norm(document.body.textContent ?? '');
}

function latestConfig(): ChartLikeConfig {
  const last = chartRec.calls[chartRec.calls.length - 1];
  if (!last) {
    throw new Error(
      '21 §2.2a and criterion 24: the chart must be handed `buildBullwhipConfig(view)`; ' +
        `it was never called. The screen rendered: ${bodyText()}`,
    );
  }
  return last.config as ChartLikeConfig;
}

function datasets(): Dataset[] {
  return latestConfig().data?.datasets ?? [];
}

function labelOf(dataset: Dataset): string {
  return String(dataset.label ?? '');
}

function dataOf(dataset: Dataset): number[] {
  const raw = Array.isArray(dataset.data) ? dataset.data : [];
  return raw.map((point) =>
    typeof point === 'number'
      ? point
      : Number((point as { y?: unknown } | null)?.y ?? Number.NaN),
  );
}

function demandDataset(): Dataset {
  const all = datasets();
  const found = all.filter((d) => /demand/i.test(labelOf(d)));
  if (found.length !== 1) {
    throw new Error(
      `§2.2 requires exactly one true-customer-demand series; the configuration has ` +
        `${found.length}. Its labels are: ${all.map(labelOf).join(' | ')}`,
    );
  }
  return found[0];
}

function orderDataset(role: Role): Dataset {
  const found = datasets().filter(
    (d) => new RegExp(role, 'i').test(labelOf(d)) && !/demand/i.test(labelOf(d)),
  );
  if (found.length !== 1) {
    throw new Error(
      `§2.2 requires exactly one ${role} order series; the configuration has ${found.length}. ` +
        `Its labels are: ${datasets().map(labelOf).join(' | ')}`,
    );
  }
  return found[0];
}

function orderDatasets(): Dataset[] {
  return ROLE_ORDER.map(orderDataset);
}

/** Only the Y scales: `§2.2a` freezes "one entry whose axis is `y`". */
function yScales(): Array<[string, { axis?: unknown; beginAtZero?: unknown }]> {
  const scales = latestConfig().options?.scales ?? {};
  return Object.entries(scales).filter(([key, value]) => {
    if (!value) return false;
    if (typeof value.axis === 'string') return value.axis === 'y';
    return /^y/i.test(key);
  }) as Array<[string, { axis?: unknown; beginAtZero?: unknown }]>;
}

function signatureOf(dataset: Dataset): string {
  const dash = dataset.borderDash;
  return Array.isArray(dash) ? JSON.stringify(dash) : 'solid';
}

function colourOf(dataset: Dataset): string {
  return JSON.stringify(dataset.borderColor ?? null);
}

// --- seam 2: the visually hidden per-week table ---------------------------

function tables(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('table, [role="table"]'));
}

function rowsOf(table: HTMLElement): HTMLElement[] {
  return Array.from(table.querySelectorAll<HTMLElement>('tr, [role="row"]'));
}

function numericCells(row: HTMLElement): number[] {
  return Array.from(
    row.querySelectorAll<HTMLElement>('td, th, [role="cell"], [role="rowheader"]'),
  )
    .map((cell) => {
      const cleaned = norm(cell.textContent ?? '').replace(/[\s,$€£¥%]/g, '');
      return /^-?\d+(?:\.\d+)?$/.test(cleaned) ? Number(cleaned) : null;
    })
    .filter((n): n is number => n !== null);
}

function chartTable(): HTMLElement {
  const found = tables().find(
    (t) => rowsOf(t).filter((row) => numericCells(row).length >= 5).length === WEEKS,
  );
  if (!found) {
    throw new Error(
      '§2.2a requires the chart to render a visually hidden table as well, one row per week ' +
        `with a column for true demand and one per role. The screen rendered: ${bodyText()}`,
    );
  }
  return found;
}

/** Every column of the hidden table, with the week column dropped. */
function tableSeries(): number[][] {
  const rows = rowsOf(chartTable())
    .map(numericCells)
    .filter((cells) => cells.length >= 5);
  const width = Math.min(...rows.map((r) => r.length));
  const columns: number[][] = [];
  for (let i = 0; i < width; i += 1) columns.push(rows.map((r) => r[i]));
  return columns.filter((col) => col.join(',') !== WEEK_NUMBERS.join(','));
}

function tableHasSeries(values: number[]): boolean {
  return tableSeries().some((col) => col.join(',') === values.join(','));
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

async function renderChart() {
  const route = descriptor();
  const result = render(
    <MemoryRouter initialEntries={[`/results/${ROOM}`]}>
      <Routes>
        <Route path={route.path} element={route.element} />
        <Route path="*" element={<div data-testid="elsewhere" />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => {
    expect(chartRec.calls.length).toBeGreaterThan(0);
  });
  await waitFor(() => {
    expect(tableSeries().length).toBeGreaterThan(0);
  });
  return result;
}

beforeEach(() => {
  chartRec.calls.length = 0;
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
    return { data: '', status: 200 };
  });
});

// ---------------------------------------------------------------------------
// The module exists and is the chart the screen uses
// ---------------------------------------------------------------------------

describe('BullwhipChart is a component of its own', () => {
  it('is exported from src/components/results/BullwhipChart.tsx', () => {
    const exported = BullwhipChartModule as Record<string, unknown>;
    const component =
      exported.default ?? exported.BullwhipChart ?? Object.values(exported).find((v) => typeof v === 'function');
    expect(typeof component === 'function' || typeof component === 'object').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Criterion 24 — the builder's result is what is rendered
// ---------------------------------------------------------------------------

describe('CRITERION 24: the chart is handed buildBullwhipConfig’s result, unaltered', () => {
  it('builds the configuration from the view, once the screen has one', async () => {
    await renderChart();

    expect(chartRec.calls.length).toBeGreaterThan(0);
    expect(latestConfig().data?.datasets ?? []).toHaveLength(5);
  });

  it('plots the same numbers in the hidden table as in the configuration', async () => {
    await renderChart();

    const fromConfig = datasets()
      .map((d) => dataOf(d).join(','))
      .sort();
    const fromTable = tableSeries()
      .map((col) => col.join(','))
      .sort();
    expect(fromTable).toEqual(fromConfig);
  });

  it('labels one point per week, weeks 1..weeks_played', async () => {
    await renderChart();

    const labels = (latestConfig().data?.labels ?? []).map((l) => Number(String(l).replace(/\D/g, '')));
    expect(labels).toEqual(WEEK_NUMBERS);
    for (const dataset of datasets()) expect(dataOf(dataset)).toHaveLength(WEEKS);
  });

  it('plots the server’s series and nothing derived from them', async () => {
    await renderChart();

    expect(dataOf(demandDataset())).toEqual(DEMAND);
    for (const role of ROLE_ORDER) {
      expect(dataOf(orderDataset(role))).toEqual(ORDERS[role]);
      expect(tableHasSeries(ORDERS[role])).toBe(true);
    }
    expect(tableHasSeries(DEMAND)).toBe(true);
  });

  it('leaves the hidden table in the accessibility tree', async () => {
    await renderChart();

    const table = chartTable();
    expect(table.getAttribute('aria-hidden')).not.toBe('true');
    expect(table.hasAttribute('hidden')).toBe(false);
    expect(table.closest('[aria-hidden="true"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Criterion 4 and failure modes 1 and 2 — one Y axis, starting at zero
// ---------------------------------------------------------------------------

describe('CRITERION 4 and FAILURE MODES 1 and 2: five series, one Y axis, from zero', () => {
  it('declares exactly five datasets', async () => {
    await renderChart();

    expect(datasets()).toHaveLength(5);
  });

  it('declares exactly one Y scale', async () => {
    await renderChart();

    const scales = yScales();
    expect(
      scales.map(([key]) => key),
      'a second Y axis rescales the order curves next to demand and destroys the comparison',
    ).toHaveLength(1);
  });

  it('starts that axis at zero', async () => {
    await renderChart();

    const [, y] = yScales()[0];
    expect(y.beginAtZero).toBe(true);
  });

  it('gives no dataset a Y axis of its own', async () => {
    await renderChart();

    for (const dataset of datasets()) {
      const axis = (dataset as unknown as { yAxisID?: unknown }).yAxisID;
      if (axis === undefined) continue;
      expect(axis).toBe(yScales()[0][0]);
    }
  });
});

// ---------------------------------------------------------------------------
// Criteria 5 and 6, failure mode 8 — the series are told apart
// ---------------------------------------------------------------------------

describe('CRITERION 5: true customer demand is drawn on top and stands apart', () => {
  it('puts the demand dataset last, so Chart.js draws it over the orders', async () => {
    await renderChart();

    const all = datasets();
    expect(labelOf(all[all.length - 1])).toMatch(/demand/i);
  });

  it('draws demand unbroken — no dash pattern', async () => {
    await renderChart();

    const dash = demandDataset().borderDash;
    expect(Array.isArray(dash) ? dash : []).toEqual([]);
  });

  it('gives demand a colour no order series uses', async () => {
    await renderChart();

    const demandColour = colourOf(demandDataset());
    for (const role of ROLE_ORDER) {
      expect(colourOf(orderDataset(role))).not.toBe(demandColour);
    }
  });
});

describe('CRITERION 6 and FAILURE MODE 8: colour and dash, not colour alone', () => {
  it('gives the four order series pairwise distinct colours', async () => {
    await renderChart();

    const colours = orderDatasets().map(colourOf);
    expect(new Set(colours).size).toBe(4);
  });

  it('gives the four order series pairwise distinct dash patterns', async () => {
    await renderChart();

    const dashes = orderDatasets().map((d) => d.borderDash);
    for (const dash of dashes) {
      expect(Array.isArray(dash) && dash.length > 0).toBe(true);
    }
    expect(new Set(dashes.map((d) => JSON.stringify(d))).size).toBe(4);
  });

  it('keeps all five series distinguishable with every colour stripped', async () => {
    await renderChart();

    // The chart survives a projector, a photocopy and colour-blindness only if
    // the dash pattern alone separates the five.
    const signatures = datasets().map(signatureOf);
    expect(new Set(signatures).size).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Criterion 7 — the legend brings the series in one at a time
// ---------------------------------------------------------------------------

/**
 * `§2.2a`'s third seam: the legend is **real DOM** — one `role="switch"` per
 * series, named after it — and a toggle filters the *view handed to*
 * `buildBullwhipConfig` without editing the configuration the builder already
 * returned. That is what makes the debrief's "Retailer first, then upstream"
 * reachable by a test and by a keyboard, neither of which can touch a legend
 * Chart.js draws inside the canvas.
 */
describe('CRITERION 7: the DOM legend toggles one series at a time', () => {
  function switches(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('[role="switch"]'));
  }

  function nameOf(el: HTMLElement): string {
    const labelledBy = (el.getAttribute('aria-labelledby') ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    return norm(
      [
        el.getAttribute('aria-label') ?? '',
        labelledBy,
        el.getAttribute('title') ?? '',
        el.closest('label')?.textContent ?? '',
        el.textContent ?? '',
      ].join(' '),
    );
  }

  function switchFor(series: RegExp, what: string): HTMLElement {
    const found = switches().filter((el) => series.test(nameOf(el)));
    if (found.length !== 1) {
      throw new Error(
        `§2.2a requires one role="switch" per series, named after it; ${found.length} name ` +
          `${what}. The legend offers: ${switches().map(nameOf).join(' | ') || '(no switches)'}`,
      );
    }
    return found[0];
  }

  function plottedLabels(): string[] {
    return datasets().map(labelOf);
  }

  function plots(series: RegExp): boolean {
    return plottedLabels().some((label) => series.test(label));
  }

  const RETAILER_ONLY = /retailer/i;

  it('renders one switch per series — demand and the four roles', async () => {
    await renderChart();

    expect(switches()).toHaveLength(5);
    switchFor(/demand/i, 'true customer demand');
    for (const role of ROLE_ORDER) switchFor(new RegExp(role, 'i'), role);
  });

  it('starts with every series switched on', async () => {
    await renderChart();

    for (const el of switches()) expect(el.getAttribute('aria-checked')).toBe('true');
    expect(datasets()).toHaveLength(5);
  });

  it('removes exactly that series from the configuration the chart is given', async () => {
    const user = userEvent.setup();
    await renderChart();

    await user.click(switchFor(RETAILER_ONLY, 'Retailer'));

    await waitFor(() => {
      expect(datasets()).toHaveLength(4);
    });
    expect(plots(RETAILER_ONLY)).toBe(false);
  });

  it('leaves the other four untouched, data and all', async () => {
    const user = userEvent.setup();
    await renderChart();

    await user.click(switchFor(RETAILER_ONLY, 'Retailer'));
    await waitFor(() => {
      expect(datasets()).toHaveLength(4);
    });

    expect(dataOf(demandDataset())).toEqual(DEMAND);
    for (const role of ['WHOLESALER', 'DISTRIBUTOR', 'FACTORY'] as Role[]) {
      expect(dataOf(orderDataset(role))).toEqual(ORDERS[role]);
    }
  });

  it('filters the view, and never edits the configuration already returned', async () => {
    const user = userEvent.setup();
    await renderChart();
    const before = latestConfig();

    await user.click(switchFor(RETAILER_ONLY, 'Retailer'));
    await waitFor(() => {
      expect(datasets()).toHaveLength(4);
    });

    // The builder ran again on a filtered view (§2.2a) rather than the
    // component reaching into what it was handed.
    expect(before.data?.datasets ?? []).toHaveLength(5);
    expect(latestConfig()).not.toBe(before);
  });

  it('brings the series back when the switch goes on again', async () => {
    const user = userEvent.setup();
    await renderChart();

    const toggle = switchFor(RETAILER_ONLY, 'Retailer');
    await user.click(toggle);
    await waitFor(() => {
      expect(plots(RETAILER_ONLY)).toBe(false);
    });
    await user.click(switchFor(RETAILER_ONLY, 'Retailer'));

    await waitFor(() => {
      expect(datasets()).toHaveLength(5);
    });
    expect(dataOf(orderDataset('RETAILER'))).toEqual(ORDERS.RETAILER);
  });

  it('reports its state, so a host can see which stages are in', async () => {
    const user = userEvent.setup();
    await renderChart();

    await user.click(switchFor(RETAILER_ONLY, 'Retailer'));

    await waitFor(() => {
      expect(switchFor(RETAILER_ONLY, 'Retailer').getAttribute('aria-checked')).toBe('false');
    });
    for (const role of ['WHOLESALER', 'DISTRIBUTOR', 'FACTORY'] as Role[]) {
      expect(switchFor(new RegExp(role, 'i'), role).getAttribute('aria-checked')).toBe('true');
    }
  });

  it('works from the keyboard', async () => {
    const user = userEvent.setup();
    await renderChart();

    const toggle = switchFor(/wholesaler/i, 'Wholesaler');
    toggle.focus();
    expect(document.activeElement).toBe(toggle);
    await user.keyboard(' ');

    await waitFor(() => {
      expect(plots(/wholesaler/i)).toBe(false);
    });
    expect(datasets()).toHaveLength(4);
    expect(plots(RETAILER_ONLY)).toBe(true);
  });
});
