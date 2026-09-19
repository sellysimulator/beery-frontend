/**
 * `18-frontend-host-config.md` — the host configuration panel.
 *
 * Covers acceptance criteria 1, 2, 3, 4, 5, 6, 12, 13, 14, 15, 16, 17, 18 and
 * 19, and failure modes 1, 3, 4, 5, 6, 7 and 8. Acceptance criteria 7 to 11 and
 * failure modes 2, 9 and 10 live in `DemandEditor.test.tsx`; the Zod ranges of
 * `§3.2` live in `configSchema.test.ts`.
 *
 * Harness notes
 * -------------
 * `socket.io-client` is replaced by a recorder, exactly as `LobbyHost.test.tsx`
 * does, so every `config_update` this panel sends is inspected as it goes on the
 * wire (`11 §2` freezes the event name and its `{room_id, host_secret, config}`
 * payload). `src/api/http.ts`'s axios instance is replaced the same way, so the
 * `PUT /rooms/{code}/config` fallback of `§3.1` is inspected as a request rather
 * than as a call into section 10's client — which is what lets this file stay
 * black-box about whichever helper the panel routes through.
 *
 * `errorMessage` is deliberately **not** stubbed: failure mode 8 is the claim
 * that a real FastAPI 422 body renders as a string, and a stubbed formatter
 * would make that unfalsifiable.
 *
 * The store is driven through section 16's declared appliers
 * (`applyConfigUpdated`, `applyLobbyUpdate`) rather than through the wire, since
 * `16 §3` makes the store the single source of truth and `§3.0` of this section
 * makes it the thing every input renders from.
 *
 * Locating controls
 * -----------------
 * This section freezes exactly one DOM handle — `data-testid="demand-preview"`
 * and its `data-series` (`§2.6`). It has no equivalent of `17 §2.4b`'s frozen
 * accessible names, so `field()` below accepts any of the conventional handles
 * (a form control `name` carrying the wire path from `03 §2`, `data-field`,
 * `data-testid`, `id`, or an accessible name containing the field's own
 * vocabulary). That breadth is a harness accommodation for a gap in the
 * document, not an assertion about the implementation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { ConfigPanel } from '../components/config/ConfigPanel';
import { useGameStore } from '../store/gameStore';
import { setHostRoom, setHostSecret } from '../utils/storage';
import type {
  FactoryConfig,
  GameConfig,
  Role,
  RoleConfig,
  RoomState,
  VisibilityConfig,
} from '../types/game';

// ---------------------------------------------------------------------------
// Wire recorders
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

/** What the fake backend answers with, per test. */
const rest = vi.hoisted(() => ({
  presets: null as unknown,
  configResponse: null as unknown,
  putRejection: null as unknown,
}));

const httpRec = vi.hoisted(() => {
  const get = async (url: string) => {
    if (/presets/.test(url)) return { data: rest.presets ?? { presets: [] } };
    return { data: rest.configResponse ?? {} };
  };
  const put = async (...args: unknown[]) => {
    void args;
    if (rest.putRejection) throw rest.putRejection;
    return { data: rest.configResponse ?? {} };
  };
  const post = async (...args: unknown[]) => {
    void args;
    return { data: {} };
  };
  return {
    get: vi.fn(get),
    put: vi.fn(put),
    post: vi.fn(post),
    patch: vi.fn(put),
    delete: vi.fn(async () => ({ data: {} })),
    defaults: { baseURL: '/api/v1', headers: { common: {} } },
    interceptors: {
      request: { use: vi.fn(), eject: vi.fn() },
      response: { use: vi.fn(), eject: vi.fn() },
    },
  };
});

vi.mock('../api/http', async (importOriginal) => {
  const actual = (await importOriginal()) as Json;
  return { ...actual, default: httpRec, http: httpRec };
});

vi.mock('../api/health', () => ({ checkHealth: vi.fn(async () => true) }));

// ---------------------------------------------------------------------------
// Fixtures — `03-game-config.md §2`'s declared defaults
// ---------------------------------------------------------------------------

const ROOM = 'ABC234';
const HOST_SECRET = 'hs-test';

function roleDefaults(over: Partial<RoleConfig> = {}): RoleConfig {
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
    ...over,
  };
}

function factoryDefaults(over: Partial<FactoryConfig> = {}): FactoryConfig {
  return {
    ...roleDefaults(),
    production_delay_weeks: 2,
    production_capacity_per_week: null,
    ...over,
  };
}

