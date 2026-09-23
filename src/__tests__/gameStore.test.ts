/**
 * `useGameStore` from `src/store/gameStore.ts` (16 §3).
 *
 * §3 freezes the `GameState` field list, the initial value of every field, the
 * `Alert` shape and the whole `GameActions` interface, so this file drives the
 * store through its own actions and asserts the state contract directly.
 *
 * Covers acceptance criteria 11 and 12 at the store layer (`socketHandlers.test.ts`
 * covers them again through the wire), plus 00-conventions §2.5: the store holds
 * `myAlias` — never a `session_token`, a `host_secret` or an `identity`.
 *
 * Payload literals below are plain object literals on purpose: each applier's
 * parameter type is frozen, so `tsc -b` checks the fixture against the payload
 * type the implementation declares, field for field.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useGameStore } from '../store/gameStore';

const ROLES = ['RETAILER', 'WHOLESALER', 'DISTRIBUTOR', 'FACTORY'] as const;

const DECLARED_FIELDS = [
  // identity
  'roomCode',
  'myAlias',
  'myRole',
  'isHost',
  // lobby
  'roomState',
  'hostDisplayName',
  'participants',
  'roleToAlias',
  'roleAssignmentMode',
  'config',
  'canStart',
  'startBlockedReason',
  'joinError',
  // play
  'week',
  'durationWeeks',
  'lastSeq',
  'myState',
  'hostState',
  'awaitingRoles',
  'hasSubmitted',
  'paused',
  'pausedReason',
  // end
  'finished',
  // ui
  'alerts',
  'connectionError',
] as const;

const FORBIDDEN_SUBSTRINGS = ['session_token', 'sessionToken', 'host_secret', 'hostSecret', 'identity'];

/** The whole state as JSON, so "unchanged" can be asserted exactly. */
function snapshot(): string {
  return JSON.stringify(useGameStore.getState(), (_k, v) => (typeof v === 'function' ? undefined : v));
}

beforeEach(() => {
  useGameStore.getState().reset();
});

// ---------------------------------------------------------------------------
// The frozen state contract
// ---------------------------------------------------------------------------

describe('gameStore — the declared GameState surface', () => {
  it('exposes the zustand bound-store API', () => {
    expect(typeof useGameStore).toBe('function');
    expect(typeof useGameStore.getState).toBe('function');
    expect(typeof useGameStore.setState).toBe('function');
    expect(typeof useGameStore.subscribe).toBe('function');
  });

  it('carries every field §3 declares', () => {
    const state = useGameStore.getState() as unknown as Record<string, unknown>;
    for (const field of DECLARED_FIELDS) {
      expect(Object.prototype.hasOwnProperty.call(state, field)).toBe(true);
    }
  });

  it('starts in the frozen initial state', () => {
    const state = useGameStore.getState();

    // every nullable field is null
    expect(state.roomCode).toBeNull();
    expect(state.myAlias).toBeNull();
    expect(state.myRole).toBeNull();
    expect(state.roomState).toBeNull();
    expect(state.hostDisplayName).toBeNull();
    expect(state.roleAssignmentMode).toBeNull();
    expect(state.config).toBeNull();
    expect(state.startBlockedReason).toBeNull();
    expect(state.joinError).toBeNull();
    expect(state.week).toBeNull();
    expect(state.durationWeeks).toBeNull();
    expect(state.myState).toBeNull();
    expect(state.hostState).toBeNull();
    expect(state.pausedReason).toBeNull();
    expect(state.finished).toBeNull();
    expect(state.connectionError).toBeNull();

    // collections are empty
    expect(state.participants).toEqual([]);
    expect(state.awaitingRoles).toEqual([]);
    expect(state.alerts).toEqual([]);

    // flags are false, lastSeq is 0
    expect(state.isHost).toBe(false);
    expect(state.hasSubmitted).toBe(false);
    expect(state.paused).toBe(false);
    expect(state.canStart).toBe(false);
    expect(state.lastSeq).toBe(0);
  });

  it('starts with all four roles mapped to null in roleToAlias', () => {
    const { roleToAlias } = useGameStore.getState();
    expect(Object.keys(roleToAlias).sort()).toEqual([...ROLES].sort());
    for (const role of ROLES) {
      expect(`${role}:${roleToAlias[role]}`).toBe(`${role}:null`);
    }
  });
});

