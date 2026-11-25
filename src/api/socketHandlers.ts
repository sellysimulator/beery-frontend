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
import { auth } from '../../firebase'
import { socket } from './socket'
import { join, joinWaiting } from './games'
import { useGameStore } from '../store/gameStore'
import {
  clearHostRoom,
  clearHostSecret,
  clearSessionToken,
  getDisplayName,
  getGuestId,
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
  RoomState,
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

/**
 * A signed-in user's refusal is retried every few seconds (below), so it says
 * what is happening rather than asking them to sign out: most often their ID
 * token could not be fetched on a flaky network, and the next try works.
 */
const SIGNED_IN_REFUSAL_MESSAGE = CONNECT_ERROR_MESSAGE.network

const CAP_GAVE_UP_MESSAGE =
  'Too many connections from your network. Please reload the page in a few minutes.'

/**
 * Socket.IO does not retry a refused handshake: a `CONNECT_ERROR` packet
 * destroys the socket (`active` goes false) and Socket.IO's own reconnection
 * never comes into play. A cap refusal is temporary — it lifts as soon as someone
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
      // A sign-out while this timer waited leaves no identity: the server would refuse it.
      if (!auth.currentUser && !getGuestId()) return
      if (!socket.connected && !socket.active) socket.connect()
    },
    delay / 2 + Math.random() * (delay / 2),
  )
  return true
}

/**
 * A signed-in user refused at the handshake (their ID token could not be
 * fetched, so `socket.ts` sent no identity, or the server could not verify
 * it) is retried every few seconds for as long as they stay signed in: a
 * token refresh that failed on a flaky network usually works on the next try,
 * and falling back to the guest id instead would seat them as someone else.
 * Socket.IO does not retry a refused handshake itself. A guest's refusal is
 * not retried here (the cap's own retry above covers the one a guest gets).
 */
export const SIGNED_IN_RETRY_DELAY_MS = 5_000
let signedInRetryTimer: ReturnType<typeof setTimeout> | null = null

function clearSignedInRetry(): void {
  if (signedInRetryTimer !== null) clearTimeout(signedInRetryTimer)
  signedInRetryTimer = null
}

function scheduleSignedInRetry(): void {
  if (signedInRetryTimer !== null || !auth.currentUser) return
  signedInRetryTimer = setTimeout(() => {
    signedInRetryTimer = null
    if (auth.currentUser && !socket.connected && !socket.active) socket.connect()
  }, SIGNED_IN_RETRY_DELAY_MS)
}

/**
 * Whether this page has had a working connection yet. A disconnect before the
 * first connect is the cold start (`BackendWakeUp` covers it); after it, the
 * screens show "Connection lost. Reconnecting…" until the socket is back.
 */
let hasConnected = false

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
 * Suppresses duplicate alerts across the automatic retries (Socket.IO's,
 * which never give up, and this module's own). Reset once the socket actually connects, or on
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

  // A player rejoins only with this room's `session_token`. Without one the
  // browser has never been seated here, and the player still has to choose a
  // name: `GameRoom` shows the name form and sends the first `join` itself
  // (spec §4.1). Joining from here would create the seat before the name was
  // chosen, and the server keeps the name a seat was created with.
  const sessionToken = getSessionToken(roomCode)
  if (!sessionToken) return

  // The display name goes back out too, so a reconnect does not silently drop
  // the name the player chose. A shell may also emit `join` on mount, so a cold
  // load can produce two: that is intended and harmless, because `join` is
  // idempotent by identity and the alternative — one emitter inferring whether
  // the other has already fired — breaks on a slow connect.
  rejoin(roomCode, sessionToken)
}

function rejoin(roomCode: string, sessionToken: string): void {
  const payload: JoinEmit = { room_id: roomCode, session_token: sessionToken }
  const displayName = getDisplayName()
  if (displayName) payload.display_name = displayName
  join(payload)
}

/* ─── connection lifecycle ─── */

socket.on('connect', () => {
  hasConnected = true
  store().setConnected(true)
  store().setReconnecting(false)
  connectErrorAlerted = false
  clearCapRetry()
  clearSignedInRetry()
  dismissConnectErrorAlert()
  store().setConnectionError(null)
  rejoinAfterConnect()
})

socket.on('disconnect', (reason?: string) => {
  connectErrorAlerted = false
  store().setConnected(false)
  // `io client disconnect` is this page's own `disconnect()` (a new identity
  // or a new room, followed by a `connect()` at once, or no identity left at
  // all): nothing to announce.
  if (hasConnected && reason !== 'io client disconnect') store().setReconnecting(true)
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

  const signedInRefusal = kind === 'auth' && auth.currentUser !== null
  if (signedInRefusal) scheduleSignedInRetry()

  const message = signedInRefusal ? SIGNED_IN_REFUSAL_MESSAGE : CONNECT_ERROR_MESSAGE[kind]
  store().setConnectionError(message)

  // One alert per failed retry cycle, not one per attempt.
  if (connectErrorAlerted) return
  connectErrorAlerted = true
  const alertKind = kind === 'auth' && !signedInRefusal ? 'error' : 'info'
  connectErrorAlertId = store().addAlert({ kind: alertKind, message })
})

/**
 * A tab that moves off a room (to another room, or to none: "Play again",
 * Home's create or join, the dashboard, a leave) takes its socket out of the
 * old room at once by reconnecting it; the server treats the old connection's
 * drop as leaving that room. The store has just started over for the new
 * room, and one late event of the old room, with that room's higher `seq`,
 * would make it drop every event of the new one. Joining the new room is not
 * enough on its own: a first-time player sends no `join` until they have
 * named themselves, and until then the old room's events kept arriving. The
 * `connect` handler's `rejoinAfterConnect` joins the new room, and a join a
 * screen emits meanwhile is buffered until the new connection is up.
 */
useGameStore.subscribe((state, previous) => {
  if (previous.roomCode === null || state.roomCode === previous.roomCode) return
  if (socket.connected) socket.disconnect().connect()
})

/* ─── lobby ─── */

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

/**
 * A page that missed its resync asks for it again: a host tab claims the room
 * again, a player's rejoins. Without it the host waits on "Waiting for the
 * room's state" (or "Saving the results…") and the player on "Waiting for the
 * server to send your position". The server sends a room's events in the order
 * of their `seq`, so this is for what that does not cover: a host tab displaced
 * in the lobby never got a resync, and an event that was overtaken anyway is
 * dropped by the seq gate. The limit is there so no answer can make it endless.
 */
function resyncAgainIf(missing: boolean): void {
  if (!missing) {
    asksAgain = 0
    return
  }
  const { roomCode, isHost } = store()
  if (!roomCode || asksAgain >= ASK_AGAIN_LIMIT) return
  if (isHost) {
    asksAgain += 1
    const hostSecret = getHostSecret(roomCode)
    joinWaiting(hostSecret ? { room_id: roomCode, host_secret: hostSecret } : { room_id: roomCode })
    return
  }
  const sessionToken = getSessionToken(roomCode)
  if (!sessionToken) return
  asksAgain += 1
  rejoin(roomCode, sessionToken)
}

const ASK_AGAIN_LIMIT = 5
/** Resyncs asked for in a row without the answer landing. */
let asksAgain = 0

/** The states whose player screen is the board. */
const STARTED_STATES: ReadonlySet<RoomState> = new Set(['RUNNING', 'PAUSED', 'FINISHED'])

/** What the page of a started game cannot show without: the host's state, or the player's and the room's. */
function viewMissing(): boolean {
  const { isHost, hostState, myState, roomState } = store()
  if (isHost) return hostState === null
  return myState === null || roomState === null || !STARTED_STATES.has(roomState)
}

socket.on('join_error', (payload: JoinErrorPayload) => {
  // A `start_game` refusal names its room. For a room of the
  // multi-game dashboard's batch it goes on that game's card, not into a
  // global alert or `joinError`. Anything else keeps the behaviour below.
  const refusedRoom = payload?.room_code
  if (typeof refusedRoom === 'string' && store().batchRooms.includes(refusedRoom)) {
    const message =
      payload.message === RATE_LIMITED_SERVER_MESSAGE
        ? RATE_LIMITED_MESSAGE
        : payload.message || 'The game could not start.'
    store().setBatchStartError(refusedRoom, message)
    return
  }
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

/* ─── play ─── */

socket.on('your_state', (payload: YourStatePayload) => {
  store().applyYourState(payload)
  resyncAgainIf(viewMissing())
})

socket.on('host_state', (payload: HostStatePayload) => {
  store().applyHostState(payload)
  resyncAgainIf(viewMissing())
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
  resyncAgainIf(viewMissing())
})

socket.on('game_persisted', (payload: GamePersistedPayload) => {
  store().applyGamePersisted(payload)
  // With the id but no view, the resync's `host_state` or `your_state` has already asked again.
  const missing = store().gamePublicId === null
  if (missing || !viewMissing()) resyncAgainIf(missing)
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