function visibilityDefaults(over: Partial<VisibilityConfig> = {}): VisibilityConfig {
  return {
    show_true_customer_demand_to_all: false,
    show_neighbour_inventory: false,
    show_all_inventories: false,
    show_supply_line_prominently: true,
    show_running_cost_to_players: true,
    show_leaderboard_during_game: false,
    max_order_quantity: null,
    allow_negative_orders: false,
    ...over,
  };
}

function baseConfig(over: Partial<GameConfig> = {}): GameConfig {
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
      RETAILER: roleDefaults(),
      WHOLESALER: roleDefaults(),
      DISTRIBUTOR: roleDefaults(),
      FACTORY: factoryDefaults(),
    },
    demand: { kind: 'STEP', initial_value: 4, step_week: 5, step_value: 8 },
    visibility: visibilityDefaults(),
    bot: { theta: 0.25, alpha: 0.3, beta: 0.25, target_stock_multiplier: 3.0 },
    ...over,
  };
}

/** `10 §2`'s `PresetListResponse`. The card copy is `18 §2`'s table. */
const PRESETS = {
  presets: [
    {
      name: 'CLASSIC_MIT',
      label: 'Classic MIT',
      description:
        '36 weeks, 2-week delays, demand steps from 4 to 8 at week 5. The standard ' +
        'scenario, and the one that produces the textbook result.',
      config: baseConfig({ preset_name: 'CLASSIC_MIT', duration_weeks: 36 }),
    },
    {
      name: 'FAST_GAME',
      label: 'Fast Game',
      description: 'The same scenario over 20 weeks, for a tight schedule.',
      config: baseConfig({ preset_name: 'FAST_GAME', duration_weeks: 20 }),
    },
    {
      name: 'CHAOS',
      label: 'Chaos',
      description:
        'Long delays, random demand, no supply-line prompt. Expect spectacular ' +
        'failure, which is the point.',
      config: baseConfig({
        preset_name: 'CHAOS',
        duration_weeks: 48,
        visibility: visibilityDefaults({ show_supply_line_prominently: false }),
        demand: { kind: 'STOCHASTIC', distribution: 'NORMAL', mean: 8, stdev: 2, min: 0, max: 20 },
      }),
    },
  ],
};

const EMPTY_ROLE_TO_ALIAS: Record<Role, string | null> = {
  RETAILER: null,
  WHOLESALER: null,
  DISTRIBUTOR: null,
  FACTORY: null,
};

// ---------------------------------------------------------------------------
// Store driving — section 16's declared appliers only
// ---------------------------------------------------------------------------

let seq = 0;
const nextSeq = () => ++seq;

function store() {
  return useGameStore.getState();
}

function applyConfig(config: GameConfig): void {
  act(() => {
    store().applyConfigUpdated({ seq: nextSeq(), config });
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
      config_locked: ['RUNNING', 'PAUSED', 'FINISHED'].includes(state),
      can_start: false,
      start_blocked_reason: 'Four roles are still empty. Assign them, or turn on bot fill.',
    });
  });
}

async function mountPanel(
  opts: { config?: GameConfig; state?: RoomState; connected?: boolean } = {},
): Promise<ReturnType<typeof userEvent.setup>> {
  if (rec.socket) rec.socket.connected = opts.connected ?? true;
  store().setRoomCode(ROOM);
  store().setIsHost(true);
  setHostSecret(ROOM, HOST_SECRET);
  setHostRoom(ROOM);
  applyLobby(opts.state ?? 'CONFIGURING');
  applyConfig(opts.config ?? baseConfig());

  const user = userEvent.setup({ delay: null });
  render(
    <MemoryRouter initialEntries={[`/host/${ROOM}`]}>
      <ConfigPanel />
    </MemoryRouter>,
  );
  // Flush the presets fetch and any other mount effect.
  await act(async () => {
    await Promise.resolve();
  });
  return user;
}

// ---------------------------------------------------------------------------
// Reading the wire
// ---------------------------------------------------------------------------

function socketSaves(): Json[] {
  return rec.emits
    .filter((e) => e.event === 'config_update')
    .map((e) => (e.payload ?? {}) as Json);
}

function restSaves(): Json[] {
  return httpRec.put.mock.calls
    .filter((c) => /\/rooms\/.+\/config$/.test(String(c[0])))
    .map((c) => (c[1] ?? {}) as Json);
}

/** Every config the panel has tried to save, by either channel, in order. */
function savedConfigs(): Json[] {
  const fromSocket = socketSaves().map((p) => p.config as Json);
  const fromRest = restSaves().map((b) => b.config as Json);
  return [...fromSocket, ...fromRest].filter((c): c is Json => !!c && typeof c === 'object');
}

