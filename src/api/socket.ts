import { io, type Socket } from 'socket.io-client'
import { auth } from '../../firebase'
import { getGuestId } from '../utils/storage'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || ''

interface HandshakeAuth {
  idToken: string | null
  guestId: string | null
}

/**
 * The server derives `identity` from this handshake payload: a verified
 * Firebase ID token when signed in, else a `guest_<uuid4>`
 * (`resolve_identity`).
 *
 * It is a CALLBACK, not an object, so socket.io-client re-invokes it on every
 * reconnection attempt and a freshly refreshed ID token is used instead of
 * whatever was valid the first time the socket connected.
 *
 * A signed-in user whose token cannot be fetched sends NO identity rather
 * than the browser's guest id: falling back would seat them as a stranger
 * and record their game against nobody. The server refuses an identity-less
 * handshake, and `socketHandlers.ts` retries it while the user is still
 * signed in.
 */
function socketAuth(cb: (data: HandshakeAuth) => void): void {
  const user = auth.currentUser
  const guestId = getGuestId()

  if (user) {
    user
      .getIdToken()
      .then((idToken) => cb({ idToken, guestId: null }))
      .catch(() => cb({ idToken: null, guestId: null }))
  } else {
    cb({ idToken: null, guestId })
  }
}

/**
 * Created once at module load, but deliberately NOT connected.
 *
 * This module is imported for its side effect as soon as the bundle is
 * evaluated — before Firebase has restored a persisted session. If the socket
 * auto-connected, the very first handshake would always be anonymous and a
 * returning signed-in user would be handed a throwaway guest identity by the
 * server. `AuthContext` connects it once `onAuthStateChanged` resolves.
 *
 * `rejectUnauthorized: false` is deliberately absent: it is a Node-only option
 * that disables TLS certificate validation and does nothing in a browser.
 *
 * Reconnection never gives up (no `reconnectionAttempts`, so Socket.IO's
 * default of Infinity): a free-tier cold start or a classroom wi-fi drop can
 * outlast any fixed count, and a socket that stopped trying left every
 * realtime feature dead behind a screen that said the server was up. The delay
 * backs off to at most 10 s. A handshake the SERVER refuses is not retried by
 * Socket.IO at all (`active` goes false); `socketHandlers.ts` retries those.
 */
export const socket: Socket = io(SOCKET_URL, {
  transports: ['websocket', 'polling'],
  autoConnect: false,
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 10_000,
  path: '/socket.io',
  auth: socketAuth,
})

export function getSocket(): Socket {
  return socket
}

export function disconnectSocket(): void {
  socket.disconnect()
}
