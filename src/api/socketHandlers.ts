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
  clearHostRoom,
  clearHostSecret,
  clearSessionToken,
  getDisplayName,
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
  GamePersistedPayload,
  GameResumedPayload,
  GameStartedPayload,
  HostClaimedPayload,
  HostEventPayload,
  HostStatePayload,
  JoinEmit,
  JoinErrorPayload,
  JoinedPayload,
  LeaveAckPayload,
  LobbyUpdatePayload,
  OrderSubmittedPayload,
  ParticipantEventPayload,
  RolesAssignedPayload,
  SeatReclaimedPayload,
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
 * server refused it: the socket cap, or an ID token it could not verify (or
 * Firebase unconfigured server-side). Only the cap's own message is 'cap'; every
 * other refusal is 'auth'.
 */
const NETWORK_ERROR_PATTERN =
  /xhr poll error|websocket error|^timeout$|transport (error|close)|failed to fetch|network error|ECONNREFUSED|ETIMEDOUT/i

/**
 * The backend refuses a handshake for two reasons (`app/core/abuse.py`): this
 * address already holds its cap of open sockets, which it says with exactly
 * this text, or the ID token failed, which python-socketio reports with its
 * generic "Connection rejected by server".
 */
export const CAP_REFUSAL_MESSAGE = 'Too many connections from your network. Try again in a minute.'

/**
 * `network` for a transport failure, `cap` for the cap's refusal message, and
 * `auth` for any other refusal.
 */
export function classifyConnectError(message: string): 'auth' | 'network' | 'cap' {
  if (NETWORK_ERROR_PATTERN.test(message)) return 'network'
  return message === CAP_REFUSAL_MESSAGE ? 'cap' : 'auth'
}

const CONNECT_ERROR_MESSAGE = {
  auth: 'Sign-in could not be verified by the server. Try signing out and back in, or continue as a guest.',
  network: 'Could not reach the game server. Retrying…',
  cap: 'Too many connections from your network. Retrying…',
} as const

const CAP_GAVE_UP_MESSAGE =
  'Too many connections from your network. Please reload the page in a few minutes.'

/**
 * Socket.IO does not retry a refused handshake: a `CONNECT_ERROR` packet
 * destroys the socket (`active` goes false) and `reconnectionAttempts` never
 * comes into play. A cap refusal is temporary — it lifts as soon as someone
 * else on the network closes a tab — so it is retried here, with growing
 * delays and jitter so a classroom behind one address does not retry in step.
 */
const CAP_RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 16_000, 30_000, 30_000] as const
let capRetries = 0
let capRetryTimer: ReturnType<typeof setTimeout> | null = null

function clearCapRetry(): void {
  capRetries = 0
  if (capRetryTimer !== null) clearTimeout(capRetryTimer)
  capRetryTimer = null
}

/** Schedules the next retry; false once the retries are spent. */
function scheduleCapRetry(): boolean {
  if (capRetryTimer !== null) return true
  const delay = CAP_RETRY_DELAYS_MS[capRetries]
  if (delay === undefined) return false
  capRetries += 1
  capRetryTimer = setTimeout(
    () => {
      capRetryTimer = null
      if (!socket.connected && !socket.active) socket.connect()
    },
    delay / 2 + Math.random() * (delay / 2),
  )
  return true
}

/**
 * A rate-limited event (`app/sockets/errors.py`, `@guarded`). The play loop
 * says so with `code: "RATE_LIMITED"`; the lobby's `join_error` has no code,
 * so it is recognised by the backend's one fixed sentence.
 */
const RATE_LIMITED_CODE = 'RATE_LIMITED'
const RATE_LIMITED_SERVER_MESSAGE = 'Too many requests. Please slow down and try again.'
const RATE_LIMITED_MESSAGE =
  'Too many actions from your network in a short time. Please wait a moment and try again.'

/**
 * Suppresses duplicate alerts across the automatic retries
 * (`reconnectionAttempts: 10`). Reset once the socket actually connects, or on
 * a clean disconnect, so a later failure still gets its own alert.
 */
let connectErrorAlerted = false

/**
 * The id of the alert the current failure cycle raised, so a successful
 * connect can take it down again. On a cold start the socket connects while
 * the backend is still asleep behind `BackendWakeUp`, fails, and raises
 * "Could not reach the game server"; without this the toast outlives the
 * wake-up and sits over a working app.
 */
let connectErrorAlertId: string | null = null