function lastSavedConfig(): Json {
  const all = savedConfigs();
  expect(all.length, 'the panel saved nothing').toBeGreaterThan(0);
  return all[all.length - 1];
}

function saveCount(): number {
  return socketSaves().length + restSaves().length;
}

async function waitForSave(previous = 0): Promise<void> {
  await waitFor(() => expect(saveCount()).toBeGreaterThan(previous), { timeout: 2000 });
}

function clearWire(): void {
  rec.emits.length = 0;
  httpRec.put.mockClear();
  httpRec.post.mockClear();
}

// ---------------------------------------------------------------------------
// Locating controls
// ---------------------------------------------------------------------------

const INTERACTIVE =
  'input, select, textarea, button, [role="switch"], [role="slider"], [role="checkbox"], ' +
  '[role="radio"], [role="combobox"], [role="spinbutton"], [contenteditable="true"]';

function controls(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(INTERACTIVE));
}

function textOf(el: Element | null): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function accessibleName(el: HTMLElement): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria;
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => textOf(document.getElementById(id)))
      .filter(Boolean);
    if (parts.length) return parts.join(' ');
  }
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label) return textOf(label);
  }
  const wrapping = el.closest('label');
  if (wrapping) return textOf(wrapping);
  return el.getAttribute('title') ?? el.getAttribute('placeholder') ?? textOf(el);
}

/** The vocabulary each field owns, for the accessible-name fallback. */
const WORDS: Record<string, RegExp> = {
  duration_weeks: /(duration|number of weeks|weeks|length)/i,
  pause_on_disconnect: /(pause|disconnect)/i,
  bot_fill_empty_roles: /(bot).*(fill|empty)|(fill|empty).*(bot)/i,
  random_seed: /seed/i,
  initial_inventory: /initial inventory|starting inventory/i,
  initial_backlog: /initial backlog|starting backlog/i,
  shipping_delay_weeks: /shipping delay/i,
  information_delay_weeks: /information delay/i,
  initial_pipeline_quantity: /(pipeline quantity|in.transit)/i,
  initial_order_in_pipeline: /order in pipeline|initial order/i,
  holding_cost_per_unit_week: /holding cost/i,
  backlog_cost_per_unit_week: /backlog cost/i,
  fixed_order_cost: /fixed order cost/i,
  unit_purchase_cost: /(unit purchase|purchase cost)/i,
  starting_capital: /starting capital/i,
  production_delay_weeks: /production delay/i,
  production_capacity_per_week: /production capacity/i,
  show_true_customer_demand_to_all: /true customer demand/i,
  show_neighbour_inventory: /neighbour inventory|neighbor inventory/i,
  show_all_inventories: /all inventories/i,
  show_supply_line_prominently: /supply line/i,
  show_running_cost_to_players: /running cost/i,
  show_leaderboard_during_game: /leaderboard/i,
  max_order_quantity: /max(imum)? order/i,
  allow_negative_orders: /negative order/i,
  beta: /supply line|already ordered/i,
  theta: /(theta|smooth)/i,
  alpha: /(alpha|stock adjust)/i,
  target_stock_multiplier: /target stock/i,
};

const ROLE_WORD: Record<Role, RegExp> = {
  RETAILER: /retailer/i,
  WHOLESALER: /wholesaler/i,
  DISTRIBUTOR: /distributor/i,
  FACTORY: /factory/i,
};

function bySelector(scope: ParentNode, keys: string[]): HTMLElement | null {
  for (const key of keys) {
    const escaped = CSS.escape(key);
    const found = scope.querySelector<HTMLElement>(
      `[name="${escaped}"], [data-field="${escaped}"], [data-testid="${escaped}"], [id="${escaped}"]`,
    );
    if (found) return found;
  }
  return null;
}

function roleScope(role: Role): ParentNode | null {
  for (const sel of [
    `[data-role="${role}"]`,
    `[data-column="${role}"]`,
    `[data-testid="role-${role}"]`,
    `[data-testid="column-${role}"]`,
  ]) {
    const found = document.querySelector(sel);
    if (found) return found;
  }
  return null;
}

/**
 * A top-level (`duration_weeks`) or nested (`visibility.show_all_inventories`,
 * `roles.FACTORY.production_delay_weeks`) field, or null when it is absent.
 *
 * A role-scoped lookup never falls back to the un-scoped form, because failure
 * mode 5 and acceptance criteria 5 and 6 turn on one column not showing a field
 * that another column does show.
 */
