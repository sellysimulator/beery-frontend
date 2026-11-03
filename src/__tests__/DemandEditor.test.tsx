/**
 * `18-frontend-host-config.md §2.6` — the customer-demand editor and its live
 * preview, rendered through the panel's frozen entry point.
 *
 * Covers acceptance criteria 7, 8, 9, 10 and 11, and failure modes 2, 9 and 10.
 *
 * The preview is read the way `§2.6` prescribes: the element carrying
 * `data-testid="demand-preview"` also carries `data-series`, the comma-separated
 * integers it drew, because a canvas is not assertable under jsdom.
 *
 * Since 2026-11-03 those integers are the server's (`POST /rooms/preview`,
 * `10 §3.5b`): the panel keeps no generator, so these tests serve the answer
 * and check that the panel sends the draft and draws exactly what comes back.
 * `§2.6`'s normative table is asserted against the real generator in the
 * backend's `tests/test_core/test_preview.py`.
 *
 * There is no separately importable `DemandEditor`: `18 §2` freezes
 * `src/components/config/ConfigPanel.tsx` as this section's only entry point and
 * says the preview's generator "lives under `src/components/config/`; nothing
 * else imports it". So this file drives the editor through the panel.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { ConfigPanel } from '../components/config/ConfigPanel';
import { resetPreviewCacheForTests } from '../components/config/useConfigPreview';
import { useGameStore } from '../store/gameStore';
import { setHostRoom, setHostSecret } from '../utils/storage';
import type {
  DemandConfig,
  FactoryConfig,
  GameConfig,
  Role,
  RoleConfig,
  RoomState,
  VisibilityConfig,
} from '../types/game';

// ---------------------------------------------------------------------------
// Wire recorders — as in ConfigPanel.test.tsx
// ---------------------------------------------------------------------------

type Listener = (...args: unknown[]) => void;
type Json = Record<string, unknown>;

const rec = vi.hoisted(() => ({
  emits: [] as Array<{ event: string; payload: unknown }>,
  listeners: new Map<string, Listener[]>(),
  socket: null as Json | null,
}));

vi.mock('socket.io-client', () => {
  const add = (event: string, cb: Listener) => {
    rec.listeners.set(event, [...(rec.listeners.get(event) ?? []), cb]);
  };
  const socket: Json = {
    id: 'test-sid',
    connected: true,
    on: (event: string, cb: Listener) => {
      add(event, cb);
      return socket;
    },
    once: (event: string, cb: Listener) => {
      add(event, cb);
      return socket;
    },
    off: (event: string, cb?: Listener) => {
      if (!cb) rec.listeners.delete(event);
      else rec.listeners.set(event, (rec.listeners.get(event) ?? []).filter((l) => l !== cb));
      return socket;
    },
    removeAllListeners: (event?: string) => {
      if (event) rec.listeners.delete(event);
      else rec.listeners.clear();
      return socket;
    },
    emit: (event: string, payload: unknown) => {
      rec.emits.push({ event, payload });
      return socket;
    },
    connect: () => {
      socket.connected = true;
      return socket;
    },
    disconnect: () => {
      socket.connected = false;
      return socket;
    },
    io: { engine: { transport: { name: 'websocket' } } },
  };
  rec.socket = socket;
  const io = () => socket;
  return { io, default: io, Socket: class {}, Manager: class {} };
});

const rest = vi.hoisted(() => ({
  configResponse: null as unknown,
  /** `POST /rooms/preview`: a fixed answer, or one built from the request body. */
  preview: null as unknown,
}));

const limitsFixture = await vi.hoisted(async () => await import('./limitsFixture'));

