/**
 * `20-frontend-host-console.md §2.2` — `HostControls`, the five privileged
 * actions and their confirmation dialogs.
 *
 * Covers acceptance criteria 6, 7, 8, 9, 10, 11 and 12, and failure modes 3, 4
 * and 6 (the "what it emits" half; the "it renders" half is in
 * `HostConsole.test.tsx`).
 *
 * Harness notes:
 *  - The controls are reached through `HostConsole`, which is what `§2.0`
 *    freezes: it takes no props, and `HostControls`' own props are not
 *    declared anywhere, so a test that constructed it directly would be
 *    guessing at a surface the section never froze.
 *  - `socket.io-client` is replaced by a recorder, so `src/api/socket.ts`,
 *    `src/api/socketHandlers.ts` and `src/api/games.ts` run as real,
 *    un-mocked code. Emits are read back as the wire payloads `12 §2`
 *    declares.
 *  - `window.confirm` is deliberately left alone and asserted never to be
 *    called: `§2.2` makes the confirmation rendered DOM.
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
  RoomState,
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
// Fixtures
// ---------------------------------------------------------------------------

const ROOM = 'HST742';
const SECRET = 'host-secret-fixture';

const WEEK = 17;
const DURATION = 24;
const DEMAND_SERIES: number[] = Array.from({ length: DURATION }, (_, i) => 1001 + i);

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

function hostView(
  over: Partial<HostView> = {},
  roleOver: Partial<Record<Role, Partial<HostRoleView>>> = {},
): HostView {
  return {
    week: WEEK,
    duration_weeks: DURATION,
    phase: 'DECISION',
    currency_symbol: '$',
    demand_series: [...DEMAND_SERIES],
    awaiting_roles: [...AWAITED],
    chain_total_cost: 999.5,
    roles: {
      RETAILER: hostRole('RETAILER', roleOver.RETAILER),
      WHOLESALER: hostRole('WHOLESALER', roleOver.WHOLESALER),
      DISTRIBUTOR: hostRole('DISTRIBUTOR', roleOver.DISTRIBUTOR),
      FACTORY: hostRole('FACTORY', roleOver.FACTORY),
    },
    ...over,
  };
}

function participantsFor(overrides: Partial<Record<Role, Partial<Participant>>> = {}): Participant[] {
  return ROLE_ORDER.map((role) => ({
    alias: ALIASES[role] as string,
    display_name: NAMES[role],
    role,
    is_bot: false,
    connected: true,
    is_host: false,
    ...overrides[role],
  }));
}

function lobbyUpdate(state: RoomState, participants: Participant[]): Omit<LobbyUpdatePayload, 'seq'> {
  return {
    state,
    host_display_name: 'Professor',
    participants,
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

function renderConsole() {
  return render(
    <MemoryRouter initialEntries={[`/host/${ROOM}`]}>
      <Routes>
        <Route path="/host/:roomCode" element={<HostConsole />} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderAt(
  state: RoomState,
  view: HostView = hostView(),
  participants: Participant[] = participantsFor(),
) {
  act(() => {
    useGameStore.getState().setRoomCode(ROOM);
    useGameStore.getState().setIsHost(true);
  });
  dispatch('lobby_update', { seq: nextSeq(), ...lobbyUpdate(state, participants) });
  dispatch('host_state', { seq: nextSeq(), ...view });
  if (state === 'PAUSED') {
    dispatch('game_paused', { seq: nextSeq(), reason: 'Distributor (Cleo) disconnected' });
  }
  return renderConsole();
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

function numbersIn(text: string): number[] {
  const found = text.match(/(?<![A-Za-z0-9.])-?\d[\d,]*(?:\.\d+)?/g) ?? [];
  return found.map((raw) => Number(raw.replace(/,/g, ''))).filter((n) => Number.isFinite(n));
}

function hasNumber(text: string, value: number): boolean {
  return numbersIn(text).some((n) => n === value);
}

const CONTROL_SELECTOR = 'button, [role="button"], input[type="button"], input[type="submit"], a[href]';

function nameOf(el: HTMLElement): string {
  const own = textOf(el);
  if (own) return own;
  return norm(el.getAttribute('aria-label') ?? el.getAttribute('title') ?? '');
}

function controlsIn(root: ParentNode, re: RegExp): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(CONTROL_SELECTOR)).filter((el) =>
    re.test(nameOf(el)),
  );
}

function control(re: RegExp, what: string, root: ParentNode = document.body): HTMLElement {
  const matches = controlsIn(root, re).sort((a, b) => nameOf(a).length - nameOf(b).length);
  if (matches.length === 0) {
    throw new Error(`20 §2.2: no control named "${what}" (${re}). The console rendered: ${bodyText()}`);
  }
  return matches[0];
}

function maybeControl(re: RegExp, root: ParentNode = document.body): HTMLElement | null {
  const matches = controlsIn(root, re).sort((a, b) => nameOf(a).length - nameOf(b).length);
  return matches[0] ?? null;
}

function isEnabled(el: HTMLElement | null): boolean {
  if (!el) return false;
  if (el.hasAttribute('disabled')) return false;
  if (el.getAttribute('aria-disabled') === 'true') return false;
  return true;
}

function roleCard(role: Role): HTMLElement {
  const numbers = ROLE_NUMBERS[role];
  const wanted = [numbers.inventory, numbers.backlog, numbers.last_order as number, numbers.accumulated_cost];
  const found = Array.from(document.body.querySelectorAll<HTMLElement>('*'))
    .filter((el) => {
      const text = textOf(el);
      return new RegExp(role, 'i').test(text) && wanted.every((value) => hasNumber(text, value));
    })
    .sort((a, b) => textOf(a).length - textOf(b).length)[0];
  if (!found) {
    throw new Error(`20 §2.1: no card for ${role}. The console rendered: ${bodyText()}`);
  }
  return found;
}

/** `§2.2`: a modal with `role="dialog"` and `aria-modal="true"`. */
function dialog(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]');
  if (!found) {
    throw new Error(
      '20 §2.2: the confirmation must be rendered DOM — "a modal with role=\\"dialog\\", ' +
        'aria-modal=\\"true\\", an accessible name, a confirm and a cancel" — never ' +
        `window.confirm. Nothing with role="dialog" was rendered. Body: ${bodyText()}`,
    );
  }
  return found;
}

