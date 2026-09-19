/**
 * Every Socket.IO listener is registered HERE, at module-load time, before any
 * React component renders. `main.tsx` imports this module for its side effect
 * ahead of `createRoot`.
 *
 * Handlers live outside React on purpose: a component-mounted handler is
 * registered twice under StrictMode and every event is then applied twice,
 * which for a store that appends to arrays silently doubles history.
 *
 * `useGameStore.getState()` is safe outside React, so each handler reads the
 * latest state at call time and never closes over a stale snapshot.
 */
import { socket } from './socket'
import { join, joinWaiting } from './games'
import { useGameStore } from '../store/gameStore'
import {
  getHostSecret,
  getSessionToken,
  isHostForRoom,
  setAlias,
  setHostRoom,
  setHostSecret,
  setSessionToken,
} from '../utils/storage'
import type {
  BotSubstitutedPayload,
  ConfigUpdatedPayload,
  ErrorPayload,
  GameFinishedPayload,
  GamePausedPayload,
  GameResumedPayload,
  GameStartedPayload,
  HostClaimedPayload,
  HostStatePayload,
  JoinErrorPayload,
  JoinedPayload,
  LobbyUpdatePayload,
  OrderSubmittedPayload,
  ParticipantEventPayload,
  RolesAssignedPayload,
  WeekClosedPayload,
  YourStatePayload,
  YourWeekClosedPayload,
} from '../types/game'

/** Always the freshest store slice — no stale closures. */
const store = () => useGameStore.getState()

/* ─── connect_error classification ─── */

/**
 * Engine.IO transport failures (unreachable server, DNS, a timed-out poll or
 * upgrade) have a small, well-known set of message strings. Anything else
 * reaching `connect_error` means the transport DID connect and the Socket.IO
 * handshake itself was refused — which in this app only happens when the
 * server could not verify the presented ID token, or Firebase is unconfigured
 * server-side. Unrecognised messages therefore default to 'auth'.
 */
const NETWORK_ERROR_PATTERN =
  /xhr poll error|websocket error|^timeout$|transport (error|close)|failed to fetch|network error|ECONNREFUSED|ETIMEDOUT/i

export function classifyConnectError(message: string): 'auth' | 'network' {
  return NETWORK_ERROR_PATTERN.test(message) ? 'network' : 'auth'
}

/**
 * Suppresses duplicate alerts across the automatic retries
 * (`reconnectionAttempts: 10`). Reset once the socket actually connects, or on
 * a clean disconnect, so a later failure still gets its own alert.
 */
let connectErrorAlerted = false

/* ─── route helpers ─── */

