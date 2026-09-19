/**
 * Browser persistence for the three identifiers plus the host UI hint.
 *
 * `00-conventions.md` section 2 keeps `alias`, `session_token` and `identity`
 * strictly apart; this module is the only place any of them touches storage.
 *
 * Scope matters:
 *   - `alias` and `session_token` -> localStorage, so a reload or a second tab
 *     can resume the same seat.
 *   - `host_secret` and the host claim -> sessionStorage, so an invite link
 *     opened in a new tab does NOT inherit host authority from the tab that
 *     created the room. The durability that costs is bought back by D18's
 *     identity recovery, not by widening the storage scope.
 */
import { v4 as uuidv4 } from 'uuid'

/* ─── alias — the PUBLIC id the server assigns ─── */

const ALIAS_KEY = 'alias'

export function getAlias(): string | null {
  return localStorage.getItem(ALIAS_KEY)
}

export function setAlias(alias: string): void {
  localStorage.setItem(ALIAS_KEY, alias)
}

/* ─── guest identity — minted once per browser ─── */

export const GUEST_ID_KEY = 'guest_id'

/** Reads the guest id if one exists. Never creates one. */
export function getGuestId(): string | null {
  return localStorage.getItem(GUEST_ID_KEY)
}

/**
 * Returns this browser's guest identity, minting it on first use.
 *
 * Stable across calls on purpose: a regenerated id loses the player's seat on
 * reconnect, because the server matches a `session_token` against the stored
 * identity before honouring it.
 */
export function getOrCreateGuestId(): string {
  const existing = localStorage.getItem(GUEST_ID_KEY)
  if (existing) return existing

  const minted = `guest_${uuidv4()}`
  localStorage.setItem(GUEST_ID_KEY, minted)
  return minted
}

/* ─── session_token — SECRET, per room ─── */

function sessionTokenKey(roomCode: string): string {
  return `session_token_${roomCode}`
}

export function getSessionToken(roomCode: string): string | null {
  return localStorage.getItem(sessionTokenKey(roomCode))
}

export function setSessionToken(roomCode: string, token: string): void {
  localStorage.setItem(sessionTokenKey(roomCode), token)
}

export function clearSessionToken(roomCode: string): void {
  localStorage.removeItem(sessionTokenKey(roomCode))
}

/* ─── host_secret — SECRET, per room, tab-scoped ─── */

function hostSecretKey(roomCode: string): string {
  return `host_secret_${roomCode}`
}

export function getHostSecret(roomCode: string): string | null {
  return sessionStorage.getItem(hostSecretKey(roomCode))
}

export function setHostSecret(roomCode: string, secret: string): void {
  sessionStorage.setItem(hostSecretKey(roomCode), secret)
}

export function clearHostSecret(roomCode: string): void {
  sessionStorage.removeItem(hostSecretKey(roomCode))
}

/* ─── host claim — UI HINT ONLY, tab-scoped ─── */

const HOST_ROOM_KEY = 'host_room'

/** Marks THIS TAB as the host for a room. Never trusted by the server. */
export function setHostRoom(roomCode: string): void {
  sessionStorage.setItem(HOST_ROOM_KEY, roomCode)
}

export function isHostForRoom(roomCode: string): boolean {
  return sessionStorage.getItem(HOST_ROOM_KEY) === roomCode
}

export function clearHostRoom(): void {
  sessionStorage.removeItem(HOST_ROOM_KEY)
}
