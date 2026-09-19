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
  signInWithGoogle: () => Promise<void>
  continueAsGuest: () => void
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

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

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setFirebaseUser(user)
        setMode('authenticated')
        syncUserWithBackend(user)
      } else {
        setFirebaseUser(null)
        setMode(localStorage.getItem(GUEST_ID_KEY) ? 'guest' : null)
      }

      setLoading(false)
      // The first resolution starts the connection; a later one means the
      // identity changed underneath it, so the handshake is re-run.
      reconnectSocket()
    })

    return unsubscribe
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
      signInWithGoogle,
      continueAsGuest,
      logout,
    }),
    [firebaseUser, mode, loading, signInWithGoogle, continueAsGuest, logout],
  )

  return <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