const ROOM_ROUTE_PATTERN = /^\/(host|game|join)\/([^/?#]+)/

interface RouteRoom {
  kind: 'host' | 'game' | 'join' | null
  roomCode: string | null
}

function currentRouteRoom(): RouteRoom {
  const path = typeof window === 'undefined' ? '' : window.location.pathname
  const match = ROOM_ROUTE_PATTERN.exec(path)
  if (!match) return { kind: null, roomCode: null }
  return { kind: match[1] as RouteRoom['kind'], roomCode: match[2] ?? null }
}

/**
 * Re-asserts this connection's place in the room.
 *
 * Socket.IO issues a new `sid` on every reconnect, so identity has to be
 * re-asserted; the server answers with a full state resync. No game state
 * lives only in client memory.
 *
 * The host emit deliberately goes out even when no `host_secret` is stored.
 * That is the client half of D18: `host_secret` lives in `sessionStorage` and
 * does not survive closing the tab, so the server authorises the claim against
 * the connection's verified identity and replies with `host_claimed` carrying a
 * fresh secret. Guarding this emit on `getHostSecret(...) !== null` silently
 * disables the whole recovery path, and the symptom is a permanently paused
 * game rather than a client-side error.
 */
export function rejoinAfterConnect(): void {
  const route = currentRouteRoom()
  const roomCode = store().roomCode ?? route.roomCode
  if (!roomCode) return

  if (route.kind === 'host' || isHostForRoom(roomCode)) {
    const hostSecret = getHostSecret(roomCode)
    joinWaiting(
      hostSecret ? { room_id: roomCode, host_secret: hostSecret } : { room_id: roomCode },
    )
    return
  }

  const sessionToken = getSessionToken(roomCode)
  join(sessionToken ? { room_id: roomCode, session_token: sessionToken } : { room_id: roomCode })
}

/* ─── connection lifecycle ─── */

socket.on('connect', () => {
  connectErrorAlerted = false
  store().setConnectionError(null)
  rejoinAfterConnect()
})

socket.on('disconnect', () => {
  connectErrorAlerted = false
})

socket.on('connect_error', (error: Error) => {
  const kind = classifyConnectError(error?.message ?? '')
  const message =
    kind === 'auth'
      ? 'Sign-in could not be verified by the server. Try signing out and back in, or continue as a guest.'
      : 'Could not reach the game server. Retrying…'

  store().setConnectionError(message)

  // One alert per failed retry cycle, not one per attempt.
  if (connectErrorAlerted) return
  connectErrorAlerted = true
  store().addAlert({ kind: kind === 'auth' ? 'error' : 'info', message })
})

/* ─── lobby (section 11) ─── */

socket.on('joined', (payload: JoinedPayload) => {
  if (!payload?.alias) return
  setAlias(payload.alias)

  const roomCode = store().roomCode ?? currentRouteRoom().roomCode
  if (roomCode && payload.session_token) {
    setSessionToken(roomCode, payload.session_token)
  }
  store().applyJoined(payload)
})

socket.on('host_claimed', (payload: HostClaimedPayload) => {
  if (!payload?.room_id || !payload.host_secret) return
  // Re-arms this tab for privileged actions after a D18 identity recovery.
  setHostSecret(payload.room_id, payload.host_secret)
  setHostRoom(payload.room_id)
  store().setIsHost(true)
})

socket.on('join_error', (payload: JoinErrorPayload) => {
  store().addAlert({ kind: 'error', message: payload?.message || 'Could not join the room.' })
})

socket.on('lobby_update', (payload: LobbyUpdatePayload) => {
  store().applyLobbyUpdate(payload)
})

socket.on('config_updated', (payload: ConfigUpdatedPayload) => {
  store().applyConfigUpdated(payload)
})

socket.on('roles_assigned', (payload: RolesAssignedPayload) => {
  store().applyRolesAssigned(payload)
})

socket.on('game_started', (payload: GameStartedPayload) => {
  store().applyGameStarted(payload)
})

/* ─── play (section 12) ─── */

socket.on('your_state', (payload: YourStatePayload) => {
  store().applyYourState(payload)
})

socket.on('host_state', (payload: HostStatePayload) => {
  store().applyHostState(payload)
})

socket.on('order_submitted', (payload: OrderSubmittedPayload) => {
  store().applyOrderSubmitted(payload)
})

socket.on('week_closed', (payload: WeekClosedPayload) => {
  store().applyWeekClosed(payload)
})

socket.on('your_week_closed', (payload: YourWeekClosedPayload) => {
  store().applyYourWeekClosed(payload)
})

socket.on('game_paused', (payload: GamePausedPayload) => {
  store().applyGamePaused(payload)
})

socket.on('game_resumed', (payload: GameResumedPayload) => {
  store().applyGameResumed(payload)
})

socket.on('participant_disconnected', (payload: ParticipantEventPayload) => {
  store().applyParticipantDisconnected(payload)
})

socket.on('participant_reconnected', (payload: ParticipantEventPayload) => {
  store().applyParticipantReconnected(payload)
})

socket.on('bot_substituted', (payload: BotSubstitutedPayload) => {
  store().applyBotSubstituted(payload)
})

socket.on('game_finished', (payload: GameFinishedPayload) => {
  store().applyGameFinished(payload)
})

socket.on('error', (payload: ErrorPayload) => {
  store().addAlert({ kind: 'error', message: payload?.message || 'A server error occurred.' })
})
