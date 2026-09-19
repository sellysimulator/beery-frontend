import { Navigate, useLocation } from 'react-router-dom'
import type { ReactElement, ReactNode } from 'react'
import { useAuth } from '../../auth/AuthContext'
import LoadingSpinner from './LoadingSpinner'

/**
 * Lets through anyone who has chosen an identity — a signed-in Firebase user
 * or a guest. Hosting is a capability, not an account (D3), so this guard is
 * about having *an* identity, never about having an account.
 *
 * An unidentified visitor is sent to `/` with the attempted location in
 * `state.from`, so a player following an invite link lands back on it after
 * choosing an identity.
 */
export function AuthGuard(props: { children: ReactNode }): ReactElement {
  const { mode, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingSpinner size="lg" label="Checking your sign-in" />
      </div>
    )
  }

  if (mode === null) {
    return <Navigate to="/" replace state={{ from: location }} />
  }

  return <>{props.children}</>
}

export default AuthGuard
