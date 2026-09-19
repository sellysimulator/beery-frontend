import { useState, type ReactElement } from 'react'
import { Link, useLocation, useNavigate, type Location } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import LoadingSpinner from '../components/shared/LoadingSpinner'
import { MAX_DISPLAY_NAME_LENGTH, setDisplayName } from '../utils/storage'
import type { RouteDescriptor } from '../routes/registry'

/**
 * The public front door. Two identity choices and nothing else.
 *
 * Hosting is a capability, not an account (**D3**), so neither choice is the
 * "real" one: a guest can create and run a game exactly as a signed-in user
 * can. Signing in buys results tracked across games, and nothing else.
 */
export function WelcomeScreen(): ReactElement {
  const { signInWithGoogle, continueAsGuest, loading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [signingIn, setSigningIn] = useState(false)

  // AuthGuard parks the attempted route here as a react-router Location
  // (16 section 4.8), so it is handed to navigate() whole: flattening it to a
  // pathname drops the query string and the hash from an invite link.
  const from = (location.state as { from?: Location } | null)?.from
  const destination = from ?? '/home'

  async function handleGoogle(): Promise<void> {
    setError('')
    setSigningIn(true)
    try {
      await signInWithGoogle()
      if (name.trim()) setDisplayName(name)
      navigate(destination, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.')
    } finally {
      setSigningIn(false)
    }
  }

  function handleGuest(): void {
    setError('')
    setDisplayName(name)
    continueAsGuest()
    navigate(destination, { replace: true })
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingSpinner size="lg" label="Checking your sign-in" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="flex w-full max-w-md flex-col gap-8">
        <header className="flex flex-col gap-3 text-center">
          <h1 className="text-3xl font-bold">The Beer Game</h1>
          <p className="text-ink-muted">
            You run one link in a beer supply chain. Every week you receive beer from your
            supplier, ship beer to your customer, and decide how much to order — and because
            nothing arrives immediately, you are always ordering for a situation you cannot
            see yet.
          </p>
        </header>

        {error ? (
          <p role="alert" className="rounded-lg border border-danger px-4 py-3 text-sm text-danger">
            {error}
          </p>
        ) : null}

        <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface-raised px-5 py-5">
          <button
            type="button"
            onClick={() => void handleGoogle()}
            disabled={signingIn}
            className="rounded-md bg-brand px-4 py-3 font-semibold text-ink-inverse transition hover:bg-brand-strong disabled:bg-surface-sunken disabled:text-ink-subtle"
          >
            {signingIn ? 'Signing in…' : 'Sign in with Google'}
          </button>
          <p className="text-sm text-ink-muted">Your results are tracked across games.</p>

          <hr className="border-border" />

          <label className="flex flex-col gap-1 text-sm">
            <span>Your name</span>
            <input
              type="text"
              value={name}
              maxLength={MAX_DISPLAY_NAME_LENGTH}
              onChange={(event) => setName(event.target.value)}
              placeholder="What the room should call you"
              className="rounded-md border border-border bg-surface px-3 py-2 text-ink"
            />
          </label>
          <button
            type="button"
            onClick={handleGuest}
            className="rounded-md border border-border-strong px-4 py-3 font-semibold transition hover:border-brand hover:text-brand"
          >
            Continue as a guest
          </button>
          <p className="text-sm text-ink-muted">
            A display name only. Your results count for this game and are not kept.
          </p>
        </div>

        <nav className="flex justify-center gap-6 text-sm">
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
  path: '/',
  guard: 'public',
  element: <WelcomeScreen />,
}

export default WelcomeScreen