const httpRec = vi.hoisted(() => ({
  get: vi.fn(async (url: string) => {
    if (/presets/.test(url)) return { data: { presets: [] } };
    // The server's ranges (`GET /rooms/limits`): the form has no copy of its own.
    if (/\/rooms\/limits$/.test(url)) return { data: limitsFixture.TEST_LIMITS };
    return { data: {} };
  }),
  put: vi.fn(async (...args: unknown[]) => {
    void args;
    return { data: rest.configResponse ?? {} };
  }),
  post: vi.fn(async (...args: unknown[]) => {
    if (!/\/rooms\/preview$/.test(String(args[0]))) return { data: {} };
    const answer =
      typeof rest.preview === 'function'
        ? (rest.preview as (body: unknown) => unknown)(args[1])
        : rest.preview;
    return { data: await Promise.resolve(answer) };
  }),
  patch: vi.fn(async () => ({ data: {} })),
  delete: vi.fn(async () => ({ data: {} })),
  defaults: { baseURL: '/api/v1', headers: { common: {} } },
  interceptors: {
    request: { use: vi.fn(), eject: vi.fn() },
    response: { use: vi.fn(), eject: vi.fn() },
  },
}));

vi.mock('../api/http', async (importOriginal) => {
  const actual = (await importOriginal()) as Json;
  return { ...actual, default: httpRec, http: httpRec };
});

vi.mock('../api/health', () => ({ checkHealth: vi.fn(async () => true) }));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ROOM = 'ABC234';
const HOST_SECRET = 'hs-test';

function roleDefaults(): RoleConfig {
  return {
    initial_inventory: 12,
    initial_backlog: 0,
    shipping_delay_weeks: 2,
    information_delay_weeks: 2,
    initial_pipeline_quantity: 4,
    initial_order_in_pipeline: 4,
    holding_cost_per_unit_week: 0.5,
    backlog_cost_per_unit_week: 1.0,
    fixed_order_cost: 0.0,
    unit_purchase_cost: 0.0,
    starting_capital: 0.0,
  };
}

function factoryDefaults(): FactoryConfig {
  return { ...roleDefaults(), production_delay_weeks: 2, production_capacity_per_week: null };
}

function visibilityDefaults(): VisibilityConfig {
  return {
    show_true_customer_demand_to_all: false,
    show_neighbour_inventory: false,
    show_all_inventories: false,
    show_supply_line_prominently: true,
    show_running_cost_to_players: true,
    show_leaderboard_during_game: false,
    max_order_quantity: null,
  };
}

function config(duration: number, demand: DemandConfig, over: Partial<GameConfig> = {}): GameConfig {
  return {
    duration_weeks: duration,
    stage_count: 4,
    pause_on_disconnect: true,
    bot_fill_empty_roles: false,
    random_seed: null,
    currency_symbol: '$',
    role_assignment_mode: 'HOST_ASSIGNS',
    preset_name: null,
    roles: {
      RETAILER: roleDefaults(),
      WHOLESALER: roleDefaults(),
      DISTRIBUTOR: roleDefaults(),
      FACTORY: factoryDefaults(),
    },
    demand,
    visibility: visibilityDefaults(),
    bot: { theta: 0.25, alpha: 0.3, beta: 0.25, target_stock_multiplier: 3.0 },
    ...over,
  };
}

const EMPTY_ROLE_TO_ALIAS: Record<Role, string | null> = {
  RETAILER: null,
  WHOLESALER: null,
  DISTRIBUTOR: null,
  FACTORY: null,
};

// ---------------------------------------------------------------------------
// Store driving
// ---------------------------------------------------------------------------

let seq = 0;
const nextSeq = () => ++seq;
const store = () => useGameStore.getState();

function applyConfig(cfg: GameConfig): void {
  act(() => {
    store().applyConfigUpdated({ seq: nextSeq(), config: cfg });
  });
}

function applyLobby(state: RoomState): void {
  act(() => {
    store().applyLobbyUpdate({
      seq: nextSeq(),
      state,
      host_display_name: 'Ana',
      participants: [],
      role_to_alias: { ...EMPTY_ROLE_TO_ALIAS },
      role_assignment_mode: 'HOST_ASSIGNS',
      seats_total: 4,
      config_locked: false,
      can_start: false,
      start_blocked_reason: 'Four roles are still empty. Assign them, or turn on bot fill.',
    });
  });
}

