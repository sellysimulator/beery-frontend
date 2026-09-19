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

/* ─── display name — DISPLAY DATA, not a credential; browser-scoped ─── */
//
// It lives here with every other browser-storage accessor rather than in a
// per-section helper because BOTH emitters need it: section 17's shells on
// mount, and this section's `rejoinAfterConnect` on every reconnect. The server
// sanitises and truncates it (11 section 2) and it grants nothing, so it is
// deliberately not tab-scoped and not treated as a secret.

const DISPLAY_NAME_KEY = 'display_name'

/** `00-decisions.md` section 5. Exported so section 17's inputs can set `maxLength`. */
export const MAX_DISPLAY_NAME_LENGTH = 24

// Word separators: they must become a space, or the words around them join.
// eslint-disable-next-line no-control-regex
const WHITESPACE_CONTROLS = /[\u0009\u000a\u000b\u000c\u000d]/g

// Everything else in the control range: invisible junk that must simply vanish,
// or one word is split into several.
// eslint-disable-next-line no-control-regex
const OTHER_CONTROLS = /[\u0000-\u0008\u000e-\u001f\u007f]/g

/** A thin read. Sanitisation happens once, on the way in. */
export function getDisplayName(): string | null {
  return localStorage.getItem(DISPLAY_NAME_KEY)
}

/**
 * Stores a name, sanitised. In this order: each WHITESPACE control character
 * becomes a space and every OTHER control character is removed, runs of
 * whitespace collapse to one, the result is trimmed, clamped to
 * `MAX_DISPLAY_NAME_LENGTH`, and trimmed again. A value that sanitises to empty
 * CLEARS the stored name rather than storing `''`.
 *
 * The two classes are treated differently on purpose, and neither blanket rule
 * is correct — each was tried and each mangles a real paste:
 *   - DELETING a whitespace control joins the words around it. `\t`, `\n` and
 *     `\r` are all in U+0000-U+001F, so "strip controls, then collapse" turns
 *     `'Grace\tHopper'` into `'GraceHopper'`. A name pasted out of a spreadsheet
 *     cell is tab-separated, which makes that the common case.
 *   - REPLACING a non-whitespace control with a space splits one word into
 *     several: `'A\u0000n\u0007a'` becomes `'A n a'`. NUL, BEL and ESC are not
 *     word separators, they are invisible junk, and they should vanish.
 *
 * Clamping is followed by a second trim because the length boundary can land on
 * a space and reintroduce a trailing one.
 *
 * One choke point, on the write side, because more than one screen collects a
 * name and a rule applied at each collection point is a rule the next
 * collection point forgets. The server sanitises and truncates regardless
 * (11 section 2), so this is not a security boundary — it is about what the
 * user sees echoed back and what goes out on the wire.
 */
export function setDisplayName(name: string): void {
  const clean = name
    .replace(WHITESPACE_CONTROLS, ' ')
    .replace(OTHER_CONTROLS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_DISPLAY_NAME_LENGTH)
    .trim()

  if (clean.length === 0) {
    localStorage.removeItem(DISPLAY_NAME_KEY)
    return
  }
  localStorage.setItem(DISPLAY_NAME_KEY, clean)
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
