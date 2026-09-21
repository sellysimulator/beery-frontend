import { Suspense, useEffect, useRef, type ReactElement } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { join } from '../api/games'
import { useGameStore } from '../store/gameStore'
import { getDisplayName, getSessionToken } from '../utils/storage'
import PlayerLobby from '../components/lobby/PlayerLobby'
import ScreenUnavailable from '../components/lobby/ScreenUnavailable'
import NotFound from '../components/shared/NotFound'
import ScreenLoading from '../components/shared/ScreenLoading'
import type { JoinEmit, RoomState } from '../types/game'
import type { RouteDescriptor } from '../routes/registry'
import { playingScreen } from './shellScreens'

/** Room states in which the game has started and the play screen takes over. */
const STARTED: RoomState[] = ['RUNNING', 'PAUSED', 'FINISHED']

/** Resolved once, at module load; `null` until section 19 exists (**D19**). */
const PlayingScreen = playingScreen()

/**
 * The player's shell.
 *
 * It owns the `join` emit, the route guard and the loading states, because
 * those apply in every room state, and delegates the running game to section
 * 19's screen. It knows nothing about inventory or orders, and the screen it
 * delegates to takes no props — it reads the store, as every screen does.
 */
export function GameRoom(): ReactElement {
  const { roomCode } = useParams<{ roomCode: string }>()
  const roomState = useGameStore((state) => state.roomState)
  const setRoomCode = useGameStore((state) => state.setRoomCode)
  const leftRoom = useGameStore((state) => state.leftRoom)
  const joined = useRef(false)

  useEffect(() => {
    if (!roomCode) return
    setRoomCode(roomCode)

    // Once per mount cycle. StrictMode runs an effect, tears it down and runs
    // it again against the same instance, and the ref is what makes the second
    // pass a no-op — server-side idempotency exists to survive reconnects, not
    // to paper over a UI that joins twice.
    if (joined.current) return
    joined.current = true

    const sessionToken = getSessionToken(roomCode)
    const displayName = getDisplayName()
    const payload: JoinEmit = { room_id: roomCode }
    if (displayName) payload.display_name = displayName
    if (sessionToken) payload.session_token = sessionToken

    // Socket.IO buffers an emit made before the connection is up and flushes
    // it on connect, so this works on a cold load from an invite link too.
    join(payload)
  }, [roomCode, setRoomCode])

  if (!roomCode) return <NotFound />

  // Checked before the room states, so an ack that lands in the same tick as a
  // `game_started` still takes the player out rather than into the play screen.
  if (leftRoom) return <LeftRoomRedirect />

  if (STARTED.includes(roomState as RoomState)) {
    if (!PlayingScreen) return <ScreenUnavailable />
    return (
      <Suspense fallback={<ScreenLoading label="Loading the game screen" />}>
        <PlayingScreen />
      </Suspense>
    )
  }

  return <PlayerLobby roomCode={roomCode} />
}

/**
 * Sends a player who has left back to their home screen, and lowers the flag
 * on the way out.
 *
 * The flag is cleared in an unmount cleanup rather than on mount: clearing it
 * on mount would re-render this component with `leftRoom` false, and `GameRoom`
 * would put the lobby back on screen for a frame before the redirect commits.
 * Clearing it on unmount means the next room this browser joins starts from a
 * lowered flag, which is what stops one leave from bouncing every later join.
 */
function LeftRoomRedirect(): ReactElement {
  const clearLeftRoom = useGameStore((state) => state.clearLeftRoom)
  useEffect(() => clearLeftRoom, [clearLeftRoom])
  return <Navigate to="/home" replace />
}

/**
 * `/join/:roomCode` exists because a host may share either form of the link.
 * It carries no behaviour of its own — it hands the code to `/game/:roomCode`,
 * where the auth guard picks it up and parks it as `state.from` if the visitor
 * has not chosen an identity yet.
 */
function JoinRedirect(): ReactElement {
  const { roomCode } = useParams<{ roomCode: string }>()
  if (!roomCode) return <NotFound />
  return <Navigate to={`/game/${roomCode}`} replace />
}

// eslint-disable-next-line react-refresh/only-export-components
export const route: RouteDescriptor[] = [
  { path: '/game/:roomCode', guard: 'auth+backend', element: <GameRoom /> },
  { path: '/join/:roomCode', guard: 'public', element: <JoinRedirect /> },
]

export default GameRoom