async function mountPanel(cfg: GameConfig): Promise<ReturnType<typeof userEvent.setup>> {
  if (rec.socket) rec.socket.connected = true;
  store().setRoomCode(ROOM);
  store().setIsHost(true);
  setHostSecret(ROOM, HOST_SECRET);
  setHostRoom(ROOM);
  applyLobby('CONFIGURING');
  applyConfig(cfg);

  const user = userEvent.setup({ delay: null });
  render(
    <MemoryRouter initialEntries={[`/host/${ROOM}`]}>
      <ConfigPanel />
    </MemoryRouter>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  return user;
}

// ---------------------------------------------------------------------------
// Reading the wire
// ---------------------------------------------------------------------------

function savedConfigs(): Json[] {
  const fromSocket = rec.emits
    .filter((e) => e.event === 'config_update')
    .map((e) => ((e.payload ?? {}) as Json).config as Json);
  const fromRest = httpRec.put.mock.calls
    .filter((c) => /\/rooms\/.+\/config$/.test(String(c[0])))
    .map((c) => ((c[1] ?? {}) as Json).config as Json);
  return [...fromSocket, ...fromRest].filter((c): c is Json => !!c && typeof c === 'object');
}

function saveCount(): number {
  return savedConfigs().length;
}

function lastSavedDemand(): Json {
  const withDemand = savedConfigs().filter((c) => c.demand);
  expect(withDemand.length, 'the panel saved no demand').toBeGreaterThan(0);
  return withDemand[withDemand.length - 1].demand as Json;
}

async function waitForDemandSave(previous = 0): Promise<void> {
  await waitFor(
    () => expect(savedConfigs().filter((c) => c.demand).length).toBeGreaterThan(previous),
    { timeout: 2000 },
  );
}

function clearWire(): void {
  rec.emits.length = 0;
  httpRec.put.mockClear();
}

// ---------------------------------------------------------------------------
// Locating the editor's controls
// ---------------------------------------------------------------------------

const KINDS = ['CONSTANT', 'STEP', 'RAMP', 'SEASONAL', 'STOCHASTIC', 'CUSTOM'] as const;
type Kind = (typeof KINDS)[number];

function textOf(el: Element | null): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function bodyText(): string {
  return (document.body.textContent ?? '').replace(/\s+/g, ' ');
}

function byHandles(keys: string[]): HTMLElement | null {
  for (const key of keys) {
    const escaped = CSS.escape(key);
    const found = document.querySelector<HTMLElement>(
      `[name="${escaped}"], [data-field="${escaped}"], [data-testid="${escaped}"], [id="${escaped}"]`,
    );
    if (found) return found;
  }
  return null;
}

function kindSelect(): HTMLSelectElement | null {
  return (
    Array.from(document.querySelectorAll('select')).find((s) =>
      Array.from(s.options).some((o) => KINDS.includes(o.value as Kind)),
    ) ?? null
  );
}

/** The generator picker when it is the app's own dropdown: the combobox whose list offers a kind. */
function kindCombobox(): HTMLElement | null {
  return (
    screen.queryAllByRole('combobox').find((combo) => {
      const list = document.getElementById(combo.getAttribute('aria-controls') ?? '');
      return Array.from(list?.querySelectorAll('[role="option"]') ?? []).some((o) =>
        KINDS.includes(o.getAttribute('data-value') as Kind),
      );
    }) ?? null
  );
}

async function chooseKind(user: ReturnType<typeof userEvent.setup>, kind: Kind): Promise<void> {
  const select = kindSelect();
  if (select) {
    await user.selectOptions(select, kind);
    return;
  }
  const combo = kindCombobox();
  if (combo) {
    await user.click(combo);
    const list = document.getElementById(combo.getAttribute('aria-controls') ?? '');
    const option = list?.querySelector<HTMLElement>(`[role="option"][data-value="${kind}"]`);
    if (!option) throw new Error(`The generator picker offers no ${kind}.`);
    await user.click(option);
    return;
  }
  const named = new RegExp(kind, 'i');
  for (const role of ['radio', 'button', 'tab', 'option'] as const) {
    const found = screen.queryByRole(role, { name: named });
    if (found) {
      await user.click(found);
      return;
    }
  }
  const handle = byHandles(['demand.kind', 'kind', 'demand-kind']);
  if (handle instanceof HTMLSelectElement) {
    await user.selectOptions(handle, kind);
    return;
  }
  throw new Error(
    `No way to choose the ${kind} generator. 18 §2 names the picker but freezes no ` +
      'accessible name or test id for it (contrast §2.6, which does freeze ' +
      '`data-testid="demand-preview"`).',
  );
}

function demandField(leaf: string): HTMLElement | null {
  return byHandles([`demand.${leaf}`, leaf, `demand-${leaf}`]);
}

/** The textarea or text box that takes a pasted CUSTOM series. */
function customInput(): HTMLElement {
  const handle = byHandles(['demand.values', 'values', 'demand-values', 'custom-demand']);
  if (handle) return handle;
  const textarea = document.querySelector('textarea');
  if (textarea) return textarea;
  const box = screen.queryByRole('textbox', { name: /(value|series|demand|paste|list|csv)/i });
  if (box) return box;
  throw new Error(
    'No input for a pasted CUSTOM demand series (18 §2, acceptance criterion 8). The ' +
      'document freezes no handle for it.',
  );
}

function previewSeries(): string {
  const preview = screen.getByTestId('demand-preview');
  const series = preview.getAttribute('data-series');
  expect(
    series,
    '§2.6 requires `data-series` on `data-testid="demand-preview"` — a canvas is not assertable',
  ).not.toBeNull();
  return (series ?? '').replace(/\s+/g, '');
}

/** The text of whatever the input names as its own description. */
function describedText(el: HTMLElement): string {
  const ids = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
  return ids.map((id) => textOf(document.getElementById(id))).join(' ');
}

/**
 * "7 of 8", "7 / 8", "7 out of 8" — the parsed count against duration_weeks.
 *
 * The input's own accessible description is searched first, because the pasted
 * text sits right next to the count in the flattened body text and would run
 * into it ("...,4" + "7 of 8" reads as "47 of 8").
 */
function parsedCount(duration: number): number {
  const pattern = new RegExp(String.raw`\b(\d+)\s*(?:of|out of|\/)\s*${duration}\b`, 'i');
  for (const text of [describedText(customInput()), bodyText()]) {
    const match = text.match(pattern);
    if (match) return Number(match[1]);
  }
  throw new Error(
    `The demand editor does not report the parsed count against duration_weeks=${duration} ` +
      '(18 §2, acceptance criterion 8). The document does not fix the copy, so this ' +
      'harness accepts "N of D", "N / D" and "N out of D".',
  );
}

async function dropCsv(user: ReturnType<typeof userEvent.setup>, text: string): Promise<void> {
  const file = new File([text], 'demand.csv', { type: 'text/csv' });
  const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (fileInput) {
    await user.upload(fileInput, file);
    return;
  }
  const zone =
    document.querySelector<HTMLElement>('[data-testid="demand-csv"], [data-testid="demand-drop"]') ??
    customInput();
  await act(async () => {
    // A real `DataTransfer.files` is a FileList: indexable, with `length` and
    // `item()`. A bare array is not, and the difference is invisible until the
    // code under test calls `files.item(0)`.
    const files = {
      0: file,
      length: 1,
      item: (index: number) => (index === 0 ? file : null),
      [Symbol.iterator]: function* () {
        yield file;
      },
    };
    fireEvent.drop(zone, {
      dataTransfer: {
        files,
        items: [{ kind: 'file', type: 'text/csv', getAsFile: () => file }],
        types: ['Files'],
      },
    });
    await Promise.resolve();
  });
}

async function pasteCustom(
  user: ReturnType<typeof userEvent.setup>,
  text: string,
): Promise<void> {
  const input = customInput();
  await user.clear(input);
  await user.type(input, text);
  await user.tab();
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  seq = 0;
  rec.emits.length = 0;
  rec.listeners.clear();
  if (rec.socket) rec.socket.connected = true;
  rest.configResponse = null;
  rest.preview = echoPreview;
  resetPreviewCacheForTests();
  httpRec.post.mockClear();
  store().reset();
});

