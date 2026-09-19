import { useState, type ReactElement } from 'react'
import http, { errorMessage } from '../../api/http'
import { useAuth } from '../../auth/AuthContext'
import { getGuestId } from '../../utils/storage'

interface ClaimResponse {
  claimed: number
}

/**
 * The profile's own claim offer — deliberately **not** section 21's
 * `GuestClaimPrompt`.
 *
 * That one is eligible only when this browser holds a `session_token` for the
 * room whose results are on screen: its evidence that it played *that* game.
 * The profile has no room, so reusing it here would render nothing at all,
 * silently, with no error and no symptom but a missing offer (§3.1, FM 11).
 *
 * The condition here is guest mode plus a minted guest id, and the claim
 * covers every game this browser played. The flow is the shared one — sign in
 * with Google, then `POST /games/claim` — and the guest id travels in the
 * request **body** and nowhere else: not in a path, not in a query string,
 * not in a log.
 */
export function ProfileClaimPrompt(): ReactElement | null {
  const { mode, signInWithGoogle } = useAuth()
  const [claimed, setClaimed] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const guestId = getGuestId()
  const eligible = mode === 'guest' && guestId !== null

  // Signing in flips `mode` to 'authenticated', which would otherwise pull the
  // panel out from under the count it was asked for.
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
      setError(errorMessage(err, 'Your games could not be claimed.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-label="Claim your guest games"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised px-5 py-4"
    >
      {claimed === null ? (
        <>
          <h2 className="text-lg font-semibold">
            You have played as a guest on this browser.
          </h2>
          <p className="text-sm text-ink-muted">
            Signing in attaches every game this browser played to your account, and they
            appear here from then on.
          </p>
          <div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void claim()}
              className="rounded-md bg-brand px-4 py-2 font-semibold text-ink-inverse transition hover:bg-brand-strong disabled:bg-surface-sunken disabled:text-ink-subtle"
            >
              {busy ? 'Signing in…' : 'Claim your games with Google'}
            </button>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </>
      ) : (
        <h2 className="text-lg font-semibold">
          {claimed === 1 ? '1 game is now yours.' : `${claimed} games are now yours.`}
        </h2>
      )}
    </section>
  )
}

export default ProfileClaimPrompt
