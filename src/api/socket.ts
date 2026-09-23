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
 * (`02-identity-and-auth.md`, `resolve_identity`).
 *
 * It is a CALLBACK, not an object, so socket.io-client re-invokes it on every
 * reconnection attempt and a freshly refreshed ID token is used instead of
 * whatever was valid the first time the socket connected.
 */
function socketAuth(cb: (data: HandshakeAuth) => void): void {
  const user = auth.currentUser
  const guestId = getGuestId()

  if (user) {
    user
      .getIdToken()
      .then((idToken) => cb({ idToken, guestId: null }))
      .catch(() => cb({ idToken: null, guestId }))
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
 */
export const socket: Socket = io(SOCKET_URL, {
  transports: ['websocket', 'polling'],
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  path: '/socket.io',
  auth: socketAuth,
})

/**
 * Called by `BackendStatusProvider` when the health probe first answers ok.
 *
 * `reconnectionAttempts: 10` can run out inside a 30-60 s free-tier cold
 * start, after which Socket.IO stops trying for good and every realtime
 * feature is dead behind a wake-up screen that says the server is up.
 * `connect()` restarts that; while a retry loop is still running it is a
 * no-op, because the manager does not re-open mid-reconnect.
 *
 * `active` is false until something has called `connect()` (or after a
 * deliberate `disconnect()`), so this never makes the first connection: that
 * belongs to `AuthContext`, once the identity is known.
 */
export function reconnectIfGaveUp(): void {
  if (socket.active && !socket.connected) socket.connect()
}

export function getSocket(): Socket {
  return socket
}

export function disconnectSocket(): void {
  socket.disconnect()
}