// ---------------------------------------------------------------------------
// §2.6 — the preview: the server's numbers, drawn as sent (2026-11-03)
// ---------------------------------------------------------------------------

type PreviewBody = { config: GameConfig };

/** Every `POST /rooms/preview` body the panel sent, oldest first. */
function previewRequests(): PreviewBody[] {
  return httpRec.post.mock.calls
    .filter((call) => /\/rooms\/preview$/.test(String(call[0])))
    .map((call) => call[1] as PreviewBody);
}

/**
 * A stand-in server that answers with a series no client formula would
 * produce: the week number times 100, plus the draft's duration. It proves
 * the panel draws what it is sent, for the draft it sent.
 */
function echoPreview(body: unknown): unknown {
  const draft = (body as PreviewBody).config;
  return {
    demand_series: Array.from({ length: draft.duration_weeks }, (_unused, index) => (index + 1) * 100),
    demand_is_example: draft.demand.kind === 'STOCHASTIC',
    lead_times: { RETAILER: 4, WHOLESALER: 4, DISTRIBUTOR: 4, FACTORY: 2 },
  };
}

function hundreds(weeks: number): string {
  return Array.from({ length: weeks }, (_unused, index) => (index + 1) * 100).join(',');
}

describe('demand preview (§2.6)', () => {
  it('draws exactly the series the server sends for the stored config [AC 10]', async () => {
    const demand: DemandConfig = { kind: 'RAMP', initial_value: 4, slope_per_week: 2, start_week: 3, cap: 12 };
    await mountPanel(config(8, demand));

    await waitFor(() => expect(previewSeries()).toBe(hundreds(8)));
    const sent = previewRequests().at(-1)?.config;
    expect(sent?.duration_weeks).toBe(8);
    expect(sent?.demand).toEqual(demand);
  });

  it('shows a placeholder and no series until the server answers', async () => {
    rest.preview = new Promise(() => {});
    await mountPanel(config(8, { kind: 'CONSTANT', value: 4 }));

    await new Promise((resolve) => setTimeout(resolve, 400));
    const preview = screen.getByTestId('demand-preview');
    expect(preview.getAttribute('data-series')).toBeNull();
    expect(textOf(preview)).toMatch(/working out the preview/i);
  });

  it('shows the server’s refusal of the draft instead of a chart', async () => {
    rest.preview = () =>
      Promise.reject({
        response: { status: 422, data: { detail: 'demand.step_week: step_week must be between 2 and 8.' } },
      });
    await mountPanel(config(8, { kind: 'STEP', initial_value: 4, step_week: 5, step_value: 8 }));

    await waitFor(() =>
      expect(textOf(screen.getByTestId('demand-preview'))).toMatch(/step_week must be between 2 and 8/),
    );
    expect(screen.getByTestId('demand-preview').getAttribute('data-series')).toBeNull();
  });

  it('follows duration_weeks when it changes [AC 10]', async () => {
    await mountPanel(config(8, { kind: 'CONSTANT', value: 4 }));
    await waitFor(() => expect(previewSeries()).toBe(hundreds(8)));

    applyConfig(config(12, { kind: 'CONSTANT', value: 4 }));
    await waitFor(() => expect(previewSeries()).toBe(hundreds(12)));
    expect(previewRequests().at(-1)?.config.duration_weeks).toBe(12);
  });

  it('debounces: a burst of changes sends one request, for the last draft', async () => {
    await mountPanel(config(8, { kind: 'CONSTANT', value: 4 }));
    await waitFor(() => expect(previewSeries()).toBe(hundreds(8)));
    httpRec.post.mockClear();

    for (const weeks of [9, 10, 11, 12]) applyConfig(config(weeks, { kind: 'CONSTANT', value: 4 }));
    await waitFor(() => expect(previewSeries()).toBe(hundreds(12)));

    expect(previewRequests().map((body) => body.config.duration_weeks)).toEqual([12]);
  });

  it('labels the series an example draw when the server says so [AC 11]', async () => {
    await mountPanel(
      config(8, { kind: 'STOCHASTIC', distribution: 'NORMAL', mean: 8, stdev: 2, min: 0, max: 20 }),
    );

    await waitFor(() =>
      expect(bodyText()).toMatch(/Example draw[;,]? the real series is generated at start\./i),
    );
  });

  it('says the series is the one the game will run when the server says it is', async () => {
    await mountPanel(config(8, { kind: 'STEP', initial_value: 4, step_week: 5, step_value: 8 }));

    await waitFor(() => expect(bodyText()).toMatch(/exactly as the game will run them/i));
    expect(bodyText()).not.toMatch(/example draw/i);
  });
});

