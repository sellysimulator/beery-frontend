import { useEffect, useState, type FormEvent, type ReactElement } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { errorMessage } from '../api/http'
import { createRoom, getRoomStatus, listPresets } from '../api/rooms'
import { useAuth } from '../auth/AuthContext'
import Avatar from '../components/shared/Avatar'
import { ROOM_CODE_LENGTH, sanitiseRoomCode } from '../components/lobby/roomCode'
import type { PresetSummary, RoomStatusResponse } from '../types/game'
import {
  MAX_DISPLAY_NAME_LENGTH,
  getDisplayName,
  setDisplayName,
  setHostRoom,
  setHostSecret,
} from '../utils/storage'
import type { RouteDescriptor } from '../routes/registry'

interface InlineError {
  message: string
  hint: string | null
}

/**
 * Turns a refused `GET /rooms/{code}/status` into something the person in
 * front of the screen can act on.
 *
 * A full room names its host on purpose: "Room is full" on its own leaves a
 * player unsure whether they mistyped the code, and they retype it instead of
 * asking the host what happened.
 */
function joinRefusal(status: RoomStatusResponse): InlineError {
  const reason = status.reason ?? 'This room cannot be joined.'

  if (reason === 'Room is full.') {
    return {
      message: status.host_display_name
        ? `Room is full. ${status.host_display_name}'s game already has four players.`
        : 'Room is full. This game already has four players.',
      hint: null,
    }
  }

  if (reason === 'This game has already started.') {
    return {
      message: reason,
      hint: 'If you were already playing, open your original link — you can rejoin.',
    }
  }

  return { message: reason, hint: null }
}

/**
 * Host a game, or join one.
 *
 * The create path persists `host_secret` **before** it navigates. The secret
 * is returned exactly once (`10-rooms-rest-api.md` section 3.1); navigating
 * first and storing second loses the room if the render that follows throws,
 * and there is no second copy to ask for.
 */
