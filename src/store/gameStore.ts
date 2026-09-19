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
  /** The one applier with no `seq`. */
  applyJoined(p: JoinedPayload): void
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

  // ui
  setConnectionError(message: string | null): void
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

    applyJoined: (p) =>
      set({ myAlias: p.alias, myRole: p.role, isHost: p.is_host }),

    applyLobbyUpdate: (p) =>
      applySequenced(p.seq, (state) => {
        const mine = p.participants.find((participant) => participant.alias === state.myAlias)
        return {
          roomState: p.state,
          hostDisplayName: p.host_display_name,
          participants: p.participants,
          roleToAlias: p.role_to_alias,
          roleAssignmentMode: p.role_assignment_mode,
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

    setConnectionError: (message) => set({ connectionError: message }),

    addAlert: (alert) => {
      const id = mintAlertId()
      set((state) => ({ alerts: [...state.alerts, { ...alert, id }] }))
      return id
    },

    dismissAlert: (id) =>
      set((state) => ({ alerts: state.alerts.filter((a) => a.id !== id) })),
  }
})