// ---------------------------------------------------------------------------
// §2 / §3.1a — switching the generator
// ---------------------------------------------------------------------------

describe('switching the generator (§2)', () => {
  it('waits for the server’s defaults, then shows the new kind’s block [AC 7]', async () => {
    const user = await mountPanel(
      config(12, { kind: 'STEP', initial_value: 4, step_week: 5, step_value: 8 }),
    );
    expect(demandField('step_week'), 'the STEP block should be on screen first').not.toBeNull();
    clearWire();

    await chooseKind(user, 'SEASONAL');
    await waitForDemandSave();

    expect(lastSavedDemand()).toEqual({ kind: 'SEASONAL' });
    // No copy of the defaults: until the stored config arrives, the block waits.
    expect(bodyText()).toMatch(/loading the seasonal settings/i);
    expect(demandField('base')).toBeNull();

    applyConfig(config(12, { kind: 'SEASONAL', base: 8, amplitude: 4, period_weeks: 12, phase: 0 }));
    await waitFor(() => expect(demandField('base')).not.toBeNull());
    expect(demandField('step_week'), 'the STEP parameter block must be gone').toBeNull();
  });

  it('previews the new kind straight away, with the server filling its defaults', async () => {
    const user = await mountPanel(
      config(12, { kind: 'STEP', initial_value: 4, step_week: 5, step_value: 8 }),
    );
    await waitFor(() => expect(previewSeries()).toBe(hundreds(12)));

    await chooseKind(user, 'SEASONAL');

    await waitFor(() => expect(previewRequests().at(-1)?.config.demand).toEqual({ kind: 'SEASONAL' }));
  });

  it('carries no field of the previous kind in the payload [FM 2]', async () => {
    const user = await mountPanel(
      config(12, { kind: 'STEP', initial_value: 4, step_week: 5, step_value: 8 }),
    );
    clearWire();

    await chooseKind(user, 'SEASONAL');
    await waitForDemandSave();

    const demand = lastSavedDemand();
    expect(Object.keys(demand)).not.toContain('step_week');
    expect(Object.keys(demand)).not.toContain('step_value');
    expect(Object.keys(demand)).not.toContain('initial_value');
  });

  it('sends the kind alone, and the server fills the defaults [§3.1a]', async () => {
    const user = await mountPanel(config(12, { kind: 'CONSTANT', value: 4 }));
    clearWire();

    await chooseKind(user, 'RAMP');
    await waitForDemandSave();

    // 2026-11-03: the panel used to send its own copy of 03 §2's RampDemand
    // defaults. A changed kind replaces the stored demand, and
    // `GameConfig.from_host_input` fills every field the patch leaves out.
    expect(lastSavedDemand()).toEqual({ kind: 'RAMP' });
  });

  it('saves a pasted series with its kind, so switching from another generator sticks', async () => {
    const EIGHT = [4, 4, 8, 4, 4, 8, 4, 8];
    const user = await mountPanel(
      config(8, { kind: 'STEP', initial_value: 4, step_week: 5, step_value: 8 }),
    );
    clearWire();

    await chooseKind(user, 'CUSTOM');
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(saveCount(), 'an empty series is refused, so choosing CUSTOM sends nothing').toBe(0);

    await pasteCustom(user, EIGHT.join(','));
    await waitForDemandSave();

    // Without the kind, the server merged `values` into the STEP object,
    // which ignored them: the game never became CUSTOM.
    expect(lastSavedDemand()).toEqual({ kind: 'CUSTOM', values: EIGHT });
  });
});

