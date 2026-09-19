import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { errorMessage } from '../api/http'
import {
  getMyGames,
  getMyStats,
  type MatchHistoryResponse,
  type UserStatsResponse,
} from '../api/users'
import { useAuth } from '../auth/AuthContext'
import MatchDetail from '../components/profile/MatchDetail'
import MatchHistoryTable from '../components/profile/MatchHistoryTable'
import ProfileClaimPrompt from '../components/profile/ProfileClaimPrompt'
import RoleBreakdown from '../components/profile/RoleBreakdown'
import StatsSummary from '../components/profile/StatsSummary'
import Avatar from '../components/shared/Avatar'
import LoadingSpinner from '../components/shared/LoadingSpinner'
import type { RouteDescriptor } from '../routes/registry'

/** Page size 20, and the client never asks for more (§3.2, `15 §3.5`). */
const PAGE_SIZE = 20

/** `?page=` is user input: a missing, malformed or zero value is page 1. */
function pageFromQuery(raw: string | null): number {
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= 1 ? value : 1
}

/**
 * What a guest sees. `AuthGuard` lets a guest through — it is about having an
 * identity, not an account (**D3**) — so the page itself is what draws the
 * line between "you have a profile" and "you could have one".
 */
function SignInPrompt(): ReactElement {
  const { signInWithGoogle } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function signIn(): Promise<void> {
    setBusy(true)
    setError('')
    try {
      await signInWithGoogle()
    } catch (err) {
      setError(errorMessage(err, 'Signing in did not work.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Sign in to keep your results.</h1>
        <p className="text-ink-muted">
          A profile is where your games, your costs and how much you amplified demand add
          up across sessions. Playing as a guest works exactly the same; it just leaves
          nothing behind.
        </p>
      </header>

      <div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void signIn()}
          className="rounded-md bg-brand px-4 py-2 font-semibold text-ink-inverse transition hover:bg-brand-strong disabled:bg-surface-sunken disabled:text-ink-subtle"
        >
          {busy ? 'Signing in…' : 'Sign in with Google'}
        </button>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      {/* Renders only for a guest who has actually played — its own condition
          is guest mode plus a minted guest id (§3.1). */}
      <ProfileClaimPrompt />

      <p className="text-sm">
        <Link to="/home" className="text-brand-strong underline">
          Back to your games
        </Link>
      </p>
    </div>
  )
}

/**
 * The profile proper: two requests on mount, and never one per row.
 *
 * `GET /users/me/stats` and page 1 of `GET /users/me/games` are the whole
 * budget (§3.3). The backend guarantees a bounded statement count for the
 * history (`15 §3.5`), and a client that fetched each game's detail to fill a
 * column would undo that guarantee from this side, which is the expensive
 * mistake this page is shaped to avoid.
 */
function AuthenticatedProfile(): ReactElement {
  const { firebaseUser, logout } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const page = pageFromQuery(searchParams.get('page'))

  const [stats, setStats] = useState<UserStatsResponse | null>(null)
  const [statsError, setStatsError] = useState('')

  /**
   * The history, tagged with the page it answers for.
   *
   * Tagging is what lets the table show a spinner for the page being fetched
   * without clearing state from inside the effect, which is a cascading
   * render. It is also what makes "a page replaces the table" (§3.2) true by
   * construction: there is one page in state, never a growing list.
   */
  const [history, setHistory] = useState<{ page: number; data: MatchHistoryResponse } | null>(
    null,
  )
  const [historyError, setHistoryError] = useState<{ page: number; message: string } | null>(
    null,
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const response = await getMyStats()
        if (!cancelled) setStats(response)
      } catch (err) {
        if (!cancelled) setStatsError(errorMessage(err, 'Your statistics could not be loaded.'))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const response = await getMyGames(page, PAGE_SIZE)
        // A page REPLACES the table; nothing is appended (§3.2).
        if (!cancelled) setHistory({ page, data: response })
      } catch (err) {
        if (!cancelled) {
          setHistoryError({ page, message: errorMessage(err, 'Your games could not be loaded.') })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [page])

  /** The page number lives in the URL, so a reload returns to it (§3.2). */
  const goToPage = useCallback(
    (next: number) => {
      setSearchParams((previous) => {
        const params = new URLSearchParams(previous)
        params.set('page', String(Math.max(1, next)))
        return params
      })
    },
    [setSearchParams],
  )

  const displayName = firebaseUser?.displayName ?? firebaseUser?.email ?? 'You'

  const shownHistory = history && history.page === page ? history.data : null
  const shownHistoryError =
    historyError && historyError.page === page ? historyError.message : null

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-10">
      <header className="flex flex-wrap items-center gap-4">
        <Avatar photoUrl={firebaseUser?.photoURL ?? null} displayName={displayName} size={56} />
        <h1 className="grow text-3xl font-semibold">{displayName}</h1>
        <button
          type="button"
          onClick={() => void logout()}
          className="rounded-md border border-border-strong px-4 py-2 text-sm transition hover:border-brand hover:text-brand"
        >
          Sign out
        </button>
      </header>

      {statsError ? (
        <p role="alert" className="text-sm text-danger">
          {statsError}
        </p>
      ) : null}

      {stats === null ? (
        statsError ? null : (
          <LoadingSpinner label="Loading your statistics" />
        )
      ) : (
        <>
          <StatsSummary stats={stats} />
          <RoleBreakdown stats={stats} />
        </>
      )}

      {shownHistoryError ? (
        <p role="alert" className="text-sm text-danger">
          {shownHistoryError}
        </p>
      ) : (
        <MatchHistoryTable
          matches={shownHistory?.matches ?? []}
          total={shownHistory?.total ?? 0}
          page={page}
          pageSize={shownHistory?.page_size ?? PAGE_SIZE}
          onPageChange={goToPage}
          loading={shownHistory === null}
        />
      )}
    </div>
  )
}

/**
 * Where a registered player sees what they have learned across sessions.
 *
 * This is the reason to sign in rather than play as a guest, so it has to be
 * worth the account: aggregate figures with the one line each that makes them
 * mean something, the four seats they have and have not taken, and every game
 * they finished, reopenable in full.
 */
export function ProfilePage(): ReactElement {
  const { mode } = useAuth()
  return mode === 'authenticated' ? <AuthenticatedProfile /> : <SignInPrompt />
}

/**
 * One of the caller's own games, at `/profile/games/:gameId`.
 *
 * It lives in this module rather than a second file in `src/pages/` because
 * `collectRoutes` accepts an array of descriptors (`16 §4.8`), which is
 * exactly what one page module contributing two paths is for.
 */
export function MatchDetailPage(): ReactElement {
  const { gameId } = useParams<{ gameId: string }>()
  return <MatchDetail gameId={gameId} />
}

// eslint-disable-next-line react-refresh/only-export-components
export const route: RouteDescriptor[] = [
  { path: '/profile', guard: 'auth+backend', element: <ProfilePage /> },
  { path: '/profile/games/:gameId', guard: 'auth+backend', element: <MatchDetailPage /> },
]

export default ProfilePage