function dismissConnectErrorAlert(): void {
  if (connectErrorAlertId === null) return
  store().dismissAlert(connectErrorAlertId)
  connectErrorAlertId = null
}

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

  // The display name goes back out too, so a reconnect does not silently drop
  // the name the player chose. A shell may also emit `join` on mount, so a cold
  // load can produce two: that is intended and harmless, because `join` is
  // idempotent by identity and the alternative — one emitter inferring whether
  // the other has already fired — breaks on a slow connect.
  const payload: JoinEmit = { room_id: roomCode }
  const displayName = getDisplayName()
  if (displayName) payload.display_name = displayName
  const sessionToken = getSessionToken(roomCode)
  if (sessionToken) payload.session_token = sessionToken
  join(payload)
}

/* ─── connection lifecycle ─── */

socket.on('connect', () => {
  connectErrorAlerted = false
  clearCapRetry()
  dismissConnectErrorAlert()
  store().setConnectionError(null)
  rejoinAfterConnect()
})

socket.on('disconnect', () => {
  connectErrorAlerted = false
})

socket.on('connect_error', (error: Error) => {
  const kind = classifyConnectError(error?.message ?? '')

  if (kind === 'cap' && !scheduleCapRetry()) {
    // The retries are spent: replace the "Retrying…" alert with one that
    // does not promise another attempt.
    store().setConnectionError(CAP_GAVE_UP_MESSAGE)
    dismissConnectErrorAlert()
    connectErrorAlerted = true
    connectErrorAlertId = store().addAlert({ kind: 'error', message: CAP_GAVE_UP_MESSAGE })
    return
  }

  const message = CONNECT_ERROR_MESSAGE[kind]
  store().setConnectionError(message)

  // One alert per failed retry cycle, not one per attempt.
  if (connectErrorAlerted) return
  connectErrorAlerted = true
  connectErrorAlertId = store().addAlert({ kind: kind === 'auth' ? 'error' : 'info', message })
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
  // A rate-limited lobby event is not a refusal of this tab: written to
  // `joinError` it would put up HostRoom's "This tab isn't the host" screen
  // over a host who merely clicked too fast. It gets the alert only.
  if (payload?.message === RATE_LIMITED_SERVER_MESSAGE) {
    store().addAlert({ kind: 'error', message: RATE_LIMITED_MESSAGE })
    return
  }
  const message = payload?.message || 'Could not join the room.'
  // The store field is what lets a screen tell a refusal apart from silence —
  // D18's recovery path depends on it. The alert is the generic surfacing, in
  // the same shape as `connect_error` above.
  store().applyJoinError({ message })
  store().addAlert({ kind: 'error', message })
})

/**
 * The seat is gone server-side, so this browser's claim on it has to go with
 * it. The `session_token` is what `rejoinAfterConnect` would otherwise present
 * on the next connect, putting the player straight back into the room they
 * just left; the host keys go too, so a host who leaves does not keep a stale
 * secret for a room they are no longer in.
 *
 * The room code comes from the payload, and only falls back to the store —
 * `applyLeaveAck` clears `roomCode`, so it has to be read before that runs.
 */
socket.on('leave_ack', (payload: LeaveAckPayload) => {
  const roomCode = payload?.room_id ?? store().roomCode ?? currentRouteRoom().roomCode
  if (roomCode) {
    clearSessionToken(roomCode)
    clearHostSecret(roomCode)
    if (isHostForRoom(roomCode)) clearHostRoom()
  }
  store().applyLeaveAck()
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

socket.on('host_disconnected', (payload: HostEventPayload) => {
  store().applyHostDisconnected(payload)
})

socket.on('host_reconnected', (payload: HostEventPayload) => {
  store().applyHostReconnected(payload)
})

socket.on('bot_substituted', (payload: BotSubstitutedPayload) => {
  store().applyBotSubstituted(payload)
})

socket.on('seat_reclaimed', (payload: SeatReclaimedPayload) => {
  store().applySeatReclaimed(payload)
})

socket.on('game_finished', (payload: GameFinishedPayload) => {
  store().applyGameFinished(payload)
})

socket.on('game_persisted', (payload: GamePersistedPayload) => {
  store().applyGamePersisted(payload)
})

/**
 * Codes the server sends on `error` that get no alert. `GAME_FINISHED`
 * answers an order that raced the end of the game (the host ended it, or the
 * last week closed): nothing went wrong, and the game-over panel already says
 * the game is over.
 */
const SILENT_ERROR_CODES: ReadonlySet<string> = new Set(['GAME_FINISHED'])

socket.on('error', (payload: ErrorPayload) => {
  const code = payload?.code ?? ''
  const message =
    code === RATE_LIMITED_CODE
      ? RATE_LIMITED_MESSAGE
      : payload?.message || 'A server error occurred.'
  // Two pieces of store state from one handler, exactly as `join_error` does:
  // the field is the durable signal a screen maps to its own copy by `code`,
  // the alert is the transient one every other screen gets for free.
  store().applyError({ message, code })
  if (!SILENT_ERROR_CODES.has(code)) store().addAlert({ kind: 'error', message })
})
