import { create } from 'zustand'
import type {
  BotSubstitutedPayload,
  ConfigUpdatedPayload,
  GameConfig,
  GameFinishedPayload,
  GamePausedPayload,
  GameResumedPayload,
  GameStartedPayload,
  HostStatePayload,
  HostView,
  JoinErrorPayload,
  JoinedPayload,
  LobbyUpdatePayload,
  OrderSubmittedPayload,
  Participant,
  ParticipantEventPayload,
  PlayerView,
  Role,
  RoleAssignmentMode,
  RoleToAlias,
  RolesAssignedPayload,
  RoomState,
  WeekClosedPayload,
  YourStatePayload,
  YourWeekClosedPayload,
} from '../types/game'

/**
 * The single source of truth for room and game state.
 *
 * It is written ONLY by the socket handlers in `src/api/socketHandlers.ts`.
 * Components read from it; they never compute inventory, cost or eligibility,
 * because every one of those arrives from the server
 * (`00-conventions.md` section 4).
 */
export interface GameState {
  // identity
  roomCode: string | null
  myAlias: string | null
  myRole: Role | null
  isHost: boolean

  // lobby
  roomState: RoomState | null
  hostDisplayName: string | null
  participants: Participant[]
  roleToAlias: Record<Role, string | null>
  roleAssignmentMode: RoleAssignmentMode | null
  /** Host only; null for players. */
  config: GameConfig | null
  /** From `lobby_update`. The server decides; the client never does. */
  canStart: boolean
  /** null exactly when `canStart` is true. */
  startBlockedReason: string | null
  /** The last `join_error` message, or null. */
  joinError: string | null
  /**
   * True between the server's `leave_ack` and the shell unmounting the room.
   *
   * It exists because the ack arrives on the socket, and the socket is read in
   * `socketHandlers.ts` — outside React, where there is no router to navigate
   * with. So the handler records the fact and `GameRoom` turns it into a
   * redirect, which keeps the store the single reader of the wire (16 section 3)
   * instead of adding a second `socket.on` inside a component.
   */
  leftRoom: boolean

  // play
  week: number | null
  durationWeeks: number | null
  lastSeq: number
  myState: PlayerView | null
  hostState: HostView | null
  awaitingRoles: Role[]
  hasSubmitted: boolean
  paused: boolean
  pausedReason: string | null

  // end
  finished: GameFinishedPayload | null

  // ui
  alerts: Alert[]
  connectionError: string | null
  /**
   * The last `error` event's message and code, or null. The code is what a
   * screen needs to map a specific failure to its own copy -- section 19's
   * `TOO_MANY_SUBMISSIONS` is the first. It lives here rather than in a
   * component-level `socket.on('error')` listener because the store is the
   * single reader of the wire (`00-conventions.md 4`); a second interpreter is
   * what StrictMode double-registers and a reconnect leaves stale.
   */
  lastError: ServerError | null
}

export interface ServerError {
  message: string
  code: string
}

export interface Alert {
  /** Client-minted, unique. */
  id: string
  kind: 'info' | 'success' | 'error'
  message: string
}

export interface GameActions {
  // identity and lifecycle
  setRoomCode(roomCode: string | null): void
  setIsHost(isHost: boolean): void
  /** Back to the initial state, on leaving a room. */
  reset(): void

  // section 11 events
  /** No `seq`: `joined` does not carry one. */
  applyJoined(p: JoinedPayload): void
  /** No `seq`: `join_error` does not carry one. Sets `joinError`. */
  applyJoinError(p: JoinErrorPayload): void
  /** A screen dismisses the error after acting on it. */
  clearJoinError(): void
  /** Wipes the room from the store and raises `leftRoom`. */
  applyLeaveAck(): void
  /** Lowered by the shell once it has acted on `leftRoom`. */
  clearLeftRoom(): void
  applyLobbyUpdate(p: LobbyUpdatePayload): void
  applyConfigUpdated(p: ConfigUpdatedPayload): void
  applyRolesAssigned(p: RolesAssignedPayload): void
  applyGameStarted(p: GameStartedPayload): void

  // section 12 events
  applyYourState(p: YourStatePayload): void
  applyHostState(p: HostStatePayload): void
  applyOrderSubmitted(p: OrderSubmittedPayload): void
  applyWeekClosed(p: WeekClosedPayload): void
  applyYourWeekClosed(p: YourWeekClosedPayload): void
  applyGamePaused(p: GamePausedPayload): void
  applyGameResumed(p: GameResumedPayload): void
  applyParticipantDisconnected(p: ParticipantEventPayload): void
  applyParticipantReconnected(p: ParticipantEventPayload): void
  applyBotSubstituted(p: BotSubstitutedPayload): void
  applyGameFinished(p: GameFinishedPayload): void