// ---------------------------------------------------------------------------
// §2 — CUSTOM
// ---------------------------------------------------------------------------

describe('CUSTOM demand (§2)', () => {
  const EIGHT = [4, 4, 8, 4, 4, 8, 4, 8];

  it('parses a comma-separated list [AC 8]', async () => {
    const user = await mountPanel(config(8, { kind: 'CUSTOM', values: [...EIGHT] }));
    clearWire();

    await pasteCustom(user, EIGHT.join(','));
    await waitForDemandSave();

    expect(lastSavedDemand().values).toEqual(EIGHT);
  });

  it('parses a newline-separated list [AC 8]', async () => {
    const user = await mountPanel(config(8, { kind: 'CUSTOM', values: [...EIGHT] }));
    clearWire();

    await pasteCustom(user, EIGHT.join('\n'));
    await waitForDemandSave();

    expect(lastSavedDemand().values).toEqual(EIGHT);
  });

  it('parses a dropped CSV file [AC 8]', async () => {
    const user = await mountPanel(config(8, { kind: 'CUSTOM', values: [...EIGHT] }));
    clearWire();

    await dropCsv(user, `${EIGHT.join(',')}\n`);
    await waitForDemandSave();

    expect(lastSavedDemand().values).toEqual(EIGHT);
  });

  it('reports the parsed count against duration_weeks [AC 8]', async () => {
    const user = await mountPanel(config(8, { kind: 'CUSTOM', values: [...EIGHT] }));

    await pasteCustom(user, '4,4,8,4,4,8,4');
    await waitFor(() => expect(parsedCount(8)).toBe(7));
  });

  it('ignores a trailing newline rather than counting it as a value [FM 9]', async () => {
    const user = await mountPanel(config(8, { kind: 'CUSTOM', values: [...EIGHT] }));
    clearWire();

    // Eight values plus a trailing newline. A parser that counts the empty tail
    // produces nine, or an eighth value of NaN.
    await pasteCustom(user, `${EIGHT.join(',')}\n`);
    await waitForDemandSave();

    const values = lastSavedDemand().values as number[];
    expect(values).toEqual(EIGHT);
    expect(values).toHaveLength(8);
  });

  it('parses "4,4,8,\\n" as three values, not four [FM 9]', async () => {
    const user = await mountPanel(config(8, { kind: 'CUSTOM', values: [...EIGHT] }));

    await pasteCustom(user, '4,4,8,\n');
    await waitFor(() => expect(parsedCount(8)).toBe(3));
  });

  it('blocks submission when the series is shorter than duration_weeks [AC 9]', async () => {
    const user = await mountPanel(config(8, { kind: 'CUSTOM', values: [...EIGHT] }));
    clearWire();

    await pasteCustom(user, '4,4,8,\n');
    // Well past the 400 ms debounce of §3.1 and the blur save.
    await new Promise((resolve) => setTimeout(resolve, 900));

    expect(
      saveCount(),
      'a CUSTOM series shorter than duration_weeks is the one demand error the server ' +
        'rejects rather than clamps (§2), so the form must not submit it',
    ).toBe(0);

    const messages = Array.from(
      document.querySelectorAll('[role="alert"], [aria-live], [aria-invalid="true"]'),
    ).map((el) => textOf(el));
    expect(
      messages.length > 0 || /short|at least|fewer|needs \d+|missing/i.test(bodyText()),
      'AC 9 requires an inline message explaining the block',
    ).toBe(true);
  });

  it('submits again once the series is long enough [AC 9]', async () => {
    const user = await mountPanel(config(8, { kind: 'CUSTOM', values: [...EIGHT] }));
    clearWire();

    await pasteCustom(user, '4,4,8,\n');
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(saveCount()).toBe(0);

    await pasteCustom(user, EIGHT.join(','));
    await waitForDemandSave();

    expect(lastSavedDemand().values).toEqual(EIGHT);
  });
});