function findField(path: string): HTMLElement | null {
  const segments = path.split('.');
  const leaf = segments[segments.length - 1];
  const role = segments[0] === 'roles' ? (segments[1] as Role) : null;

  const direct = bySelector(document, [path, ...(role ? [`${role}.${leaf}`] : [])]);
  if (direct) return direct;

  if (role) {
    const scope = roleScope(role);
    const scoped = scope ? bySelector(scope, [leaf, path, `${role}.${leaf}`]) : null;
    if (scoped) return scoped;
    const word = WORDS[leaf];
    if (!word) return null;
    return (
      controls().find((c) => {
        const name = accessibleName(c);
        return word.test(name) && ROLE_WORD[role].test(name);
      }) ?? null
    );
  }

  const flat = bySelector(document, [leaf]);
  if (flat) return flat;
  const word = WORDS[leaf];
  if (!word) return null;
  return controls().find((c) => word.test(accessibleName(c))) ?? null;
}

function field(path: string): HTMLElement {
  const found = findField(path);
  if (!found) {
    throw new Error(
      `No control for \`${path}\`. 18 §2 names the fields but freezes no accessible ` +
        'name or test id for them (contrast 17 §2.4b), so this harness accepts a `name`, ' +
        '`data-field`, `data-testid` or `id` carrying the wire path from 03 §2, or an ' +
        'accessible name containing the field\'s own words.',
    );
  }
  return found;
}

function inputValue(el: HTMLElement): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value;
  if (el instanceof HTMLSelectElement) return el.value;
  return el.getAttribute('aria-valuenow') ?? el.getAttribute('value') ?? textOf(el);
}

function bodyText(): string {
  return (document.body.textContent ?? '').replace(/\s+/g, ' ');
}

/** How this implementation expresses "this one is chosen", if it does at all. */
function selectionOf(el: HTMLElement): boolean | null {
  const host =
    el.closest('[aria-pressed],[aria-checked],[aria-current],[aria-selected],[data-selected],[data-state]') ??
    el;
  for (const attr of ['aria-pressed', 'aria-checked', 'aria-selected']) {
    const v = host.getAttribute(attr);
    if (v !== null) return v === 'true';
  }
  const current = host.getAttribute('aria-current');
  if (current !== null) return current !== 'false';
  const selected = host.getAttribute('data-selected');
  if (selected !== null) return selected !== 'false';
  const state = host.getAttribute('data-state');
  if (state !== null) return /^(on|active|checked|selected)$/i.test(state);
  if (host instanceof HTMLInputElement && (host.type === 'radio' || host.type === 'checkbox')) {
    return host.checked;
  }
  return null;
}

function clickable(label: RegExp, scope: HTMLElement = document.body): HTMLElement {
  const q = within(scope);
  for (const role of ['radio', 'button', 'tab', 'checkbox', 'link', 'option'] as const) {
    const found = q.queryAllByRole(role, { name: label }).at(0);
    if (found) return found;
  }
  const node = q.queryAllByText(label).at(0);
  const nearest = node?.closest(
    'button, a, label, [role="radio"], [role="button"], [role="tab"], [role="option"], li, article, section',
  );
  if (nearest) return nearest as HTMLElement;
  throw new Error(`No clickable element named ${label}.`);
}

/**
 * The presets section — the smallest element holding all three card labels.
 * Scoping matters because the demand generator picker also offers a *Custom*
 * choice, and acceptance criterion 3 is about the preset one.
 */
function presetRegion(): HTMLElement {
  const anchor = screen.queryAllByText(/Classic MIT/i).at(0);
  if (!anchor) throw new Error('No Classic MIT preset card (18 §2).');
  let node: HTMLElement | null = anchor as HTMLElement;
  while (node) {
    const text = textOf(node);
    if (/Classic MIT/i.test(text) && /Fast Game/i.test(text) && /Chaos/i.test(text)) return node;
    node = node.parentElement;
  }
  throw new Error('The three preset cards do not share a container (18 §2).');
}

/** The *Apply to all* control belonging to the section that holds `el`. */
function applyToAllFor(el: HTMLElement): HTMLElement {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const buttons = Array.from(node.querySelectorAll<HTMLElement>('button, [role="button"]')).filter(
      (b) => /\bapply\b[\s\S]*\bto all\b/i.test(accessibleName(b)),
    );
    if (buttons.length === 1) return buttons[0];
    if (buttons.length > 1) return buttons[0];
    node = node.parentElement;
  }
  throw new Error('No *Apply to all* control (18 §2, acceptance criterion 4).');
}