  // config, written by the REST fallback in section 18 when the socket is not
  // connected. `PUT /rooms/{code}/config` returns the same stored, post-clamp
  // config that `config_updated` carries, but without a `seq`, so it cannot go
  // through `applyConfigUpdated`'s sequence gate -- minting a `seq` there would
  // make the next genuine socket event look stale and be dropped.
  setConfig(config: GameConfig | null): void

  // ui
  setConnectionError(message: string | null): void
  applyError(p: ServerError): void
  clearLastError(): void
  /** Returns the minted id. */
  addAlert(alert: Omit<Alert, 'id'>): string
  dismissAlert(id: string): void
}

const EMPTY_ROLE_TO_ALIAS: RoleToAlias = {
  RETAILER: null,
  WHOLESALER: null,
  DISTRIBUTOR: null,
  FACTORY: null,
}

/** Frozen by section 16 section 3, so a test can say what "unchanged" means. */
const initialState: GameState = {
  roomCode: null,
  myAlias: null,
  myRole: null,
  isHost: false,

  roomState: null,
  hostDisplayName: null,
  participants: [],
  roleToAlias: { ...EMPTY_ROLE_TO_ALIAS },
  roleAssignmentMode: null,
  config: null,
  canStart: false,
  startBlockedReason: null,
  joinError: null,
  leftRoom: false,

  week: null,
  durationWeeks: null,
  lastSeq: 0,
  myState: null,
  hostState: null,
  awaitingRoles: [],
  hasSubmitted: false,
  paused: false,
  pausedReason: null,

  finished: null,

  alerts: [],
  connectionError: null,
  lastError: null,
}

/** Drops the envelope's `seq`, leaving just the view the server sent. */
function withoutSeq<T extends { seq: number }>(payload: T): Omit<T, 'seq'> {
  const view: Partial<T> = { ...payload }
  delete view.seq
  return view as Omit<T, 'seq'>
}

let alertCounter = 0

function mintAlertId(): string {
  alertCounter += 1
  return `alert-${alertCounter}`
}

/** The role held by `alias`, or null. */
function roleForAlias(roleToAlias: RoleToAlias, alias: string | null): Role | null {
  if (!alias) return null
  return (Object.keys(roleToAlias) as Role[]).find((r) => roleToAlias[r] === alias) ?? null
}

