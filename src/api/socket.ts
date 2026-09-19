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

export function getSocket(): Socket {
  return socket
}

export function disconnectSocket(): void {
  socket.disconnect()
}