describe('gameStore — the three identifiers (00-conventions §2)', () => {
  it('holds no field named for a secret or for the server-only identity', () => {
    for (const key of Object.keys(useGameStore.getState())) {
      for (const bad of FORBIDDEN_SUBSTRINGS) {
        expect(key.toLowerCase()).not.toContain(bad.toLowerCase());
      }
    }
  });

  it('applyJoined puts the alias in the store and keeps the session_token out of it', () => {
    // `joined` is the one applier with no `seq` (§3).
    useGameStore.getState().applyJoined({
      alias: 'P3',
      session_token: 'tok-secret',
      role: 'RETAILER',
      is_host: false,
    });

    const state = useGameStore.getState();
    expect(state.myAlias).toBe('P3');
    expect(state.myRole).toBe('RETAILER');
    expect(state.isHost).toBe(false);
    expect(snapshot()).not.toContain('tok-secret');
  });

  it('applyJoined applies without a seq and does not move lastSeq', () => {
    useGameStore.getState().applyWeekClosed({ seq: 7, week: 3, next_week: 4, awaiting_roles: [] });

    useGameStore.getState().applyJoined({
      alias: 'P1',
      session_token: 'tok',
      role: null,
      is_host: true,
    });

    expect(useGameStore.getState().myAlias).toBe('P1');
    expect(useGameStore.getState().isHost).toBe(true);
    expect(useGameStore.getState().lastSeq).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// The seq gate lives in the appliers (criteria 11, 12)
// ---------------------------------------------------------------------------

describe('the seq gate (16 §3, §4.4)', () => {
  it('CRITERION 12: a higher seq applies and advances lastSeq', () => {
    const before = snapshot();

    useGameStore.getState().applyWeekClosed({
      seq: 5,
      week: 3,
      next_week: 4,
      awaiting_roles: ['RETAILER'],
    });

    const state = useGameStore.getState();
    expect(state.lastSeq).toBe(5);
    expect(state.awaitingRoles).toEqual(['RETAILER']);
    expect(snapshot()).not.toBe(before);
  });

  it('CRITERION 11: a lower seq is a no-op, leaving the whole state untouched', () => {
    useGameStore.getState().applyWeekClosed({ seq: 5, week: 3, next_week: 4, awaiting_roles: ['RETAILER'] });
    const afterFive = snapshot();

    useGameStore.getState().applyWeekClosed({
      seq: 2,
      week: 1,
      next_week: 2,
      awaiting_roles: ['FACTORY', 'WHOLESALER'],
    });

    expect(snapshot()).toBe(afterFive);
    expect(useGameStore.getState().lastSeq).toBe(5);
  });

  it('CRITERION 11: an equal seq is dropped as a duplicate', () => {
    useGameStore.getState().applyWeekClosed({ seq: 5, week: 3, next_week: 4, awaiting_roles: ['RETAILER'] });
    const afterFive = snapshot();

    useGameStore.getState().applyWeekClosed({ seq: 5, week: 9, next_week: 10, awaiting_roles: [] });

    expect(snapshot()).toBe(afterFive);
  });

  it('gates every sequenced applier, not just one', () => {
    useGameStore.getState().applyWeekClosed({ seq: 20, week: 8, next_week: 9, awaiting_roles: [] });
    const afterTwenty = snapshot();

    // Each of these carries a stale seq and must be discarded.
    useGameStore.getState().applyGamePaused({ seq: 3, reason: 'P2 disconnected' });
    useGameStore.getState().applyGameResumed({ seq: 4 });
    useGameStore.getState().applyRolesAssigned({
      seq: 5,
      role_to_alias: { RETAILER: 'P1', WHOLESALER: 'P2', DISTRIBUTOR: null, FACTORY: null },
    });
    useGameStore.getState().applyParticipantDisconnected({
      seq: 6,
      alias: 'P2',
      display_name: 'Ana',
      role: 'WHOLESALER',
    });
    useGameStore.getState().applyBotSubstituted({ seq: 7, role: 'FACTORY', display_name: 'Bot 4' });

    expect(snapshot()).toBe(afterTwenty);
    expect(useGameStore.getState().lastSeq).toBe(20);
  });

  it('a stale event does not rewind the UI after a resync', () => {
    useGameStore.getState().applyWeekClosed({ seq: 12, week: 6, next_week: 7, awaiting_roles: ['FACTORY'] });

    // The straggler from before the reconnect finally arrives.
    useGameStore.getState().applyWeekClosed({ seq: 4, week: 2, next_week: 3, awaiting_roles: [] });

    expect(useGameStore.getState().lastSeq).toBe(12);
    expect(useGameStore.getState().awaitingRoles).toEqual(['FACTORY']);
  });
});

// ---------------------------------------------------------------------------
// Lobby and play appliers
// ---------------------------------------------------------------------------

describe('lobby appliers', () => {
  it('applyLobbyUpdate populates the lobby fields', () => {
    useGameStore.getState().applyLobbyUpdate({
      seq: 1,
      state: 'LOBBY',
      host_display_name: 'Prof. Ana',
      participants: [
        { alias: 'P1', display_name: 'Ana', role: 'RETAILER', is_bot: false, connected: true, is_host: false },
        { alias: 'P2', display_name: 'Bruno', role: null, is_bot: false, connected: false, is_host: false },
      ],
      role_to_alias: { RETAILER: 'P1', WHOLESALER: null, DISTRIBUTOR: null, FACTORY: null },
      role_assignment_mode: 'HOST_ASSIGNS',
      seats_total: 4,
      config_locked: false,
      can_start: false,
      start_blocked_reason: 'Waiting for 3 more players.',
    });

    const state = useGameStore.getState();
    expect(state.roomState).toBe('LOBBY');
    expect(state.hostDisplayName).toBe('Prof. Ana');
    expect(state.participants).toHaveLength(2);
    expect(state.roleAssignmentMode).toBe('HOST_ASSIGNS');
    expect(state.roleToAlias.RETAILER).toBe('P1');
    expect(state.lastSeq).toBe(1);

    // The server decides whether the game can start; the client never computes it.
    expect(state.canStart).toBe(false);
    expect(state.startBlockedReason).toBe('Waiting for 3 more players.');
  });

  it('applyLobbyUpdate flips canStart, and the reason is null exactly when it is true', () => {
    const base = {
      state: 'READY' as const,
      host_display_name: 'Host',
      participants: [],
      role_to_alias: { RETAILER: 'P1', WHOLESALER: 'P2', DISTRIBUTOR: 'P3', FACTORY: 'P4' },
      role_assignment_mode: 'HOST_ASSIGNS' as const,
      seats_total: 4,
      config_locked: true,
    };

    useGameStore.getState().applyLobbyUpdate({
      ...base,
      seq: 1,
      can_start: false,
      start_blocked_reason: 'Two roles are unfilled.',
    });
    expect(useGameStore.getState().canStart).toBe(false);
    expect(useGameStore.getState().startBlockedReason).toBe('Two roles are unfilled.');

    useGameStore.getState().applyLobbyUpdate({
      ...base,
      seq: 2,
      can_start: true,
      start_blocked_reason: null,
    });
    expect(useGameStore.getState().canStart).toBe(true);
    expect(useGameStore.getState().startBlockedReason).toBeNull();
  });

  it('applyLobbyUpdate never leaks a secret into the store', () => {
    useGameStore.getState().applyLobbyUpdate({
      seq: 1,
      state: 'CONFIGURING',
      host_display_name: 'Host',
      participants: [],
      role_to_alias: { RETAILER: null, WHOLESALER: null, DISTRIBUTOR: null, FACTORY: null },
      role_assignment_mode: 'RANDOM',
      seats_total: 4,
      config_locked: true,
      can_start: false,
      start_blocked_reason: 'Nobody has joined yet.',
    });

    const text = snapshot().toLowerCase();
    expect(text).not.toContain('host_secret');
    expect(text).not.toContain('session_token');
    expect(text).not.toContain('identity');
  });

  it('applyRolesAssigned replaces the role map', () => {
    useGameStore.getState().applyRolesAssigned({
      seq: 2,
      role_to_alias: { RETAILER: 'P1', WHOLESALER: 'P2', DISTRIBUTOR: 'P3', FACTORY: 'P4' },
    });

    expect(useGameStore.getState().roleToAlias).toEqual({
      RETAILER: 'P1',
      WHOLESALER: 'P2',
      DISTRIBUTOR: 'P3',
      FACTORY: 'P4',
    });
  });
});

describe('play appliers', () => {
  it('applyGamePaused and applyGameResumed drive the pause flags', () => {
    useGameStore.getState().applyGamePaused({ seq: 3, reason: 'P2 disconnected' });

    expect(useGameStore.getState().paused).toBe(true);
    expect(useGameStore.getState().pausedReason).toBe('P2 disconnected');

    useGameStore.getState().applyGameResumed({ seq: 4 });

    expect(useGameStore.getState().paused).toBe(false);
    expect(useGameStore.getState().lastSeq).toBe(4);
  });

  it('applyWeekClosed carries the roles still owed a decision', () => {
    useGameStore.getState().applyWeekClosed({
      seq: 9,
      week: 4,
      next_week: 5,
      awaiting_roles: ['DISTRIBUTOR', 'FACTORY'],
    });

    expect(useGameStore.getState().awaitingRoles).toEqual(['DISTRIBUTOR', 'FACTORY']);
  });

  it('applyOrderSubmitted carries identity only — never a quantity', () => {
    useGameStore.getState().applyOrderSubmitted({
      seq: 10,
      week: 4,
      role: 'RETAILER',
      display_name: 'Ana',
      is_bot: false,
    });

    // 12 §2: `order_submitted` is "identity only, never a quantity".
    expect(useGameStore.getState().lastSeq).toBe(10);
    expect(snapshot().toLowerCase()).not.toContain('"order"');
  });

  it('applyParticipantDisconnected and applyParticipantReconnected both apply', () => {
    useGameStore.getState().applyParticipantDisconnected({
      seq: 11,
      alias: 'P2',
      display_name: 'Bruno',
      role: 'WHOLESALER',
    });
    expect(useGameStore.getState().lastSeq).toBe(11);

    useGameStore.getState().applyParticipantReconnected({
      seq: 12,
      alias: 'P2',
      display_name: 'Bruno',
      role: 'WHOLESALER',
    });
    expect(useGameStore.getState().lastSeq).toBe(12);
  });

  it('applyBotSubstituted applies', () => {
    useGameStore.getState().applyBotSubstituted({ seq: 13, role: 'FACTORY', display_name: 'Bot 4' });
    expect(useGameStore.getState().lastSeq).toBe(13);
  });
});

describe('join_error (D18 recovery depends on this, 17 §2.4)', () => {
  it('applyJoinError records the message', () => {
    useGameStore.getState().applyJoinError({ message: 'You are not the host of this room.' });

    expect(useGameStore.getState().joinError).toBe('You are not the host of this room.');
  });

  it('applies with no seq, even after a high seq has been applied', () => {
    // `join_error` carries no `seq`, so — unlike every sequenced applier — it
    // must not be gated. Gating it would make a refusal after any game event
    // invisible, and the refusal is exactly what tells a tab it is not the host.
    useGameStore.getState().applyWeekClosed({ seq: 40, week: 12, next_week: 13, awaiting_roles: [] });

    useGameStore.getState().applyJoinError({ message: 'Room not found.' });

    expect(useGameStore.getState().joinError).toBe('Room not found.');
    expect(useGameStore.getState().lastSeq).toBe(40);
  });

  it('a second refusal replaces the first', () => {
    useGameStore.getState().applyJoinError({ message: 'first' });
    useGameStore.getState().applyJoinError({ message: 'second' });

    expect(useGameStore.getState().joinError).toBe('second');
  });

  it('clearJoinError returns it to null once a screen has acted on it', () => {
    useGameStore.getState().applyJoinError({ message: 'You are not the host of this room.' });

    useGameStore.getState().clearJoinError();

    expect(useGameStore.getState().joinError).toBeNull();
  });

  it('clearing is idempotent and harmless when there is no error', () => {
    useGameStore.getState().clearJoinError();
    expect(useGameStore.getState().joinError).toBeNull();
  });

  it('null before the first reply is distinguishable from a refusal', () => {
    // Section 17 tells "refused" apart from "not answered yet" by this field
    // alone; before the first reply the two states look identical from the
    // route plus isHost.
    expect(useGameStore.getState().joinError).toBeNull();

    useGameStore.getState().applyJoinError({ message: 'Not the host.' });

    expect(useGameStore.getState().joinError).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Identity, lifecycle and UI actions
// ---------------------------------------------------------------------------

describe('identity and lifecycle actions', () => {
  it('setRoomCode and setIsHost write only their own field', () => {
    useGameStore.getState().setRoomCode('ABCD12');
    expect(useGameStore.getState().roomCode).toBe('ABCD12');
    expect(useGameStore.getState().isHost).toBe(false);

    useGameStore.getState().setIsHost(true);
    expect(useGameStore.getState().isHost).toBe(true);
    expect(useGameStore.getState().roomCode).toBe('ABCD12');

    useGameStore.getState().setRoomCode(null);
    expect(useGameStore.getState().roomCode).toBeNull();
  });

  it('reset() returns the store to the frozen initial state', () => {
    useGameStore.getState().setRoomCode('ABCD12');
    useGameStore.getState().setIsHost(true);
    useGameStore.getState().applyWeekClosed({ seq: 9, week: 4, next_week: 5, awaiting_roles: ['FACTORY'] });
    useGameStore.getState().addAlert({ kind: 'error', message: 'boom' });
    useGameStore.getState().setConnectionError('down');
    useGameStore.getState().applyJoinError({ message: 'Not the host.' });
    useGameStore.getState().applyLobbyUpdate({
      seq: 10,
      state: 'READY',
      host_display_name: 'Host',
      participants: [],
      role_to_alias: { RETAILER: 'P1', WHOLESALER: 'P2', DISTRIBUTOR: 'P3', FACTORY: 'P4' },
      role_assignment_mode: 'HOST_ASSIGNS',
      seats_total: 4,
      config_locked: true,
      can_start: true,
      start_blocked_reason: null,
    });

    useGameStore.getState().reset();

    const state = useGameStore.getState();
    expect(state.roomCode).toBeNull();
    expect(state.isHost).toBe(false);
    expect(state.lastSeq).toBe(0);
    expect(state.awaitingRoles).toEqual([]);
    expect(state.alerts).toEqual([]);
    expect(state.connectionError).toBeNull();
    expect(state.canStart).toBe(false);
    expect(state.startBlockedReason).toBeNull();
    expect(state.joinError).toBeNull();
    expect(state.roleToAlias).toEqual({
      RETAILER: null,
      WHOLESALER: null,
      DISTRIBUTOR: null,
      FACTORY: null,
    });
  });

  it('setConnectionError sets and clears', () => {
    useGameStore.getState().setConnectionError('Could not reach the server.');
    expect(useGameStore.getState().connectionError).toBe('Could not reach the server.');

    useGameStore.getState().setConnectionError(null);
    expect(useGameStore.getState().connectionError).toBeNull();
  });
});

describe('alerts (the frozen Alert shape)', () => {
  it('an alert with timeoutMs dismisses itself; one without stays', () => {
    vi.useFakeTimers();
    try {
      useGameStore.getState().addAlert({ kind: 'info', message: 'brief', timeoutMs: 10_000 });
      const sticky = useGameStore.getState().addAlert({ kind: 'error', message: 'sticky' });

      vi.advanceTimersByTime(9_999);
      expect(useGameStore.getState().alerts).toHaveLength(2);

      vi.advanceTimersByTime(1);
      const alerts = useGameStore.getState().alerts;
      expect(alerts).toHaveLength(1);
      expect(alerts[0].id).toBe(sticky);
    } finally {
      vi.useRealTimers();
    }
  });

  it('addAlert returns the minted id and stores {id, kind, message}', () => {
    const id = useGameStore.getState().addAlert({ kind: 'error', message: 'Something failed.' });

    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);

    const alerts = useGameStore.getState().alerts;
    expect(alerts).toHaveLength(1);
    expect(alerts[0].id).toBe(id);
    expect(alerts[0].kind).toBe('error');
    expect(alerts[0].message).toBe('Something failed.');
  });

  it('mints a distinct id per alert', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      ids.add(useGameStore.getState().addAlert({ kind: 'info', message: `n ${i}` }));
    }
    expect(ids.size).toBe(5);
    expect(useGameStore.getState().alerts).toHaveLength(5);
  });

  it('dismissAlert removes exactly one, by id', () => {
    const first = useGameStore.getState().addAlert({ kind: 'info', message: 'first' });
    const second = useGameStore.getState().addAlert({ kind: 'success', message: 'second' });

    useGameStore.getState().dismissAlert(first);

    const alerts = useGameStore.getState().alerts;
    expect(alerts).toHaveLength(1);
    expect(alerts[0].id).toBe(second);
    expect(alerts[0].kind).toBe('success');
  });

  it('dismissing an unknown id is harmless', () => {
    useGameStore.getState().addAlert({ kind: 'info', message: 'kept' });
    useGameStore.getState().dismissAlert('no-such-id');
    expect(useGameStore.getState().alerts).toHaveLength(1);
  });
});

describe('gameStore — readers see writes', () => {
  it('notifies subscribers on a change', () => {
    const seen: Array<string | null> = [];
    const unsubscribe = useGameStore.subscribe((s) => seen.push(s.roomCode));

    useGameStore.getState().setRoomCode('ABCD12');

    unsubscribe();

    expect(useGameStore.getState().roomCode).toBe('ABCD12');
    expect(seen).toContain('ABCD12');
  });
});