export function HomePage(): ReactElement {
  const navigate = useNavigate()
  const { firebaseUser, mode, logout } = useAuth()

  const suggestedName = firebaseUser?.displayName ?? getDisplayName() ?? ''

  const [presets, setPresets] = useState<PresetSummary[]>([])
  /**
   * One name, two fields. Both panels ask for `Your name` (section 2.4b) and
   * it is the same person either way, so the two inputs are views of one
   * value: typing it while deciding to host and then joining instead must not
   * silently lose it.
   */
  const [displayName, setName] = useState(suggestedName)
  const [preset, setPreset] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  const [joinCode, setJoinCode] = useState('')
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState<InlineError | null>(null)

  useEffect(() => {
    let cancelled = false
    // Presets are a convenience: a failure here must not stop a host creating
    // a room on the defaults.
    listPresets()
      .then((response) => {
        if (!cancelled) setPresets(response.presets)
      })
      .catch(() => {
        if (!cancelled) setPresets([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleCreate(event: FormEvent): Promise<void> {
    event.preventDefault()
    setCreating(true)
    setCreateError('')
    try {
      const room = await createRoom({
        host_display_name: displayName.trim() || 'Host',
        preset: preset === '' ? null : preset,
      })
      setDisplayName(displayName)
      setHostSecret(room.room_code, room.host_secret)
      setHostRoom(room.room_code)
      navigate(`/host/${room.room_code}`)
    } catch (err) {
      setCreateError(errorMessage(err, 'Could not create the room.'))
    } finally {
      setCreating(false)
    }
  }

  async function handleJoin(event: FormEvent): Promise<void> {
    event.preventDefault()
    const code = sanitiseRoomCode(joinCode)
    if (code.length === 0) {
      setJoinError({ message: 'Enter the room code your host gave you.', hint: null })
      return
    }

    setJoining(true)
    setJoinError(null)
    try {
      const status = await getRoomStatus(code)
      if (!status.ok) {
        setJoinError(joinRefusal(status))
        return
      }
      setDisplayName(displayName)
      navigate(`/game/${code}`)
    } catch (err) {
      setJoinError({ message: errorMessage(err, 'Could not reach that room.'), hint: null })
    } finally {
      setJoining(false)
    }
  }

  const selectedPreset = presets.find((candidate) => candidate.name === preset)

  return (
    <div className="min-h-screen px-6 py-10">
      <div className="mx-auto flex max-w-4xl flex-col gap-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold">The Beer Game</h1>
          <div className="flex items-center gap-3 text-sm">
            {mode === 'authenticated' && firebaseUser ? (
              <>
                <Avatar
                  photoUrl={firebaseUser.photoURL}
                  displayName={firebaseUser.displayName ?? 'You'}
                  size={32}
                />
                <span className="text-ink-muted">
                  {firebaseUser.displayName ?? firebaseUser.email}
                </span>
                <button
                  type="button"
                  onClick={() => void logout().then(() => navigate('/'))}
                  className="text-ink-muted hover:text-brand"
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <span className="text-ink-muted">Playing as a guest</span>
                <Link to="/" className="text-ink-muted hover:text-brand">
                  Sign in
                </Link>
              </>
            )}
          </div>
        </header>

        <div className="grid gap-6 md:grid-cols-2">
          <form
            onSubmit={(event) => void handleCreate(event)}
            className="flex flex-col gap-4 rounded-lg border border-border bg-surface-raised px-5 py-5"
          >
            <h2 className="text-xl font-semibold">Host a game</h2>
            <p className="text-sm text-ink-muted">
              You set the scenario and run the session. You do not play.
            </p>

            <label className="flex flex-col gap-1 text-sm">
              <span>Name to host as</span>
              <input
                type="text"
                value={displayName}
                maxLength={MAX_DISPLAY_NAME_LENGTH}
                onChange={(event) => setName(event.target.value)}
                placeholder="Host"
                className="rounded-md border border-border bg-surface px-3 py-2 text-ink"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span>Preset</span>
              <select
                value={preset}
                onChange={(event) => setPreset(event.target.value)}
                className="rounded-md border border-border bg-surface px-3 py-2 text-ink"
              >
                <option value="">Default settings</option>
                {presets.map((candidate) => (
                  <option key={candidate.name} value={candidate.name}>
                    {candidate.label}
                  </option>
                ))}
              </select>
            </label>
            {selectedPreset ? (
              <p className="text-sm text-ink-muted">{selectedPreset.description}</p>
            ) : null}

            {createError ? (
              <p role="alert" className="text-sm text-danger">
                {createError}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={creating}
              aria-label="Create game"
              className="rounded-md bg-brand px-4 py-3 font-semibold text-ink-inverse transition hover:bg-brand-strong disabled:bg-surface-sunken disabled:text-ink-subtle"
            >
              {creating ? 'Creating…' : 'Create game'}
            </button>
          </form>

          <form
            onSubmit={(event) => void handleJoin(event)}
            className="flex flex-col gap-4 rounded-lg border border-border bg-surface-raised px-5 py-5"
          >
            <h2 className="text-xl font-semibold">Join a game</h2>
            <p className="text-sm text-ink-muted">
              You play one link in the chain for the whole session.
            </p>

            <label className="flex flex-col gap-1 text-sm">
              <span>Room code</span>
              <input
                type="text"
                value={joinCode}
                onChange={(event) => setJoinCode(sanitiseRoomCode(event.target.value))}
                maxLength={ROOM_CODE_LENGTH}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                placeholder="ABC234"
                aria-describedby={joinError ? 'join-error' : undefined}
                className="numeric rounded-md border border-border bg-surface px-3 py-2 text-lg tracking-widest text-ink uppercase"
              />
            </label>

            {joinError ? (
              <p id="join-error" role="alert" className="flex flex-col gap-1 text-sm text-danger">
                <span>{joinError.message}</span>
                {joinError.hint ? <span className="text-ink-muted">{joinError.hint}</span> : null}
              </p>
            ) : null}

            <label className="flex flex-col gap-1 text-sm">
              <span>Name to join as</span>
              <input
                type="text"
                value={displayName}
                maxLength={MAX_DISPLAY_NAME_LENGTH}
                onChange={(event) => setName(event.target.value)}
                placeholder="What the room should call you"
                className="rounded-md border border-border bg-surface px-3 py-2 text-ink"
              />
            </label>

            <button
              type="submit"
              disabled={joining}
              aria-label="Join game"
              className="rounded-md border border-border-strong px-4 py-3 font-semibold transition hover:border-brand hover:text-brand disabled:text-ink-subtle"
            >
              {joining ? 'Checking…' : 'Join game'}
            </button>
          </form>
        </div>

        <nav className="flex gap-6 text-sm">
          <Link to="/player-manual" className="text-ink-muted hover:text-brand">
            Player manual
          </Link>
          <Link to="/host-manual" className="text-ink-muted hover:text-brand">
            Host manual
          </Link>
        </nav>
      </div>
    </div>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const route: RouteDescriptor = {
  path: '/home',
  guard: 'auth+backend',
  element: <HomePage />,
}

export default HomePage