async function setNumber(user: ReturnType<typeof userEvent.setup>, el: HTMLElement, value: string) {
  await user.clear(el);
  await user.type(el, value);
  await user.tab(); // §3.1: save immediately on blur of a numeric input
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  seq = 0;
  rec.emits.length = 0;
  rec.listeners.clear();
  if (rec.socket) rec.socket.connected = true;
  rest.presets = PRESETS;
  rest.configResponse = null;
  rest.putRejection = null;
  store().reset();
});

// ---------------------------------------------------------------------------
// §2 — layout
// ---------------------------------------------------------------------------

describe('layout (§2)', () => {
  it('renders all six sections plus the conditional bot section [AC 1]', async () => {
    await mountPanel({ config: baseConfig({ bot_fill_empty_roles: true }) });

    const text = bodyText();
    for (const heading of [
      /presets/i,
      /length and pacing/i,
      /starting conditions/i,
      /costs/i,
      /customer demand/i,
      /visibility/i,
      /bot difficulty/i,
    ]) {
      expect(text, `section heading ${heading} is missing`).toMatch(heading);
    }
  });

  it('shows the four per-role columns [AC 1]', async () => {
    await mountPanel();
    const text = bodyText();
    expect(text).toMatch(/retailer/i);
    expect(text).toMatch(/wholesaler/i);
    expect(text).toMatch(/distributor/i);
    expect(text).toMatch(/factory/i);
  });
});

// ---------------------------------------------------------------------------
// §2 — presets
// ---------------------------------------------------------------------------

