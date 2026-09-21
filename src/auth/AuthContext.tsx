import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth'
import { auth, googleProvider } from '../../firebase'
import http from '../api/http'
import { socket } from '../api/socket'
import { GUEST_ID_KEY, getOrCreateGuestId } from '../utils/storage'

export type AuthMode = 'authenticated' | 'guest' | null

export interface AuthContextValue {
  firebaseUser: User | null
  mode: AuthMode
  loading: boolean
  /**
   * True when `loading` was ended by the watchdog rather than by Firebase.
   * A screen can use it to say why a signed-in visitor is being shown the
   * sign-in choices again; nothing depends on it to decide access.
   */
  initTimedOut: boolean
  signInWithGoogle: () => Promise<void>
  continueAsGuest: () => void
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

/**
 * How long to wait for Firebase to report an auth state before giving up on it.
 *
 * `onAuthStateChanged` does not fire until the SDK has finished restoring the
 * persisted session, and for a returning signed-in user that means an IndexedDB
 * read followed by two sequential calls to Google — a `securetoken` refresh when
 * the cached ID token is over an hour old, then an `accounts:lookup`. Firebase
 * puts no deadline on either, and abandons them only on a hard network error,
 * so a request that stalls rather than fails leaves `loading` true forever and
 * every guarded route stuck behind the spinner.
 *
 * Eight seconds is past the point where the round trips can still be blamed on
 * a slow connection. Resolving here is not a lie about who the visitor is: it
 * falls back to the same guest-or-nobody answer a first-time visitor gets, and
 * if Firebase does answer later the listener below overrides it and reconnects
 * the socket, so a session that was merely slow still lands.
 */
const AUTH_INIT_TIMEOUT_MS = 8000

/**
 * Re-runs the socket handshake so `socket.ts`'s `auth` callback is invoked
 * again with the now-current ID token or guest id. The socket never
 * auto-connects, so the first call here is also the initial connect.
 */
function reconnectSocket(): void {
  if (socket.connected) {
    socket.disconnect().connect()
  } else {
    socket.connect()
  }
}

/**
 * Fire-and-forget profile refresh. The backend derives `firebase_uid` from the
 * verified ID token attached by the http interceptor; the body carries only
 * display fields (`02-identity-and-auth.md`). The result is ignored on purpose
 * — a failed upsert must not block sign-in.
 */
function syncUserWithBackend(user: User): void {
  void http
    .post('/users/upsert', {
      display_name: user.displayName ?? null,
      email: user.email ?? null,
      photo_url: user.photoURL ?? null,
    })
    .catch(() => undefined)
}

export function AuthProvider(props: { children: ReactNode }): ReactElement {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null)
  const [mode, setMode] = useState<AuthMode>(null)
  const [loading, setLoading] = useState(true)
  const [initTimedOut, setInitTimedOut] = useState(false)

  useEffect(() => {
    let resolved = false

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      resolved = true

      if (user) {
        setFirebaseUser(user)
        setMode('authenticated')
        syncUserWithBackend(user)
      } else {
        setFirebaseUser(null)
        setMode(localStorage.getItem(GUEST_ID_KEY) ? 'guest' : null)
      }

      setInitTimedOut(false)
      setLoading(false)
      // The first resolution starts the connection; a later one means the
      // identity changed underneath it, so the handshake is re-run.
      reconnectSocket()
    })

    const watchdog = setTimeout(() => {
      if (resolved) return
      setMode(localStorage.getItem(GUEST_ID_KEY) ? 'guest' : null)
      setInitTimedOut(true)
      setLoading(false)
      // Without this the socket is never connected at all: the only call site
      // is the listener above, which has not run.
      reconnectSocket()
    }, AUTH_INIT_TIMEOUT_MS)

    return () => {
      clearTimeout(watchdog)
      unsubscribe()
    }
  }, [])

  const signInWithGoogle = useCallback(async () => {
    const result = await signInWithPopup(auth, googleProvider)
    setFirebaseUser(result.user)
    setMode('authenticated')
    syncUserWithBackend(result.user)
  }, [])

  const continueAsGuest = useCallback(() => {
    getOrCreateGuestId()
    setMode('guest')
    // Choosing guest mode fires no Firebase auth event, so the socket has to
    // be reconnected explicitly for the handshake to pick the guest id up.
    reconnectSocket()
  }, [])

  const logout = useCallback(async () => {
    await signOut(auth)
    localStorage.removeItem(GUEST_ID_KEY)
    setFirebaseUser(null)
    setMode(null)
    reconnectSocket()
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      firebaseUser,
      mode,
      loading,
      initTimedOut,
      signInWithGoogle,
      continueAsGuest,
      logout,
    }),
    [firebaseUser, mode, loading, initTimedOut, signInWithGoogle, continueAsGuest, logout],
  )

  return <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
