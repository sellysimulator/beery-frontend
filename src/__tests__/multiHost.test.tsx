/**
 * Multi-game hosting: one preset, N games (`POST /rooms/batch-create`), and a
 * dashboard above each game's unchanged host screen (`10 §3.5c`, `§3.5d`).
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

import type { GameConfig, RoomCreateResponse, RoomSummary } from '../types/game';
import { TEST_LIMITS } from './limitsFixture';

const api = vi.hoisted(() => ({
  createRoomBatch: vi.fn(),
  getRoomsSummary: vi.fn(),
  listPresets: vi.fn(),
  getLimits: vi.fn(),
  startGame: vi.fn(),
}));

vi.mock('../api/rooms', () => ({
  createRoomBatch: api.createRoomBatch,
  getRoomsSummary: api.getRoomsSummary,
  listPresets: api.listPresets,
  getLimits: api.getLimits,
}));

vi.mock('../api/games', () => ({ startGame: api.startGame }));

vi.mock('../api/http', () => ({
  default: {},
  errorMessage: (err: unknown, fallback: string) => {
    const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
    return typeof detail === 'string' ? detail : fallback;
  },
}));

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ firebaseUser: null, mode: 'guest', logout: async () => {} }),
}));

import * as SetupModule from '../pages/MultiHostSetupPage';
import * as DashboardModule from '../pages/MultiHostDashboard';
import * as HomePageModule from '../pages/HomePage';
import { openHostScreen, statusLabel } from '../components/multihost/multihost';
import { resetLimitsCacheForTests } from '../components/config/useLimits';
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
  api.listPresets.mockResolvedValue({
    presets: [
      { name: 'CLASSIC_MIT', label: 'Classic MIT', description: '36 weeks. The standard.', config: {} },
      { name: 'FAST_GAME', label: 'Fast Game', description: '20 weeks. Tight.', config: {} },
    ],
  });
  api.getRoomsSummary.mockResolvedValue([]);
  resetLimitsCacheForTests();
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

describe('MultiHostSetupPage', () => {
  it('creates the batch, stores each secret and goes to the dashboard', async () => {
    api.createRoomBatch.mockResolvedValue({ rooms: [created(A, 'secret-a'), created(B, 'secret-b'), created(C, 'secret-c')] });
    const user = userEvent.setup();
    renderAt('/multihost/new');

    const count = await screen.findByLabelText('Number of games');
    await waitFor(() => expect(count).toHaveValue(TEST_LIMITS.min_batch_rooms));
    await user.clear(count);
    await user.type(count, '3');

    await user.click(screen.getByRole('combobox', { name: 'Preset' }));
    await user.click(await screen.findByRole('option', { name: 'Fast Game' }));
    expect(screen.getByText('20 weeks. Tight.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Name to host as'), 'Ms Frizzle');
    await user.click(screen.getByRole('button', { name: 'Create 3 games' }));

    await waitFor(() => expect(api.createRoomBatch).toHaveBeenCalledTimes(1));
    expect(api.createRoomBatch).toHaveBeenCalledWith({
      count: 3,
      preset: 'FAST_GAME',
      host_display_name: 'Ms Frizzle',
    });

    expect(await screen.findByRole('heading', { name: 'Your games' })).toBeInTheDocument();
    expect(getHostSecret(A)).toBe('secret-a');
    expect(getHostSecret(B)).toBe('secret-b');
    expect(getHostSecret(C)).toBe('secret-c');
    expect(getHostBatch()).toEqual([A, B, C]);
    expect(getDisplayName()).toBe('Ms Frizzle');
  });

  it('sends no preset for the default settings', async () => {
    api.createRoomBatch.mockResolvedValue({ rooms: [created(A, 'a'), created(B, 'b')] });
    const user = userEvent.setup();
    renderAt('/multihost/new');

    await user.click(await screen.findByRole('button', { name: 'Create 2 games' }));
    await waitFor(() => expect(api.createRoomBatch).toHaveBeenCalled());
    expect(api.createRoomBatch.mock.calls[0][0]).toMatchObject({ count: 2, preset: null, host_display_name: 'Host' });
  });

  it("refuses a count outside the server's range rather than clamping it", async () => {
    const user = userEvent.setup();
    renderAt('/multihost/new');

    const count = await screen.findByLabelText('Number of games');
    await waitFor(() => expect(count).toBeEnabled());
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

  it("shows the server's refusal and stores nothing", async () => {
    api.createRoomBatch.mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { detail: 'Unknown preset.' } },
    });
    const user = userEvent.setup();
    renderAt('/multihost/new');

    await user.click(await screen.findByRole('button', { name: 'Create 2 games' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Unknown preset.');
    expect(getHostBatch()).toBeNull();
  });

  it('stores nothing when a room comes back without a secret', async () => {
    api.createRoomBatch.mockResolvedValue({ rooms: [created(A, 'secret-a'), created(B, '')] });
    const user = userEvent.setup();
    renderAt('/multihost/new');

    await user.click(await screen.findByRole('button', { name: 'Create 2 games' }));

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