describe('preset cards (§2)', () => {
  it('populates every field and sets preset_name when a preset is chosen [AC 2]', async () => {
    const user = await mountPanel({ config: baseConfig({ duration_weeks: 36 }) });
    await waitFor(() => expect(bodyText()).toMatch(/Fast Game/i));
    clearWire();

    await user.click(clickable(/Fast Game/i));
    await waitForSave();

    const saved = lastSavedConfig();
    expect(saved.preset_name).toBe('FAST_GAME');
    expect(saved.duration_weeks).toBe(20);

    // The whole form follows the preset once the server has echoed it back.
    applyConfig(baseConfig({ preset_name: 'FAST_GAME', duration_weeks: 20 }));
    await waitFor(() => expect(inputValue(field('duration_weeks'))).toBe('20'));
  });

  it('renders each preset card with the copy the API supplies [AC 2]', async () => {
    await mountPanel();
    await waitFor(() => expect(bodyText()).toMatch(/Classic MIT/i));
    const text = bodyText();
    expect(text).toMatch(/Classic MIT/i);
    expect(text).toMatch(/Fast Game/i);
    expect(text).toMatch(/Chaos/i);
    expect(text).toMatch(/the one that produces the textbook result/i);
  });

  it('clears preset_name and switches to Custom once a field is edited [AC 3, FM 3]', async () => {
    const user = await mountPanel({ config: baseConfig({ preset_name: 'CLASSIC_MIT' }) });
    await waitFor(() => expect(bodyText()).toMatch(/Classic MIT/i));
    clearWire();

    await setNumber(user, field('duration_weeks'), '24');
    await waitForSave();

    const saved = lastSavedConfig();
    expect(saved.duration_weeks).toBe(24);
    expect(
      saved.preset_name,
      'a host must not believe they are running Classic MIT when they are not (§2)',
    ).toBeNull();

    // §3.0: the panel renders from the stored config, so the card follows the
    // server's echo of the cleared `preset_name`, not the keystroke.
    applyConfig(baseConfig({ preset_name: null, duration_weeks: 24 }));

    const presets = presetRegion();
    const classic = clickable(/Classic MIT/i, presets);
    const custom = clickable(/\bCustom\b/i, presets);
    const classicSelected = selectionOf(classic);
    const customSelected = selectionOf(custom);
    expect(
      classicSelected === null && customSelected === null,
      'no preset card expresses selection (aria-pressed / aria-checked / aria-current / ' +
        'data-selected); AC 3 requires the UI to switch to *Custom*',
    ).toBe(false);
    await waitFor(() => {
      expect(selectionOf(clickable(/Classic MIT/i, presetRegion()))).not.toBe(true);
      expect(selectionOf(clickable(/\bCustom\b/i, presetRegion()))).not.toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// §2 — per-role editors
// ---------------------------------------------------------------------------

describe('per-role editors (§2)', () => {
  it('copies the Retailer column into the other three on *Apply to all* [AC 4]', async () => {
    const user = await mountPanel();
    const retailerInventory = field('roles.RETAILER.initial_inventory');

    await setNumber(user, retailerInventory, '7');
    await waitForSave();
    applyConfig(
      baseConfig({
        roles: {
          RETAILER: roleDefaults({ initial_inventory: 7 }),
          WHOLESALER: roleDefaults(),
          DISTRIBUTOR: roleDefaults(),
          FACTORY: factoryDefaults(),
        },
      }),
    );
    clearWire();

    await user.click(applyToAllFor(field('roles.RETAILER.initial_inventory')));
    await waitForSave();

    const roles = lastSavedConfig().roles as Record<string, Json>;
    expect(roles, '*Apply to all* must write the other three role columns').toBeTruthy();
    for (const role of ['WHOLESALER', 'DISTRIBUTOR', 'FACTORY'] as const) {
      expect(roles[role], `${role} is missing from the payload`).toBeTruthy();
      expect(roles[role].initial_inventory).toBe(7);
    }
  });

  it('shows production fields and hides shipping_delay_weeks for the Factory [AC 5, FM 5]', async () => {
    await mountPanel();

    // The positive half keeps the negative half meaningful: if the harness could
    // not see the Factory column at all, the absence below would be vacuous.
    expect(findField('roles.FACTORY.production_delay_weeks')).not.toBeNull();
    expect(findField('roles.FACTORY.production_capacity_per_week')).not.toBeNull();
    expect(findField('roles.WHOLESALER.shipping_delay_weeks')).not.toBeNull();

    expect(
      findField('roles.FACTORY.shipping_delay_weeks'),
      'the Factory column must show production_delay_weeks in place of shipping_delay_weeks (§2)',
    ).toBeNull();
  });

  it('omits the Retailer information delay from the DOM entirely [AC 6, FM 5]', async () => {
    await mountPanel();

    expect(findField('roles.RETAILER.initial_inventory')).not.toBeNull();
    expect(findField('roles.WHOLESALER.information_delay_weeks')).not.toBeNull();

    const hidden = findField('roles.RETAILER.information_delay_weeks');
    expect(
      hidden,
      'the Retailer\'s information_delay_weeks is unused and must be absent, not disabled (§2)',
    ).toBeNull();
  });

  it('does not blank the other roles when one role field changes [FM 4]', async () => {
    const user = await mountPanel();
    clearWire();

    await setNumber(user, field('roles.RETAILER.holding_cost_per_unit_week'), '2');
    await waitForSave();

    const roles = (lastSavedConfig().roles ?? {}) as Record<string, Json | null>;
    for (const role of ['WHOLESALER', 'DISTRIBUTOR', 'FACTORY'] as const) {
      const sent = roles[role];
      if (sent === undefined) continue; // an omitted role is the deep-merge contract (§3.1a)
      expect(sent, `${role} was sent as null, which blanks it server-side`).not.toBeNull();
      expect(
        (sent as Json).holding_cost_per_unit_week,
        `${role}'s holding cost was blanked`,
      ).toBe(0.5);
    }

    // And after the round trip every other value is still on screen.
    applyConfig(
      baseConfig({
        roles: {
          RETAILER: roleDefaults({ holding_cost_per_unit_week: 2 }),
          WHOLESALER: roleDefaults(),
          DISTRIBUTOR: roleDefaults(),
          FACTORY: factoryDefaults(),
        },
      }),
    );
    await waitFor(() =>
      expect(inputValue(field('roles.WHOLESALER.holding_cost_per_unit_week'))).toMatch(/^0?\.5$/),
    );
    expect(inputValue(field('roles.DISTRIBUTOR.initial_inventory'))).toBe('12');
    expect(inputValue(field('roles.FACTORY.production_delay_weeks'))).toBe('2');
  });
});

// ---------------------------------------------------------------------------
// §3.0 / §3.1 — the save path and the clamp
// ---------------------------------------------------------------------------

describe('save path (§3.1)', () => {
  it('shows 104 after saving 500 weeks [AC 12, FM 1]', async () => {
    const user = await mountPanel();
    clearWire();

    await setNumber(user, field('duration_weeks'), '500');
    await waitForSave();
    expect(lastSavedConfig().duration_weeks).toBe(500);

    // The server clamps and answers with what it stored (§3.1a).
    applyConfig(baseConfig({ duration_weeks: 104 }));

    await waitFor(() =>
      expect(
        inputValue(field('duration_weeks')),
        'the field must render from the stored config, not from local form state (§3.0)',
      ).toBe('104'),
    );
  });

  it('notes the clamp inline [§3.1]', async () => {
    const user = await mountPanel();
    await setNumber(user, field('duration_weeks'), '500');
    await waitForSave();
    applyConfig(baseConfig({ duration_weeks: 104 }));

    await waitFor(() => expect(bodyText()).toMatch(/Maximum is 104 weeks\./i));
  });

  it('emits config_update over the socket when connected [AC 14]', async () => {
    const user = await mountPanel({ connected: true });
    clearWire();

    await setNumber(user, field('duration_weeks'), '24');
    await waitForSave();

    const emits = socketSaves();
    expect(emits.length).toBeGreaterThan(0);
    expect(emits[emits.length - 1].room_id).toBe(ROOM);
    expect(emits[emits.length - 1].host_secret).toBe(HOST_SECRET);
    expect(restSaves(), 'the REST route is a fallback, not a second channel').toHaveLength(0);
  });

  it('falls back to PUT /rooms/{code}/config when the socket is down [AC 14]', async () => {
    rest.configResponse = { room_code: ROOM, state: 'CONFIGURING', config: baseConfig({ duration_weeks: 24 }) };
    const user = await mountPanel({ connected: false });
    clearWire();

    await setNumber(user, field('duration_weeks'), '24');
    await waitForSave();

    expect(socketSaves(), 'nothing may go over a disconnected socket').toHaveLength(0);
    const calls = httpRec.put.mock.calls.filter((c) => /\/rooms\/.+\/config$/.test(String(c[0])));
    expect(calls.length).toBeGreaterThan(0);
    expect(String(calls[0][0])).toContain(ROOM);
    expect((calls[0][1] as Json).config).toMatchObject({ duration_weeks: 24 });
  });

  it('renders the clamped value the REST response carries [AC 12, AC 14]', async () => {
    rest.configResponse = {
      room_code: ROOM,
      state: 'CONFIGURING',
      config: baseConfig({ duration_weeks: 104 }),
    };
    const user = await mountPanel({ connected: false });

    await setNumber(user, field('duration_weeks'), '500');
    await waitForSave();

    await waitFor(() => expect(inputValue(field('duration_weeks'))).toBe('104'), { timeout: 2000 });
  });

  it('debounces typing into a numeric field [AC 15, FM 7]', async () => {
    const user = await mountPanel();
    clearWire();

    const seedField = field('random_seed');
    seedField.focus();
    await user.type(seedField, '1234567890');
    // Well past the 400 ms debounce window of §3.1.
    await new Promise((resolve) => setTimeout(resolve, 900));

    expect(
      saveCount(),
      'ten keystrokes inside one debounce window must not become ten saves',
    ).toBeLessThanOrEqual(2);
  });

  it('saves immediately when a switch is toggled [AC 15]', async () => {
    const user = await mountPanel();
    clearWire();

    await user.click(field('visibility.show_all_inventories'));
    await waitFor(() => expect(saveCount()).toBeGreaterThan(0), { timeout: 250 });
  });
});

// ---------------------------------------------------------------------------
// §3.2 — the 422
// ---------------------------------------------------------------------------

describe('server rejection (§3.2)', () => {
  it('renders a real FastAPI 422 as a string and highlights the field [AC 13, FM 8]', async () => {
    // The shape FastAPI actually returns: `detail` is an array of objects, not a
    // string. Rendering it directly throws `Objects are not valid as a React
    // child` (00-conventions §3).
    rest.putRejection = {
      isAxiosError: true,
      name: 'AxiosError',
      message: 'Request failed with status code 422',
      response: {
        status: 422,
        data: {
          detail: [
            {
              type: 'too_short',
              loc: ['body', 'config', 'duration_weeks'],
              msg: 'Input should be greater than or equal to 8',
              input: 2,
            },
          ],
        },
      },
    };

    const user = await mountPanel({ connected: false });
    await setNumber(user, field('duration_weeks'), '2');
    await waitForSave();

    await waitFor(() => {
      const text = bodyText();
      expect(text).not.toContain('[object Object]');
      expect(text).toMatch(/Input should be greater than or equal to 8|greater than or equal/i);
    });

    // The one observable, accessible expression of "highlighted".
    await waitFor(() =>
      expect(
        document.querySelector('[aria-invalid="true"]'),
        'the field named in `detail` must be marked invalid (§3.2)',
      ).not.toBeNull(),
    );
  });
});

// ---------------------------------------------------------------------------
// §3.3 — locked after start
// ---------------------------------------------------------------------------

describe('locked after start (§3.3)', () => {
  it('renders read-only with the locked banner while RUNNING [AC 16]', async () => {
    await mountPanel({ state: 'RUNNING' });

    expect(bodyText()).toMatch(
      /Settings are locked while the game is running\. To change them, end the game and create a new room\./i,
    );

    const editable = controls().filter((c) => {
      if (c instanceof HTMLInputElement || c instanceof HTMLTextAreaElement) {
        return !c.readOnly && !c.disabled;
      }
      if (c instanceof HTMLSelectElement) return !c.disabled;
      return false;
    });
    expect(
      editable.map((c) => accessibleName(c)),
      '§3.3 asks for a read-only summary, not merely disabled inputs',
    ).toHaveLength(0);
  });

  it('emits nothing for any interaction while RUNNING [FM 6]', async () => {
    const user = await mountPanel({ state: 'RUNNING' });
    clearWire();

    // The panel is on screen — this is an inert panel, not an empty tree.
    expect(bodyText()).toMatch(/Settings are locked while the game is running/i);

    for (const el of controls().slice(0, 40)) {
      await user.click(el).catch(() => undefined);
      if (el instanceof HTMLInputElement && !el.disabled && !el.readOnly) {
        fireEvent.change(el, { target: { value: '9' } });
        fireEvent.blur(el);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 700));

    expect(saveCount(), 'a locked panel must not save').toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §2 — visibility levers and the bot slider
// ---------------------------------------------------------------------------

describe('visibility levers (§2)', () => {
  it('renders every switch with its explanatory line [AC 17]', async () => {
    await mountPanel();
    const text = bodyText();

    for (const line of [
      /Run the same scenario a second time with this on, to show how much information sharing is worth\./i,
      /Full transparency across the chain\./i,
      // `.` where the copy carries an apostrophe or a dash, so a typographic
      // variant of the same sentence is not a failure.
      /Keep this on for beginners .+ it reminds players what they.ve ordered but not yet received\. Turn it off to make the game considerably harder\./i,
      /Competitive, but it can distort behaviour\./i,
      /Players see their own accumulated cost\./i,
      /Reveal the immediate neighbours. stock and backlog\./i,
    ]) {
      expect(text, `missing the explanation ${line}`).toMatch(line);
    }
  });
});

describe('bot difficulty (§2)', () => {
  it('renders bot.beta as a labelled slider from 0 to 1 [AC 18]', async () => {
    await mountPanel({ config: baseConfig({ bot_fill_empty_roles: true }) });

    const slider = screen.getByRole('slider', {
      name: /How much do bots account for what they.?ve already ordered\?/i,
    });
    expect(slider.getAttribute('min') ?? slider.getAttribute('aria-valuemin')).toBe('0');
    expect(slider.getAttribute('max') ?? slider.getAttribute('aria-valuemax')).toBe('1');
  });

  it('hides the bot section when bot fill is off and no bot is seated [§2]', async () => {
    await mountPanel({ config: baseConfig({ bot_fill_empty_roles: false }) });

    expect(
      screen.queryByRole('slider', { name: /How much do bots account for/i }),
      'the bot section is conditional on bot_fill_empty_roles (§2)',
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §3.4 — keyboard
// ---------------------------------------------------------------------------

describe('keyboard operation (§3.4)', () => {
  it('reaches every part of the form with Tab alone [AC 19]', async () => {
    const user = await mountPanel({ config: baseConfig({ bot_fill_empty_roles: true }) });

    const targets = new Map<string, HTMLElement>([
      ['duration_weeks', field('duration_weeks')],
      ['retailer inventory', field('roles.RETAILER.initial_inventory')],
      ['a visibility switch', field('visibility.show_all_inventories')],
      [
        'the bot slider',
        screen.getByRole('slider', { name: /How much do bots account for what they.?ve already ordered\?/i }),
      ],
    ]);

    // Nothing interactive may be taken out of the tab order.
    const removed = controls().filter((c) => c.getAttribute('tabindex') === '-1');
    expect(removed.map((c) => accessibleName(c)), 'controls removed from the tab order').toHaveLength(0);

    const wanted = new Set<Element>(targets.values());
    const reached = new Set<Element>();
    document.body.focus();
    for (let i = 0; i < 400 && reached.size < wanted.size; i += 1) {
      await user.tab();
      const active = document.activeElement;
      if (active && wanted.has(active)) reached.add(active);
      if (active === document.body) break;
    }

    for (const [label, el] of targets) {
      expect(reached.has(el), `Tab never reached ${label}`).toBe(true);
    }
  });

  it('toggles a switch from the keyboard and saves [AC 15, AC 19]', async () => {
    const user = await mountPanel();
    clearWire();

    const toggle = field('visibility.show_leaderboard_during_game');
    toggle.focus();
    await user.keyboard(' ');
    if (saveCount() === 0) await user.keyboard('{Enter}');

    await waitFor(() => expect(saveCount()).toBeGreaterThan(0), { timeout: 700 });
  });
});