function noDialog(): boolean {
  return document.querySelector('[role="dialog"], [role="alertdialog"]') === null;
}

const CANCEL_RE = /cancel|never mind|not now|go back|keep playing|no,/i;

function cancelButton(): HTMLElement {
  return control(CANCEL_RE, 'the dialog’s cancel', dialog());
}

/** The dialog's affirmative button: the one that is not the cancel. */
function confirmButton(): HTMLElement {
  const candidates = Array.from(dialog().querySelectorAll<HTMLElement>(CONTROL_SELECTOR)).filter(
    (el) => nameOf(el) !== '' && !CANCEL_RE.test(nameOf(el)) && !/^(close|×|x)$/i.test(nameOf(el)),
  );
  if (candidates.length === 0) {
    throw new Error(`20 §2.2: the confirmation dialog must offer a confirm. It rendered: ${textOf(dialog())}`);
  }
  return candidates[candidates.length - 1];
}

function emitsOf(event: string): Array<Record<string, unknown>> {
  return rec.emits.filter((e) => e.event === event).map((e) => (e.payload ?? {}) as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** `§2.2`: "The confirmation is rendered DOM, never `window.confirm`." */
let nativeConfirmCalls = 0;

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
  nativeConfirmCalls = 0;
  vi.spyOn(window, 'confirm').mockImplementation(() => {
    nativeConfirmCalls += 1;
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  act(() => {
    useGameStore.getState().reset();
  });
});

// ---------------------------------------------------------------------------
// Criterion 7 — Pause when running, Resume when paused
// ---------------------------------------------------------------------------

describe('CRITERION 7: Pause is enabled only when running, Resume only when paused', () => {
  it('offers an enabled Pause and no enabled Resume while RUNNING', () => {
    renderAt('RUNNING');

    expect(isEnabled(control(/^pause$|pause the game|pause/i, 'Pause'))).toBe(true);
    expect(isEnabled(maybeControl(/^resume$|resume the game|resume/i))).toBe(false);
  });

  it('offers an enabled Resume and no enabled Pause while PAUSED', () => {
    renderAt('PAUSED');

    expect(isEnabled(control(/^resume$|resume the game|resume/i, 'Resume'))).toBe(true);
    expect(isEnabled(maybeControl(/^pause$|pause the game|\bpause\b/i))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Criterion 6 — every control emits its event with the stored host_secret
// ---------------------------------------------------------------------------

describe('CRITERION 6: every control emits its event carrying the stored host_secret', () => {
  it('Pause emits pause_game', async () => {
    const user = userEvent.setup();
    renderAt('RUNNING');

    await user.click(control(/^pause$|pause the game|pause/i, 'Pause'));

    expect(emitsOf('pause_game')).toEqual([{ room_id: ROOM, host_secret: SECRET }]);
  });

  it('Resume emits resume_game', async () => {
    const user = userEvent.setup();
    renderAt('PAUSED');

    await user.click(control(/^resume$|resume the game|resume/i, 'Resume'));

    expect(emitsOf('resume_game')).toEqual([{ room_id: ROOM, host_secret: SECRET }]);
  });

  it('Close this week now emits force_close_week once confirmed', async () => {
    const user = userEvent.setup();
    renderAt('RUNNING');

    await user.click(control(/close this week/i, 'Close this week now'));
    await user.click(confirmButton());

    expect(emitsOf('force_close_week')).toEqual([{ room_id: ROOM, host_secret: SECRET }]);
  });

  it('Swap in a bot emits substitute_bot for that role once confirmed', async () => {
    const user = userEvent.setup();
    renderAt('RUNNING');

    await user.click(control(/swap in a bot|swap.*bot/i, 'Swap in a bot', roleCard('DISTRIBUTOR')));
    await user.click(confirmButton());

    expect(emitsOf('substitute_bot')).toEqual([
      { room_id: ROOM, host_secret: SECRET, role: 'DISTRIBUTOR' },
    ]);
  });

  it('End the game now emits end_game_early once confirmed', async () => {
    const user = userEvent.setup();
    renderAt('RUNNING');

    await user.click(control(/end the game now|end the game|end game/i, 'End the game now'));
    await user.click(confirmButton());

    expect(emitsOf('end_game_early')).toEqual([{ room_id: ROOM, host_secret: SECRET }]);
  });

  it('never puts a client-side host claim on the wire (D3)', async () => {
    const user = userEvent.setup();
    renderAt('RUNNING');

    await user.click(control(/^pause$|pause the game|pause/i, 'Pause'));

    for (const payload of emitsOf('pause_game')) {
      expect(Object.keys(payload).sort()).toEqual(['host_secret', 'room_id']);
    }
  });
});

// ---------------------------------------------------------------------------
// Criterion 8 — Close this week now, when everyone has decided
// ---------------------------------------------------------------------------

describe('CRITERION 8: Close this week now is disabled once all four roles have submitted', () => {
  it('is enabled while at least one role is awaited', () => {
    renderAt('RUNNING');

    expect(isEnabled(control(/close this week/i, 'Close this week now'))).toBe(true);
  });

  it('is disabled when awaiting_roles is empty', () => {
    const everyoneIn = hostView({ awaiting_roles: [] }, {
      RETAILER: { has_submitted: true },
      WHOLESALER: { has_submitted: true },
      DISTRIBUTOR: { has_submitted: true },
      FACTORY: { has_submitted: true },
    });
    renderAt('RUNNING', everyoneIn);

    expect(isEnabled(control(/close this week/i, 'Close this week now'))).toBe(false);
  });

  it('is not enabled while the game is paused', () => {
    renderAt('PAUSED');

    expect(isEnabled(maybeControl(/close this week/i))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Criteria 9 and 12, and failure mode 4 — what the confirmations say
// ---------------------------------------------------------------------------

describe('CRITERION 9 / FAILURE MODE 4: the force-close confirmation names the awaited roles', () => {
  it('names Distributor and Factory, and not the two who have decided', async () => {
    const user = userEvent.setup();
    renderAt('RUNNING');

    await user.click(control(/close this week/i, 'Close this week now'));

    const text = textOf(dialog());
    expect(text).toMatch(/distributor/i);
    expect(text).toMatch(/factory/i);
    expect(text).not.toMatch(/retailer/i);
    expect(text).not.toMatch(/wholesaler/i);
  });

  it('does not fall back to a generic "some players"', async () => {
    const user = userEvent.setup();
    renderAt('RUNNING');

    await user.click(control(/close this week/i, 'Close this week now'));

    const text = textOf(dialog());
    expect(text).not.toMatch(/some (players|roles|people)|everyone else|the remaining/i);
  });

  it('states the consequence: an order of 0, and no undo', async () => {
    const user = userEvent.setup();
    renderAt('RUNNING');

    await user.click(control(/close this week/i, 'Close this week now'));

    const text = textOf(dialog());
    expect(text).toMatch(/(?<![A-Za-z0-9.])0(?![\d.])/);
    expect(text).toMatch(/can.?t be undone|cannot be undone/i);
  });

  it('names only the role still awaited when just one is', async () => {
    const user = userEvent.setup();
    const oneLeft = hostView({ awaiting_roles: ['FACTORY'] }, {
      DISTRIBUTOR: { has_submitted: true },
    });
    renderAt('RUNNING', oneLeft);

    await user.click(control(/close this week/i, 'Close this week now'));

    const text = textOf(dialog());
    expect(text).toMatch(/factory/i);
    expect(text).not.toMatch(/distributor/i);
  });
});

describe('CRITERION 12: the end-the-game confirmation names the current week', () => {
  it('states the week the game would end at', async () => {
    const user = userEvent.setup();
    renderAt('RUNNING');

    await user.click(control(/end the game now|end the game|end game/i, 'End the game now'));

    const text = textOf(dialog());
    expect(hasNumber(text, WEEK)).toBe(true);
    expect(text).toMatch(new RegExp(`week\\s*${WEEK}`, 'i'));
  });

  it('promises full results for the weeks played', async () => {
    const user = userEvent.setup();
    renderAt('RUNNING');

    await user.click(control(/end the game now|end the game|end game/i, 'End the game now'));

    expect(textOf(dialog())).toMatch(/results/i);
  });
});

// ---------------------------------------------------------------------------
// Criteria 10 and 11 — Swap in a bot
// ---------------------------------------------------------------------------

describe('CRITERION 10: the swap confirmation names the player and says it cannot be undone', () => {
  it('names the player in that seat', async () => {
    const user = userEvent.setup();
    renderAt('RUNNING');

    await user.click(control(/swap in a bot|swap.*bot/i, 'Swap in a bot', roleCard('WHOLESALER')));

    const text = textOf(dialog());
    expect(text).toContain(NAMES.WHOLESALER);
    expect(text).not.toContain(NAMES.RETAILER);
  });

  it('states that they keep their seat but will not decide again, and that it cannot be undone', async () => {
    const user = userEvent.setup();
    renderAt('RUNNING');

    await user.click(control(/swap in a bot|swap.*bot/i, 'Swap in a bot', roleCard('WHOLESALER')));

    const text = textOf(dialog());
    expect(text).toMatch(/can.?t be undone|cannot be undone/i);
    expect(text).toMatch(/automated|bot/i);
  });
});

describe('CRITERION 11: Swap in a bot is disabled for a role that is already a bot', () => {
  it('is disabled on the Factory card when host_state says it is a bot', () => {
    renderAt(
      'RUNNING',
      hostView({}, { FACTORY: { is_bot: true } }),
      participantsFor({ FACTORY: { is_bot: true } }),
    );

    expect(isEnabled(maybeControl(/swap in a bot|swap.*bot/i, roleCard('FACTORY')))).toBe(false);
  });

  it('stays enabled on the human cards', () => {
    renderAt(
      'RUNNING',
      hostView({}, { FACTORY: { is_bot: true } }),
      participantsFor({ FACTORY: { is_bot: true } }),
    );

    for (const role of ['RETAILER', 'WHOLESALER', 'DISTRIBUTOR'] as Role[]) {
      expect(isEnabled(control(/swap in a bot|swap.*bot/i, 'Swap in a bot', roleCard(role)))).toBe(true);
    }
  });

  it('is available while paused, per §2.2', () => {
    renderAt('PAUSED');

    expect(isEnabled(control(/swap in a bot|swap.*bot/i, 'Swap in a bot', roleCard('DISTRIBUTOR')))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Failure mode 3 — nothing destructive happens without a confirmation
// ---------------------------------------------------------------------------

describe('FAILURE MODE 3: force_close_week, substitute_bot and end_game_early emit only after the confirmation is accepted', () => {
  const destructive: Array<[string, string, (root: ParentNode) => HTMLElement]> = [
    ['force_close_week', 'Close this week now', () => control(/close this week/i, 'Close this week now')],
    [
      'substitute_bot',
      'Swap in a bot',
      () => control(/swap in a bot|swap.*bot/i, 'Swap in a bot', roleCard('DISTRIBUTOR')),
    ],
    [
      'end_game_early',
      'End the game now',
      () => control(/end the game now|end the game|end game/i, 'End the game now'),
    ],
  ];

  it.each(destructive)('%s emits nothing until the dialog is confirmed', async (event, _what, find) => {
    const user = userEvent.setup();
    renderAt('RUNNING');

    await user.click(find(document.body));
    expect(emitsOf(event)).toHaveLength(0);

    await user.click(cancelButton());
    expect(emitsOf(event)).toHaveLength(0);
    expect(noDialog()).toBe(true);

    await user.click(find(document.body));
    await user.click(confirmButton());
    expect(emitsOf(event)).toHaveLength(1);
  });

  it.each(destructive)('%s emits nothing when the dialog is dismissed with Escape', async (event, _what, find) => {
    const user = userEvent.setup();
    renderAt('RUNNING');

    await user.click(find(document.body));
    await user.keyboard('{Escape}');

    expect(emitsOf(event)).toHaveLength(0);
    expect(noDialog()).toBe(true);
  });

  it('never uses window.confirm — the warning is rendered DOM (§2.2)', async () => {
    const user = userEvent.setup();
    renderAt('RUNNING');

    await user.click(control(/end the game now|end the game|end game/i, 'End the game now'));

    expect(nativeConfirmCalls).toBe(0);
    expect(dialog().getAttribute('aria-modal')).toBe('true');
  });

  it('gives the dialog an accessible name, a confirm and a cancel, and moves focus into it', async () => {
    const user = userEvent.setup();
    renderAt('RUNNING');

    const trigger = control(/end the game now|end the game|end game/i, 'End the game now');
    await user.click(trigger);

    const modal = dialog();
    const labelledBy = modal.getAttribute('aria-labelledby');
    const named =
      norm(modal.getAttribute('aria-label') ?? '') !== '' ||
      (labelledBy !== null && norm(textOf(document.getElementById(labelledBy))) !== '');
    expect(named).toBe(true);

    expect(cancelButton()).toBeTruthy();
    expect(confirmButton()).toBeTruthy();
    expect(modal.contains(document.activeElement)).toBe(true);

    await user.click(cancelButton());
    expect(document.activeElement).toBe(trigger);
  });
});

// ---------------------------------------------------------------------------
// Failure mode 6 — authority, not a local host guess (D18)
// ---------------------------------------------------------------------------

describe('FAILURE MODE 6: the controls are present without a secret, but never emit without authority', () => {
  it('renders the controls with no host_secret in storage', () => {
    window.sessionStorage.clear();
    renderAt('RUNNING');

    expect(isEnabled(control(/^pause$|pause the game|pause/i, 'Pause'))).toBe(true);
    expect(control(/end the game now|end the game|end game/i, 'End the game now')).toBeTruthy();
  });

  it('emits nothing while the server has not answered with a secret', async () => {
    window.sessionStorage.clear();
    const user = userEvent.setup();
    renderAt('RUNNING');

    await user.click(control(/^pause$|pause the game|pause/i, 'Pause'));

    // `§2.2`: every control carries the stored `host_secret`. There is none
    // yet, and "an emit with no authority at all" is what must not happen.
    expect(rec.emits.filter((e) => e.event === 'pause_game')).toHaveLength(0);
  });

  it('emits with the secret as soon as host_claimed re-arms the tab (D18)', async () => {
    window.sessionStorage.clear();
    const user = userEvent.setup();
    renderAt('RUNNING');

    dispatch('host_claimed', { room_id: ROOM, host_secret: 'reissued-secret' });
    await user.click(control(/^pause$|pause the game|pause/i, 'Pause'));

    expect(emitsOf('pause_game')).toEqual([{ room_id: ROOM, host_secret: 'reissued-secret' }]);
  });

  it('carries whatever secret storage holds, never a hard-coded or stale one', async () => {
    window.sessionStorage.clear();
    setHostSecret(ROOM, 'a-different-secret');
    const user = userEvent.setup();
    renderAt('RUNNING');

    await user.click(control(/^pause$|pause the game|pause/i, 'Pause'));

    expect(emitsOf('pause_game')).toEqual([{ room_id: ROOM, host_secret: 'a-different-secret' }]);
  });
});
