/**
 * The one URL of a finished game's results: `/results/:publicId` (spec §9.8,
 * **D22**).
 *
 * The `public_id` arrives in `game_persisted` once the game is written; until
 * then there is no results URL, and the end-of-game screens say the results
 * are being saved. Never a room code: codes are recycled, so a code names no
 * particular game. The link needs no secret, no live room and no browser
 * storage, and it never expires.
 */
export function resultsPath(publicId: string): string {
  return `/results/${publicId}`
}
