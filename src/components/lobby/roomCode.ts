/**
 * The room-code alphabet, and the filter the join field types through.
 *
 * `beer-game-spec.md` section 4.1 fixes an unambiguous alphabet: no `0`/`O`,
 * no `1`/`I`/`L`. The alphabet exists because people read codes aloud across a
 * room, and silently accepting an `O` for a `0` wastes everybody's time — so
 * the input drops what it cannot mean rather than sending it to the server.
 */

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export const ROOM_CODE_LENGTH = 6

/** Uppercases, drops every character outside the alphabet, and clamps. */
export function sanitiseRoomCode(raw: string): string {
  let code = ''
  for (const character of raw.toUpperCase()) {
    if (ROOM_CODE_ALPHABET.includes(character)) code += character
    if (code.length === ROOM_CODE_LENGTH) break
  }
  return code
}