export const useGameStore = create<GameState & GameActions>((set, get) => {
  /**
   * Applies a sequenced game event, but only when it is newer than the last one
   * applied. Every server -> client game event carries a `seq` that is monotonic
   * per room (`00-conventions.md` section 3), so a stale event arriving after a
   * reconnect resync is dropped rather than rewinding the UI, and an equal `seq`
   * is dropped as a duplicate.
   *
   * That is also what makes a doubly-registered handler harmless under
   * StrictMode: the second application is a no-op.
   */
  function applySequenced(
    seq: number,
    update: (state: GameState) => Partial<GameState>,
  ): void {
    const state = get()
    if (typeof seq !== 'number' || !(seq > state.lastSeq)) return
    set({ ...update(state), lastSeq: seq })
  }

  return {
    ...initialState,

    setRoomCode: (roomCode) => set({ roomCode }),
    setIsHost: (isHost) => set({ isHost }),
    reset: () => set({ ...initialState, roleToAlias: { ...EMPTY_ROLE_TO_ALIAS } }),

    /**
     * A successful join makes any earlier refusal stale, so it clears
     * `joinError`. `clearJoinError()` remains for a screen that has shown the
     * error and wants it gone without a join; the two are not alternatives.
     */
    applyJoined: (p) =>
      set({ myAlias: p.alias, myRole: p.role, isHost: p.is_host, joinError: null }),

    /**
     * `joinError` is what lets a screen tell "the server refused this tab's
     * host claim" apart from "the server has not answered yet". D18's recovery
     * path turns on that distinction: showing the recovery screen before the
     * first reply makes the path invisible to the one person who needs it.
     */
    applyJoinError: (p) => set({ joinError: p?.message ?? null }),

    clearJoinError: () => set({ joinError: null }),

    /**
     * A full reset, not a field edit. The seat is gone server-side, so leaving
     * `participants`, `roleToAlias` or `myAlias` behind would let the next
     * screen render a room this browser is no longer in. `leftRoom` is set on
     * top of the reset, which is why this cannot just call `reset()`.
     */
    applyLeaveAck: () =>
      set({ ...initialState, roleToAlias: { ...EMPTY_ROLE_TO_ALIAS }, leftRoom: true }),

    clearLeftRoom: () => set({ leftRoom: false }),

    applyLobbyUpdate: (p) =>
      applySequenced(p.seq, (state) => {
        const mine = p.participants.find((participant) => participant.alias === state.myAlias)
        return {
          roomState: p.state,
          hostDisplayName: p.host_display_name,
          participants: p.participants,
          roleToAlias: p.role_to_alias,
          roleAssignmentMode: p.role_assignment_mode,
          canStart: p.can_start,
          startBlockedReason: p.start_blocked_reason,
          myRole: mine ? mine.role : state.myRole,
        }
      }),

    applyConfigUpdated: (p) => applySequenced(p.seq, () => ({ config: p.config })),

    applyRolesAssigned: (p) =>
      applySequenced(p.seq, (state) => ({
        roleToAlias: p.role_to_alias,
        myRole: roleForAlias(p.role_to_alias, state.myAlias) ?? state.myRole,
      })),

    applyGameStarted: (p) =>
      applySequenced(p.seq, (state) => ({
        roomState: 'RUNNING',
        week: p.week,
        durationWeeks: p.duration_weeks,
        roleToAlias: p.role_to_alias,
        config: p.config_public,
        hasSubmitted: false,
        paused: false,
        pausedReason: null,
        finished: null,
        myRole: roleForAlias(p.role_to_alias, state.myAlias) ?? state.myRole,
      })),

    applyYourState: (p) =>
      applySequenced(p.seq, () => {
        const view = withoutSeq(p)
        return {
          myState: view,
          myRole: view.role,
          week: view.week,
          durationWeeks: view.duration_weeks,
          awaitingRoles: view.awaiting_roles,
          hasSubmitted: view.has_submitted,
        }
      }),

    applyHostState: (p) =>
      applySequenced(p.seq, () => {
        const view = withoutSeq(p)
        return {
          hostState: view,
          week: view.week,
          durationWeeks: view.duration_weeks,
          awaitingRoles: view.awaiting_roles,
        }
      }),

    applyOrderSubmitted: (p) =>
      applySequenced(p.seq, (state) => ({
        awaitingRoles: state.awaitingRoles.filter((role) => role !== p.role),
        hasSubmitted: state.myRole === p.role ? true : state.hasSubmitted,
      })),

    applyWeekClosed: (p) =>
      applySequenced(p.seq, () => ({
        week: p.next_week,
        awaitingRoles: p.awaiting_roles,
        hasSubmitted: false,
      })),

    applyYourWeekClosed: (p) =>
      applySequenced(p.seq, (state) => {
        if (!state.myState) return {}
        const seen = state.myState.own_history.some((r) => r.week === p.record.week)
        return {
          myState: {
            ...state.myState,
            own_history: seen
              ? state.myState.own_history
              : [...state.myState.own_history, p.record],
          },
        }
      }),

    applyGamePaused: (p) =>
      applySequenced(p.seq, () => ({ paused: true, pausedReason: p.reason })),

    applyGameResumed: (p) =>
      applySequenced(p.seq, () => ({ paused: false, pausedReason: null })),

    applyParticipantDisconnected: (p) =>
      applySequenced(p.seq, (state) => ({
        participants: state.participants.map((participant) =>
          participant.alias === p.alias ? { ...participant, connected: false } : participant,
        ),
      })),

    applyParticipantReconnected: (p) =>
      applySequenced(p.seq, (state) => ({
        participants: state.participants.map((participant) =>
          participant.alias === p.alias ? { ...participant, connected: true } : participant,
        ),
      })),

    applyBotSubstituted: (p) =>
      applySequenced(p.seq, (state) => ({
        participants: state.participants.map((participant) =>
          participant.role === p.role
            ? { ...participant, is_bot: true, display_name: p.display_name }
            : participant,
        ),
      })),

    applyGameFinished: (p) =>
      applySequenced(p.seq, () => ({
        finished: p,
        roomState: 'FINISHED',
        paused: false,
        pausedReason: null,
        awaitingRoles: [],
      })),

    setConfig: (config) => set({ config }),

    setConnectionError: (message) => set({ connectionError: message }),

    applyError: (p) =>
      set({ lastError: { message: p.message, code: p.code } }),

    clearLastError: () => set({ lastError: null }),

    addAlert: (alert) => {
      const id = mintAlertId()
      set((state) => ({ alerts: [...state.alerts, { ...alert, id }] }))
      return id
    },

    dismissAlert: (id) =>
      set((state) => ({ alerts: state.alerts.filter((a) => a.id !== id) })),
  }
})
