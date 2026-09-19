import { useEffect, useRef, type ReactElement } from 'react'
import { Link, useParams } from 'react-router-dom'
import { joinWaiting } from '../api/games'
import { useGameStore } from '../store/gameStore'
import { getHostSecret } from '../utils/storage'
import HostLobby from '../components/lobby/HostLobby'
import ScreenUnavailable from '../components/lobby/ScreenUnavailable'
import WaitingNotice from '../components/lobby/WaitingNotice'
import NotFound from '../components/shared/NotFound'
import type { RoomState } from '../types/game'
import type { RouteDescriptor } from '../routes/registry'
import { hostConsoleScreen } from './shellScreens'

const STARTED: RoomState[] = ['RUNNING', 'PAUSED', 'FINISHED']

/** Resolved once, at module load; `null` until section 20 exists (**D19**). */
const ConsoleScreen = hostConsoleScreen()

/** Shown only after the server has actually refused the claim. */
function HostRecovery({ message }: { message: string }): ReactElement {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold">This tab isn't the host of that room.</h1>
      <p className="max-w-md text-ink-muted">{message}</p>
      <Link
        to="/home"
        className="rounded-md border border-border-strong px-4 py-2 text-sm hover:border-brand hover:text-brand"
      >
        Back to your games
      </Link>
    </div>
  )
}

/**
 * The host's shell.
 *
 * It claims the host seat with `join_waiting` — **with the stored
 * `host_secret` when there is one, and without it when there is not**. That
 * second case is the whole of **D18** on the client: the secret lives in
 * `sessionStorage` and does not survive closing the tab, so a host who reopens
 * their room is re-authorised against the identity the handshake already
 * verified, and the server answers with `host_claimed` carrying a fresh secret
 * to store.
 *
 * Two things this must never do. It must never fall through to a player
 * `join`: that consumes one of four seats and leaves the room with a host who
 * is also a player. And it must not show the recovery screen while the claim
 * is still in flight — doing so makes the recovery path invisible to the one
 * person who needs it, who reads a transient state as a refusal and gives up.
 */
export function HostRoom(): ReactElement {
  const { roomCode } = useParams<{ roomCode: string }>()
  const roomState = useGameStore((state) => state.roomState)
  const isHost = useGameStore((state) => state.isHost)
  const setRoomCode = useGameStore((state) => state.setRoomCode)
  // The store is the only reader of the wire (`16 §3`): a component-level
  // `socket.on('join_error', …)` is a second interpreter of it, which
  // StrictMode double-registers and a reconnect can leave stale.
  const joinError = useGameStore((state) => state.joinError)
  const clearJoinError = useGameStore((state) => state.clearJoinError)

  const claimed = useRef(false)

  useEffect(() => {
    if (!roomCode) return
    setRoomCode(roomCode)

    if (claimed.current) return
    claimed.current = true

    // A refusal left over from another room would otherwise show the recovery
    // screen before this claim has been answered at all.
    clearJoinError()

    const hostSecret = getHostSecret(roomCode)
    joinWaiting(
      hostSecret ? { room_id: roomCode, host_secret: hostSecret } : { room_id: roomCode },
    )
  }, [roomCode, setRoomCode, clearJoinError])

  if (!roomCode) return <NotFound />
  if (joinError) return <HostRecovery message={joinError} />

  // The claim has landed once the server has said so, either by minting a
  // secret for this tab or by putting it in the room's broadcasts.
  const claimSettled = isHost || roomState !== null
  if (!claimSettled) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <WaitingNotice
          title="Reconnecting as host…"
          detail="Checking with the server that this tab is allowed to run the room. Your players stay where they are."
        />
      </div>
    )
  }

  if (STARTED.includes(roomState as RoomState)) {
    return ConsoleScreen ? <ConsoleScreen /> : <ScreenUnavailable />
  }

  return <HostLobby roomCode={roomCode} />
}

// eslint-disable-next-line react-refresh/only-export-components
export const route: RouteDescriptor = {
  path: '/host/:roomCode',
  guard: 'auth+backend',
  element: <HostRoom />,
}

export default HostRoom
