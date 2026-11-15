/**
 * Multi-game hosting: one base config, N games (`POST /rooms/batch-create`), and
 * a dashboard above each game's unchanged host screen (`10 §3.5c`, `§3.5d`).
 *
 * The setup page runs the lobby's own config form (`ConfigSections`) over a
 * local draft (2026-11-14). The fake `previewConfig` below plays the server's
 * part: it merges the patch over the draft, fills a new demand kind's
 * defaults, refuses what the server refuses with its `"field: message"` 422,
 * and answers with the validated `config`.
 *
 * Seats and status come from `POST /rooms/summary`. A host screen opens in its
 * own tab, which only works if the browser copies this tab's sessionStorage,
 * so the opener must be kept (no `noopener`). "Start all ready games" sends
 * the ordinary `start_game` emit, through `api/games.ts`, for each room the
 * server says can start.
 *
 * Harness: the REST client, the emit module and `http.ts` are replaced by
 * recorders, so no socket or Firebase stub is needed; the store and storage
 * are the real ones.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import type { GameConfig, PresetSummary, RoomCreateResponse, RoomSummary } from '../types/game';
import { TEST_LIMITS } from './limitsFixture';

const api = vi.hoisted(() => ({
  createRoomBatch: vi.fn(),
  previewConfig: vi.fn(),
  getRoomsSummary: vi.fn(),
  listPresets: vi.fn(),
  getLimits: vi.fn(),
  startGame: vi.fn(),
}));

vi.mock('../api/rooms', () => ({
  createRoomBatch: api.createRoomBatch,
  previewConfig: api.previewConfig,
  getRoomsSummary: api.getRoomsSummary,
  listPresets: api.listPresets,
  getLimits: api.getLimits,
}));

vi.mock('../api/games', () => ({ startGame: api.startGame, join: vi.fn(), joinWaiting: vi.fn() }));

// The real `socketHandlers.ts` registers against this recorder, so a test can
// deliver a server `join_error` exactly as the wire would.
const wire = vi.hoisted(() => ({
  listeners: new Map<string, Array<(payload: unknown) => void>>(),
}));

vi.mock('../api/socket', () => ({
  socket: {
    connected: true,
    active: true,
    on: (event: string, cb: (payload: unknown) => void) => {
      wire.listeners.set(event, [...(wire.listeners.get(event) ?? []), cb]);
    },
    connect: () => {},
  },
}));

function serverSends(event: string, payload: unknown): void {
  act(() => {
    for (const listener of wire.listeners.get(event) ?? []) listener(payload);
  });
}

vi.mock('../api/http', () => ({
  default: {},
  errorMessage: (err: unknown, fallback: string) => {
    const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
    return typeof detail === 'string' ? detail : fallback;
  },
  isRateLimited: () => false,
}));

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ firebaseUser: null, mode: 'guest', logout: async () => {} }),
}));

import '../api/socketHandlers';
import * as SetupModule from '../pages/MultiHostSetupPage';
import * as DashboardModule from '../pages/MultiHostDashboard';
import * as HomePageModule from '../pages/HomePage';
import { openHostScreen, startAllStatus, statusLabel } from '../components/multihost/multihost';
import { resetLimitsCacheForTests } from '../components/config/useLimits';
import { resetPreviewCacheForTests } from '../components/config/useConfigPreview';
import { fieldFromPreviewError } from '../components/config/useDraftConfig';
import { inviteUrl } from '../components/lobby/roomCode';
import { useGameStore } from '../store/gameStore';
import {
  clearHostBatch,
  getDisplayName,
  getHostBatch,
  getHostSecret,
  isHostForRoom,
  setHostBatch,
  setHostSecret,
} from '../utils/storage';

const A = 'ABC234';
const B = 'DEF567';
const C = 'GHJ789';

function baseConfig(over: Partial<GameConfig> = {}): GameConfig {
  const role = {
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
  return {
    duration_weeks: 36,
    stage_count: 4,
    pause_on_disconnect: true,
    bot_fill_empty_roles: true,
    random_seed: null,
    currency_symbol: '$',
    role_assignment_mode: 'HOST_ASSIGNS',
    preset_name: null,
    roles: {
      RETAILER: { ...role },
      WHOLESALER: { ...role },
      DISTRIBUTOR: { ...role },
      FACTORY: { ...role, production_delay_weeks: 2, production_capacity_per_week: null },
    },
    demand: { kind: 'STEP', initial_value: 4, step_week: 5, step_value: 8 },
    visibility: {
      show_true_customer_demand_to_all: false,
      show_neighbour_inventory: false,
      show_all_inventories: false,
      show_supply_line_prominently: true,
      show_running_cost_to_players: true,
      show_leaderboard_during_game: false,
      max_order_quantity: null,
    },
    bot: { theta: 0.25, alpha: 0.3, beta: 0.25, target_stock_multiplier: 3.0 },
    ...over,
  } as GameConfig;
}

// Alphabetical, as the server lists them: the default is not first, so the
// page must find it by `is_default`, not by position.
const PRESETS: PresetSummary[] = [
  {
    name: 'CHAOS',
    label: 'Chaos',
    description: '48 weeks. Expect failure.',
    config: baseConfig({ preset_name: 'CHAOS', duration_weeks: 48 }),
    is_default: false,
  },
  {
    name: 'CLASSIC_MIT',
    label: 'Classic MIT',
    description: '36 weeks. The standard.',
    config: baseConfig({ preset_name: 'CLASSIC_MIT' }),
    is_default: true,
  },
  {
    name: 'FAST_GAME',
    label: 'Fast Game',
    description: '20 weeks. Tight.',
    config: baseConfig({ preset_name: 'FAST_GAME', duration_weeks: 20 }),
    is_default: false,
  },
];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = isObject(value) && isObject(out[key]) ? deepMerge(out[key] as Record<string, unknown>, value) : value;
  }
  return out;
}

/** The server's side of `POST /rooms/preview`, for this file. */
async function fakePreview(config: GameConfig, patch?: Record<string, unknown>) {
  let merged = deepMerge(config as unknown as Record<string, unknown>, patch ?? {});
  const patchDemand = patch?.demand;
  if (isObject(patchDemand) && patchDemand.kind !== config.demand.kind) {
    // A changed kind replaces the block; the server fills that kind's defaults.
    const defaults =
      patchDemand.kind === 'CONSTANT' ? { kind: 'CONSTANT', value: 6 } : { ...patchDemand };
    merged = { ...merged, demand: { ...defaults, ...patchDemand } };
  }
  if (merged.currency_symbol === '##') {
    throw {
      isAxiosError: true,
      response: { status: 422, data: { detail: 'currency_symbol: must not be ##.' } },
    };
  }
  const weeks = merged.duration_weeks as number;
  return {
    demand_series: Array.from({ length: weeks }, () => 4),
    demand_is_example: false,
    lead_times: { RETAILER: 4, WHOLESALER: 4, DISTRIBUTOR: 4, FACTORY: 3 },
    config: merged as unknown as GameConfig,
  };
}

