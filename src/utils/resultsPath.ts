/**
 * Where "See the results" points once a game has ended.
 *
 * The permanent `/results/g/:gameId` once the game is persisted; before that
 * (or if persistence failed) the room-code URL, which the results page can
 * still serve from the live `game_finished` payload. A room code is recycled
 * once the room expires, so it is the fallback, never the preference.
 */
export function resultsPath(roomCode: string, gamePublicId: string | null): string {
  return gamePublicId ? `/results/g/${gamePublicId}` : `/results/${roomCode}`
}
