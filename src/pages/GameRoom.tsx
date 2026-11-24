import { Suspense, useEffect, useRef, useState, type ReactElement } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { join } from '../api/games'
import { useGameStore } from '../store/gameStore'
import { getDisplayName, getSessionToken, setDisplayName } from '../utils/storage'
import ManualLink from '../components/manual/ManualLink'
import NameForm from '../components/lobby/NameForm'
import PlayerLobby from '../components/lobby/PlayerLobby'
import NotFound from '../components/shared/NotFound'
import ReconnectingNotice from '../components/shared/ReconnectingNotice'
import ScreenLoading from '../components/shared/ScreenLoading'
import type { JoinEmit, RoomState } from '../types/game'
import type { RouteDescriptor } from '../routes/registry'
import { PlayingScreen } from './shellScreens'

/** Room states in which the game has started and the play screen takes over. */
const STARTED: RoomState[] = ['RUNNING', 'PAUSED', 'FINISHED']

/**
 * The player's shell.
 *
 * It owns the `join` emit, the route guard and the loading states, because
 * those apply in every room state, and delegates the running game to section
 * 19's screen. It knows nothing about inventory or orders, and the screen it
 * delegates to takes no props — it reads the store, as every screen does.
 *
 * **The name comes first** (spec §4.1, `game_stack.md` "Display names"). A
 * browser holding no `session_token` for this room has never been seated in
 * it, so the shell shows `NameForm` and sends no `join` until the player
 * submits it: the `join` creates the seat, and the server keeps the name the
 * seat was created with. A browser that does hold the token is rejoining, so
 * it skips the form and joins on mount with the stored name, as a reconnect
 * does (the server keeps the seated name either way).
 */
export function GameRoom(): ReactElement {
  const { roomCode } = useParams<{ roomCode: string }>()
  const roomState = useGameStore((state) => state.roomState)
  const setRoomCode = useGameStore((state) => state.setRoomCode)
  const leftRoom = useGameStore((state) => state.leftRoom)
  const joinError = useGameStore((state) => state.joinError)
  const clearJoinError = useGameStore((state) => state.clearJoinError)
  const joined = useRef(false)
  // Whether the player has submitted the name form on this mount. Until then a
  // `joinError` in the store belongs to something else and is not shown.
  const [named, setNamed] = useState(false)

  useEffect(() => {
    if (!roomCode) return
    setRoomCode(roomCode)

    // Once per mount cycle. StrictMode runs an effect, tears it down and runs
    // it again against the same instance, and the ref is what makes the second
    // pass a no-op — server-side idempotency exists to survive reconnects, not
    // to paper over a UI that joins twice.
    if (joined.current) return

    // No token, no join: the player names themselves first, and the join goes
    // out from `handleName`.
    const sessionToken = getSessionToken(roomCode)
    if (!sessionToken) return
    joined.current = true

    const displayName = getDisplayName()
    const payload: JoinEmit = { room_id: roomCode, session_token: sessionToken }
    if (displayName) payload.display_name = displayName

    // Socket.IO buffers an emit made before the connection is up and flushes
    // it on connect, so this works on a cold load from an invite link too.
    join(payload)
  }, [roomCode, setRoomCode])

  if (!roomCode) return <NotFound />

  // Checked before the room states, so an ack that lands in the same tick as a
  // `game_started` still takes the player out rather than into the play screen.
  if (leftRoom) return <LeftRoomRedirect />

  /**
   * Stores the name (sanitised, through `setDisplayName`) and then joins with
   * what was stored. An empty field joins with no name, so the server calls
   * the seat by its alias; it leaves the stored name alone, which only ever
   * prefills the next form.
   */
  function handleName(name: string): void {
    if (!roomCode) return
    const payload: JoinEmit = { room_id: roomCode }
    if (name.trim() !== '') {
      setDisplayName(name)
      const stored = getDisplayName()
      if (stored) payload.display_name = stored
    }
    clearJoinError()
    setNamed(true)
    join(payload)
  }

  // Read on every render rather than once: `joined` stores the token, and from
  // then on this browser is seated here. Until it is, the form stays up — before
  // the first submit, and again if the server refuses the join (full room,
  // game already started), with its reason under the field. While the reply is
  // on its way the lobby shows, as it does for a rejoin.
  const seatedHere = getSessionToken(roomCode) !== null
  if (!seatedHere && (!named || joinError !== null)) {
    return (
      <div className="min-h-screen px-6 py-10 pb-24">
        <div className="mx-auto flex max-w-md flex-col gap-6">
          <header className="flex flex-col gap-1">
            <p className="text-sm uppercase tracking-wide text-ink-muted">Room</p>
            <p className="numeric text-figure text-brand">{roomCode}</p>
          </header>
          <NameForm onSubmit={handleName} error={named ? joinError : null} />
        </div>
        <ManualLink to="/player-manual" label="Player manual" />
      </div>
    )
  }

  if (STARTED.includes(roomState as RoomState)) {
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
  {
    path: '/game/:roomCode',
    guard: 'auth+backend',
    element: (
      <>
        <GameRoom />
        <ReconnectingNotice />
      </>
    ),
  },
  { path: '/join/:roomCode', guard: 'public', element: <JoinRedirect /> },
]

export default GameRoom