function summary(room_code: string, fields: Partial<RoomSummary> = {}): RoomSummary {
  return {
    room_code,
    exists: true,
    state: 'LOBBY',
    seats_taken: 0,
    seats_total: 4,
    week: null,
    duration_weeks: 36,
    finished: false,
    can_start: false,
    start_blocked_reason: 'Four roles are still empty. Assign them, or turn on bot fill.',
    ...fields,
  };
}

function gone(room_code: string): RoomSummary {
  return {
    room_code,
    exists: false,
    state: null,
    seats_taken: null,
    seats_total: null,
    week: null,
    duration_weeks: null,
    finished: null,
    can_start: null,
    start_blocked_reason: null,
  };
}

function created(room_code: string, host_secret: string): RoomCreateResponse {
  return { room_code, host_secret, state: 'LOBBY', config: {} as GameConfig };
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/multihost/new" element={SetupModule.route.element} />
        <Route path="/multihost" element={DashboardModule.route.element} />
        <Route path="/home" element={HomePageModule.route.element} />
      </Routes>
    </MemoryRouter>,
  );
}

function seedBatch(): void {
  setHostBatch([A, B, C]);
  setHostSecret(A, 'secret-a');
  setHostSecret(B, 'secret-b');
  setHostSecret(C, 'secret-c');
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.getLimits.mockResolvedValue(TEST_LIMITS);
  api.listPresets.mockResolvedValue({ presets: PRESETS });
  api.previewConfig.mockImplementation(fakePreview);
  api.getRoomsSummary.mockResolvedValue([]);
  resetLimitsCacheForTests();
  resetPreviewCacheForTests();
  act(() => useGameStore.getState().reset());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('routes', () => {
  it('both pages register themselves behind auth and the backend', () => {
    expect([SetupModule.route, DashboardModule.route].map((r) => [r.path, r.guard])).toEqual([
      ['/multihost/new', 'auth+backend'],
      ['/multihost', 'auth+backend'],
    ]);
  });
});

describe('batch storage', () => {
  it('keeps the batch codes in this tab only, and clears them', () => {
    expect(getHostBatch()).toBeNull();
    setHostBatch([A, B]);
    expect(getHostBatch()).toEqual([A, B]);
    expect(sessionStorage.getItem('host_batch')).toBe(JSON.stringify([A, B]));
    expect(localStorage.getItem('host_batch')).toBeNull();
    clearHostBatch();
    expect(getHostBatch()).toBeNull();
  });

  it('treats a malformed or empty stored batch as none', () => {
    sessionStorage.setItem('host_batch', '{not json');
    expect(getHostBatch()).toBeNull();
    sessionStorage.setItem('host_batch', '[1, 2]');
    expect(getHostBatch()).toBeNull();
    sessionStorage.setItem('host_batch', '[]');
    expect(getHostBatch()).toBeNull();
  });
});

describe('statusLabel', () => {
  it('words each state from the server summary', () => {
    expect(statusLabel(undefined)).toBe('Loading…');
    expect(statusLabel(gone('x'))).toBe('Expired or not found');
    expect(statusLabel(summary('x'))).toBe('Waiting for players');
    expect(statusLabel(summary('x', { can_start: true }))).toBe('Ready to start');
    expect(statusLabel(summary('x', { state: 'RUNNING', week: 3, duration_weeks: 20 }))).toBe('Week 3 of 20');
    expect(statusLabel(summary('x', { state: 'PAUSED', week: 3, duration_weeks: 20 }))).toBe(
      'Paused in week 3 of 20',
    );
    expect(statusLabel(summary('x', { state: 'FINISHED', finished: true }))).toBe('Finished');
    expect(statusLabel(summary('x', { state: 'ABANDONED', finished: true }))).toBe('Ended');
  });
});

describe('openHostScreen', () => {
  it('marks the room as hosted, then opens its host screen keeping the opener', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => {
      // sessionStorage is copied when the tab opens, so host_room must be set first.
      expect(isHostForRoom(A)).toBe(true);
      return null;
    });

    openHostScreen(A);

    expect(open).toHaveBeenCalledTimes(1);
    // Exactly two arguments: a third (`'noopener'`) would hand the new tab an
    // empty sessionStorage, and with it no host secret.
    expect(open.mock.calls[0]).toEqual([`/host/${A}`, '_blank']);
  });
});

