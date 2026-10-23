import { useState, type ReactElement } from 'react'
import { Link } from 'react-router-dom'
import http, { errorMessage } from '../../api/http'
import { useAuth } from '../../auth/AuthContext'
import { getGuestId, getSessionToken, isHostForRoom } from '../../utils/storage'

export interface GuestClaimPromptProps {
  roomCode: string
}

interface ClaimResponse {
  claimed: number
}

/**
 * The one place a guest is asked to make an account, offered **after** the
 * game and never as a gate before it (**D14**).
 *
 * Who played is decided by this browser, not by the payload: `identity` is
 * server-only and never on the wire (`00-conventions.md §2`), so no results
 * payload can say who was in the room. The three conditions are guest mode, a
 * minted guest id, and this browser's own evidence that it was in the room: a
 * `session_token` for it (a player), or this tab hosting it (a host). A guest
 * host who claims becomes the game's registered host, and may export it later
 * from any tab once signed in (`15 §3.2`); a hosted game never enters the
 * profile's game history, which counts only the roles a user played.
 *
 * The guest id travels in the `POST /games/claim` body and nowhere else: not
 * in a path, not in a query string, not in a log.
 */
export function GuestClaimPrompt({ roomCode }: GuestClaimPromptProps): ReactElement | null {
  const { mode, signInWithGoogle } = useAuth()
  const [claimed, setClaimed] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const guestId = getGuestId()
  const playedHere = getSessionToken(roomCode) !== null
  const hostedHere = isHostForRoom(roomCode)
  const eligible = mode === 'guest' && guestId !== null && (playedHere || hostedHere)

  // Signing in flips `mode` to 'authenticated', which would otherwise pull the
  // panel out from under the result it was asked for.
  if (claimed === null && !eligible) return null

  async function claim(): Promise<void> {
    if (!guestId) return
    setBusy(true)
    setError('')
    try {
      await signInWithGoogle()
      const response = await http.post<ClaimResponse>('/games/claim', {
        guest_identity: guestId,
      })
      setClaimed(response.data.claimed)
    } catch (err) {
      setError(errorMessage(err, 'Your results could not be claimed.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      data-print="omit"
      aria-label="Keep this result"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised px-5 py-4"
    >
      {claimed === null ? (
        <>
          <h2 className="text-lg font-semibold">
            {playedHere
              ? 'Sign in to keep this result in your profile.'
              : 'Sign in to keep exporting this game.'}
          </h2>
          <p className="text-sm text-ink-muted">
            {playedHere
              ? 'You played this game as a guest. Signing in attaches it — and every other game this browser played — to your account.'
              : "You hosted this game as a guest. Signing in lets your account export it after the room expires. Hosted games don't appear in your game history; games this browser played as a guest are added to it."}
          </p>
          <div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void claim()}
              className="rounded-md bg-brand px-4 py-2 font-semibold text-ink-inverse transition hover:bg-brand-strong disabled:bg-surface-sunken disabled:text-ink-subtle"
            >
              {busy ? 'Signing in…' : 'Claim this result with Google'}
            </button>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </>
      ) : (
        <>
          <h2 className="text-lg font-semibold">
            {claimed === 1 ? '1 game is now yours.' : `${claimed} games are now yours.`}
          </h2>
          <p className="text-sm text-ink-muted">
            <Link to="/profile" className="text-brand-strong underline">
              See them in your profile
            </Link>
          </p>
        </>
      )}
    </section>
  )
}

export default GuestClaimPrompt