/** The batch request the page sent, once it has sent one. */
function sentBatch() {
  return api.createRoomBatch.mock.calls[0][0] as {
    count: number;
    preset: string | null;
    config: GameConfig;
    host_display_name: string;
  };
}

async function settingsReady() {
  const form = await screen.findByRole('form', { name: 'Game settings' });
  await waitFor(() => expect(screen.getByRole('button', { name: /^Create \d+ games$/ })).toBeEnabled());
  return within(form);
}

describe('MultiHostSetupPage', () => {
  it('starts from the server default preset and creates the batch with that whole config', async () => {
    api.createRoomBatch.mockResolvedValue({ rooms: [created(A, 'secret-a'), created(B, 'secret-b'), created(C, 'secret-c')] });
    const user = userEvent.setup();
    renderAt('/multihost/new');

    const settings = await settingsReady();
    expect(settings.getByRole('button', { name: /Classic MIT/ })).toHaveAttribute('aria-pressed', 'true');
    expect(settings.getByLabelText('Weeks to play')).toHaveValue(36);

    const count = screen.getByLabelText('Number of games');
    expect(count).toHaveValue(TEST_LIMITS.min_batch_rooms);
    await user.clear(count);
    await user.type(count, '3');
    await user.type(screen.getByLabelText('Name to host as'), 'Ms Frizzle');
    await user.click(screen.getByRole('button', { name: 'Create 3 games' }));

    await waitFor(() => expect(api.createRoomBatch).toHaveBeenCalledTimes(1));
    expect(sentBatch()).toEqual({
      count: 3,
      preset: 'CLASSIC_MIT',
      config: { ...PRESETS[1].config, preset_name: 'CLASSIC_MIT' },
      host_display_name: 'Ms Frizzle',
    });

    expect(await screen.findByRole('heading', { name: 'Your games' })).toBeInTheDocument();
    expect(getHostSecret(A)).toBe('secret-a');
    expect(getHostSecret(B)).toBe('secret-b');
    expect(getHostSecret(C)).toBe('secret-c');
    expect(getHostBatch()).toEqual([A, B, C]);
    expect(getDisplayName()).toBe('Ms Frizzle');
  });

  it('switches the starting point with a preset card', async () => {
    api.createRoomBatch.mockResolvedValue({ rooms: [created(A, 'a'), created(B, 'b')] });
    const user = userEvent.setup();
    renderAt('/multihost/new');

    const settings = await settingsReady();
    await user.click(settings.getByRole('button', { name: /Fast Game/ }));

    await waitFor(() => expect(settings.getByLabelText('Weeks to play')).toHaveValue(20));
    expect(settings.getByRole('button', { name: /Fast Game/ })).toHaveAttribute('aria-pressed', 'true');
    await user.click(await screen.findByRole('button', { name: 'Create 2 games' }));

    await waitFor(() => expect(api.createRoomBatch).toHaveBeenCalled());
    expect(sentBatch().preset).toBe('FAST_GAME');
    expect(sentBatch().config).toMatchObject({ preset_name: 'FAST_GAME', duration_weeks: 20 });
  });

  it('validates each edit through /rooms/preview and sends the validated draft', async () => {
    api.createRoomBatch.mockResolvedValue({ rooms: [created(A, 'a'), created(B, 'b')] });
    const user = userEvent.setup();
    renderAt('/multihost/new');

    const settings = await settingsReady();
    const weeks = settings.getByLabelText('Weeks to play');
    await user.clear(weeks);
    await user.type(weeks, '30');
    await user.tab();

    await waitFor(() =>
      expect(api.previewConfig).toHaveBeenCalledWith(
        expect.objectContaining({ preset_name: 'CLASSIC_MIT', duration_weeks: 36 }),
        { duration_weeks: 30, preset_name: null },
      ),
    );
    // Touching a field leaves the preset: the cards say Custom.
    await waitFor(() => expect(settings.getByRole('button', { name: /^Custom\s*Your own settings/ })).toHaveAttribute('aria-pressed', 'true'));

    await user.click(await screen.findByRole('button', { name: 'Create 2 games' }));
    await waitFor(() => expect(api.createRoomBatch).toHaveBeenCalled());
    expect(sentBatch().preset).toBe('CLASSIC_MIT');
    expect(sentBatch().config).toMatchObject({ duration_weeks: 30, preset_name: null });
    expect(sentBatch().config.roles.FACTORY).toEqual(PRESETS[1].config.roles.FACTORY);
  });

  it("keeps the server's merge: a new demand kind arrives with the server's defaults", async () => {
    api.createRoomBatch.mockResolvedValue({ rooms: [created(A, 'a'), created(B, 'b')] });
    const user = userEvent.setup();
    renderAt('/multihost/new');

    const settings = await settingsReady();
    await user.click(settings.getByRole('combobox', { name: 'Generator' }));
    await user.click(await screen.findByRole('option', { name: /Constant/ }));

    await waitFor(() =>
      expect(api.previewConfig).toHaveBeenCalledWith(expect.anything(), {
        demand: { kind: 'CONSTANT' },
        preset_name: null,
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Create 2 games' }));
    await waitFor(() => expect(api.createRoomBatch).toHaveBeenCalled());
    expect(sentBatch().config.demand).toEqual({ kind: 'CONSTANT', value: 6 });
  });

  it("shows the server's preview of the draft, as the lobby does", async () => {
    renderAt('/multihost/new');

    const settings = await settingsReady();
    const leadTimes = await settings.findByTestId('lead-time-row');
    await waitFor(() => expect(within(leadTimes).getAllByText('4 weeks')).toHaveLength(3));
    expect(within(leadTimes).getByText('3 weeks')).toBeInTheDocument();
    await waitFor(() => expect(settings.getByTestId('demand-preview')).toHaveAttribute('data-series'));
  });

  it("refuses to create while the server refuses the draft, naming the field", async () => {
    const user = userEvent.setup();
    renderAt('/multihost/new');

    const settings = await settingsReady();
    const symbol = settings.getByLabelText('Currency symbol');
    await user.clear(symbol);
    await user.type(symbol, '##');
    await user.tab();

    expect(await settings.findByText('must not be ##.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create games' })).toBeDisabled();
    expect(screen.getByText('Fix this setting first: currency_symbol: must not be ##.')).toBeInTheDocument();
    expect(api.createRoomBatch).not.toHaveBeenCalled();

    // Fixing it lets the host create again.
    await user.clear(symbol);
    await user.type(symbol, '€');
    await user.tab();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create 2 games' })).toBeEnabled());
  });

  it('reads the field out of a preview 422 and nothing else', () => {
    const refusal = (status: number, detail: unknown) => ({ response: { status, data: { detail } } });
    expect(fieldFromPreviewError(refusal(422, 'roles.RETAILER.initial_inventory: must be at most 9999.'))).toEqual({
      field: 'roles.RETAILER.initial_inventory',
      message: 'must be at most 9999.',
    });
    expect(fieldFromPreviewError(refusal(422, 'no field here'))).toBeNull();
    expect(fieldFromPreviewError(refusal(429, 'duration_weeks: x'))).toBeNull();
    expect(fieldFromPreviewError(refusal(422, [{ loc: ['body'] }]))).toBeNull();
    expect(fieldFromPreviewError(null)).toBeNull();
  });

  it("refuses a count outside the server's range rather than clamping it", async () => {
    const user = userEvent.setup();
    renderAt('/multihost/new');
    await settingsReady();

    const count = screen.getByLabelText('Number of games');
    await user.clear(count);
    await user.type(count, String(TEST_LIMITS.max_batch_rooms + 1));
    expect(screen.getByRole('button', { name: 'Create games' })).toBeDisabled();
    expect(screen.getByText(/whole number from 2 to 10/)).toBeInTheDocument();

    await user.clear(count);
    expect(screen.getByRole('button', { name: 'Create games' })).toBeDisabled();

    await user.type(count, '4');
    expect(screen.getByRole('button', { name: 'Create 4 games' })).toBeEnabled();
    expect(api.createRoomBatch).not.toHaveBeenCalled();
  });

  it('cannot create until the range has arrived', async () => {
    api.getLimits.mockReturnValue(new Promise(() => {}));
    renderAt('/multihost/new');
    expect(await screen.findByRole('button', { name: 'Create games' })).toBeDisabled();
    expect(screen.getByText('Loading the allowed range…')).toBeInTheDocument();
  });

  it('cannot create without a starting config, and says why', async () => {
    api.listPresets.mockRejectedValue({ isAxiosError: true, response: { status: 503, data: { detail: 'Server busy.' } } });
    renderAt('/multihost/new');

    expect(await screen.findByRole('alert')).toHaveTextContent('Server busy.');
    expect(screen.getByRole('button', { name: 'Create games' })).toBeDisabled();
  });

  it("shows the server's refusal and stores nothing", async () => {
    api.createRoomBatch.mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { detail: 'Unknown preset.' } },
    });
    const user = userEvent.setup();
    renderAt('/multihost/new');
    await settingsReady();

    await user.click(screen.getByRole('button', { name: 'Create 2 games' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Unknown preset.');
    expect(getHostBatch()).toBeNull();
  });

  it('stores nothing when a room comes back without a secret', async () => {
    api.createRoomBatch.mockResolvedValue({ rooms: [created(A, 'secret-a'), created(B, '')] });
    const user = userEvent.setup();
    renderAt('/multihost/new');
    await settingsReady();

    await user.click(screen.getByRole('button', { name: 'Create 2 games' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/no host secret/);
    expect(getHostBatch()).toBeNull();
    expect(getHostSecret(A)).toBeNull();
  });
});

describe('MultiHostDashboard', () => {
  it('sends to the setup page when this tab has no batch', async () => {
    renderAt('/multihost');
    expect(await screen.findByLabelText('Number of games')).toBeInTheDocument();
    expect(api.getRoomsSummary).not.toHaveBeenCalled();
  });

  it('shows a card per game with its code, link, seats and status', async () => {
    seedBatch();
    api.getRoomsSummary.mockResolvedValue([
      summary(A, { seats_taken: 4, can_start: true, start_blocked_reason: null }),
      summary(B, { seats_taken: 1 }),
      gone(C),
    ]);
    renderAt('/multihost');

    expect(api.getRoomsSummary).toHaveBeenCalledWith([
      { room_code: A, host_secret: 'secret-a' },
      { room_code: B, host_secret: 'secret-b' },
      { room_code: C, host_secret: 'secret-c' },
    ]);

    const first = within(screen.getByRole('article', { name: 'Game 1' }));
    expect(first.getByText(A)).toBeInTheDocument();
    expect(first.getByLabelText(`Invite link for game ${A}`)).toHaveValue(`${window.location.origin}/join/${A}`);
    expect(await first.findByLabelText('Seats taken')).toHaveTextContent('4 / 4');
    expect(first.getByText('Ready to start')).toBeInTheDocument();

    const second = within(screen.getByRole('article', { name: 'Game 2' }));
    expect(second.getByLabelText('Seats taken')).toHaveTextContent('1 / 4');
    expect(second.getByText('Waiting for players')).toBeInTheDocument();
    // The server's reason, verbatim: the dashboard does not restate the rule.
    expect(second.getByText('Four roles are still empty. Assign them, or turn on bot fill.')).toBeInTheDocument();

    const third = within(screen.getByRole('article', { name: 'Game 3' }));
    expect(third.getByText('Expired or not found')).toBeInTheDocument();
    expect(third.getByRole('button', { name: /Open host screen/ })).toBeDisabled();
  });

  it('starts only the games the server says are ready', async () => {
    seedBatch();
    api.getRoomsSummary.mockResolvedValue([
      summary(A, { seats_taken: 2, can_start: true }),
      summary(B, { seats_taken: 1 }),
      summary(C, { seats_taken: 4, can_start: true }),
    ]);
    renderAt('/multihost');

    fireEvent.click(await screen.findByRole('button', { name: 'Start all ready games (2)' }));

    expect(api.startGame.mock.calls).toEqual([
      [{ room_id: A, host_secret: 'secret-a' }],
      [{ room_id: C, host_secret: 'secret-c' }],
    ]);
  });

  it('shows a start refusal on that game card only, with no global alert, and a status line', async () => {
    seedBatch();
    let started = false;
    api.getRoomsSummary.mockImplementation(async () =>
      started
        ? [
            summary(A, { state: 'RUNNING', week: 1, seats_taken: 4 }),
            summary(B, { seats_taken: 1 }),
            summary(C, { seats_taken: 4, can_start: true, start_blocked_reason: null }),
          ]
        : [
            summary(A, { seats_taken: 4, can_start: true, start_blocked_reason: null }),
            summary(B, { seats_taken: 1 }),
            summary(C, { seats_taken: 4, can_start: true, start_blocked_reason: null }),
          ],
    );
    renderAt('/multihost');

    const startAll = await screen.findByRole('button', { name: 'Start all ready games (2)' });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(startAll);
    expect(api.startGame).toHaveBeenCalledTimes(2);

    // The server starts A and refuses C mid-batch, naming C.
    started = true;
    serverSends('join_error', { message: 'Someone left; seat them again.', room_code: C });

    const third = within(screen.getByRole('article', { name: 'Game 3' }));
    expect(third.getByTestId('start-error')).toHaveTextContent(
      `Game 3 (${C}): Someone left; seat them again.`,
    );
    expect(within(screen.getByRole('article', { name: 'Game 1' })).queryByTestId('start-error')).toBeNull();
    expect(within(screen.getByRole('article', { name: 'Game 2' })).queryByTestId('start-error')).toBeNull();
    // Not a global alert, and not the host screen's join refusal.
    expect(useGameStore.getState().alerts).toEqual([]);
    expect(useGameStore.getState().joinError).toBeNull();

    // No status line until the refresh after the click has answered.
    expect(screen.queryByText(/^Started /)).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(await screen.findByText("Started 1 of 2 games. 1 couldn't start, see their cards.")).toBeInTheDocument();
    expect(await screen.findByText('Week 1 of 36')).toBeInTheDocument();
  });

  it('counts only a summary sent after the refresh, not a poll already in flight', async () => {
    seedBatch();
    let release: (rooms: RoomSummary[]) => void = () => {};
    let calls = 0;
    api.getRoomsSummary.mockImplementation(() => {
      calls += 1;
      if (calls === 2) {
        // A poll sent before the click, answering after it: stale.
        return new Promise<RoomSummary[]>((resolve) => {
          release = resolve;
        });
      }
      return Promise.resolve(
        calls === 1
          ? [summary(A, { can_start: true }), summary(B, { can_start: true }), summary(C)]
          : [summary(A, { state: 'RUNNING', week: 1 }), summary(B, { state: 'RUNNING', week: 1 }), summary(C)],
      );
    });
    renderAt('/multihost');
    const startAll = await screen.findByRole('button', { name: 'Start all ready games (2)' });

    vi.useFakeTimers({ shouldAdvanceTime: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange')); // poll #2, in flight
    });
    fireEvent.click(startAll);
    await act(async () => {
      release([summary(A, { can_start: true }), summary(B, { can_start: true }), summary(C)]);
    });
    expect(screen.queryByText(/^Started /)).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(await screen.findByText('Started 2 of 2 games.')).toBeInTheDocument();
  });

  it("clears a card's refusal once a later summary shows that game started", async () => {
    seedBatch();
    let running = false;
    api.getRoomsSummary.mockImplementation(async () => [
      summary(A, running ? { state: 'RUNNING', week: 1 } : { can_start: true }),
      summary(B),
      summary(C),
    ]);
    renderAt('/multihost');
    await screen.findByRole('button', { name: 'Start all ready games (1)' });

    serverSends('join_error', { message: 'Not yet.', room_code: A });
    const first = within(screen.getByRole('article', { name: 'Game 1' }));
    expect(first.getByTestId('start-error')).toHaveTextContent(`Game 1 (${A}): Not yet.`);

    running = true;
    // The next poll (a tab shown again asks at once, like the 5 s tick).
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(first.queryByTestId('start-error')).toBeNull());
    expect(await first.findByText('Week 1 of 36')).toBeInTheDocument();
  });

  it('keeps the global alert for a refusal without a room_code or for another room', async () => {
    seedBatch();
    api.getRoomsSummary.mockResolvedValue([summary(A), summary(B), summary(C)]);
    renderAt('/multihost');
    await screen.findByRole('article', { name: 'Game 1' });

    serverSends('join_error', { message: 'Plain refusal.' });
    serverSends('join_error', { message: 'Other room.', room_code: 'ZZZZZZ' });

    expect(useGameStore.getState().alerts.map((a) => a.message)).toEqual(['Plain refusal.', 'Other room.']);
    expect(screen.queryByTestId('start-error')).toBeNull();
  });

  it('words the status line', () => {
    expect(startAllStatus(3, 3)).toBe('Started 3 of 3 games.');
    expect(startAllStatus(1, 3)).toBe("Started 1 of 3 games. 2 couldn't start, see their cards.");
  });

  it('cannot start anything while no game is ready', async () => {
    seedBatch();
    api.getRoomsSummary.mockResolvedValue([summary(A), summary(B), summary(C, { state: 'RUNNING', week: 2 })]);
    renderAt('/multihost');

    await waitFor(() => expect(api.getRoomsSummary).toHaveBeenCalled());
    expect(await screen.findByText('Week 2 of 36')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start all ready games (0)' })).toBeDisabled();
  });

  it('copies a game invite link', async () => {
    seedBatch();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderAt('/multihost');

    const card = within(screen.getByRole('article', { name: 'Game 2' }));
    fireEvent.click(card.getByRole('button', { name: 'Copy' }));

    expect(writeText).toHaveBeenCalledWith(inviteUrl(B));
    expect(await card.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('shows a QR code per game and enlarges it on demand', async () => {
    seedBatch();
    api.getRoomsSummary.mockResolvedValue([summary(A), summary(B), gone(C)]);
    renderAt('/multihost');

    const second = within(screen.getByRole('article', { name: 'Game 2' }));
    const inline = second.getByRole('button', { name: `Show QR code for game ${B}` });
    expect(inline.querySelector('svg')).not.toBeNull();

    fireEvent.click(second.getByRole('button', { name: 'Show QR' }));
    const dialog = screen.getByRole('dialog', { name: `Scan to join room ${B}` });
    expect(dialog).toHaveTextContent(inviteUrl(B));
    expect(dialog.querySelector('svg')).not.toBeNull();
    // The code is the player link only: no host secret anywhere in it.
    expect(dialog.innerHTML).not.toContain('secret-b');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(inline);
    expect(screen.getByRole('dialog', { name: `Scan to join room ${B}` })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(inline);
    fireEvent.click(screen.getByTestId('join-qr-backdrop'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Nobody can join a room that is gone, so it gets no QR code.
    const third = within(screen.getByRole('article', { name: 'Game 3' }));
    await waitFor(() => expect(third.getByText('Expired or not found')).toBeInTheDocument());
    expect(third.queryByRole('button', { name: /Show QR code/ })).not.toBeInTheDocument();
    expect(third.getByRole('button', { name: 'Show QR' })).toBeDisabled();
  });

  it('opens a game host screen in a new tab', () => {
    seedBatch();
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderAt('/multihost');

    const card = within(screen.getByRole('article', { name: 'Game 3' }));
    const button = card.getByRole('button', { name: /Open host screen/ });
    // A button, not a link: a link's "open in new tab" would drop sessionStorage.
    expect(button.tagName).toBe('BUTTON');
    fireEvent.click(button);

    expect(open).toHaveBeenCalledWith(`/host/${C}`, '_blank');
    expect(isHostForRoom(C)).toBe(true);
  });

  it('clears an old room from this tab so a reconnect does not re-join it', () => {
    seedBatch();
    act(() => useGameStore.getState().setRoomCode('ZZZ222'));
    renderAt('/multihost');
    expect(useGameStore.getState().roomCode).toBeNull();
  });

  it('New batch forgets this batch and goes to the setup page', async () => {
    seedBatch();
    renderAt('/multihost');
    fireEvent.click(screen.getByRole('button', { name: 'New batch' }));
    expect(await screen.findByLabelText('Number of games')).toBeInTheDocument();
    expect(getHostBatch()).toBeNull();
    // The secrets stay: each game's host screen may still be open.
    expect(getHostSecret(A)).toBe('secret-a');
  });

  it('shows a failed refresh and polls again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    seedBatch();
    api.getRoomsSummary
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue([summary(A, { seats_taken: 1 }), summary(B), summary(C)]);
    renderAt('/multihost');

    expect(await screen.findByText('Could not refresh the games.')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await waitFor(() => expect(screen.queryByText('Could not refresh the games.')).not.toBeInTheDocument());
    expect(api.getRoomsSummary).toHaveBeenCalledTimes(2);
  });
});

describe('HomePage', () => {
  it('links to the multi-game setup', async () => {
    const user = userEvent.setup();
    renderAt('/home');

    await user.click(screen.getByRole('link', { name: 'Set up several games' }));
    expect(await screen.findByLabelText('Number of games')).toBeInTheDocument();
  });
});
