/**
 * Helpers for the multi-game host dashboard (`pages/MultiHostDashboard.tsx`).
 * A plain `.ts` module: a component file may export only its component
 * (react-refresh/only-export-components).
 */
import type { HostedRoom, RoomSummary } from '../../types/game'
import { getHostSecret, setHostRoom } from '../../utils/storage'

/**
 * The batch's rooms with the secret this tab holds for each. A room whose
 * secret is missing is sent with an empty one, so the server answers
 * `exists: false` for it rather than the dashboard dropping it silently.
 */
export function hostedRooms(roomCodes: string[]): HostedRoom[] {
  return roomCodes.map((room_code) => ({ room_code, host_secret: getHostSecret(room_code) ?? '' }))
}

/**
 * Opens a room's existing host screen (`/host/:roomCode`) in a new tab.
 *
 * Each game gets its own tab because the host screen holds one room per tab:
 * one socket, one store, one `host_room`. `window.open` WITHOUT `noopener`
 * makes the browser copy this tab's sessionStorage into the new one, so it
 * starts with `host_room` set to this room and every `host_secret_<code>` the
 * dashboard stored. With `noopener` — or an `<a target="_blank">`, which
 * implies it — the new tab would start with empty sessionStorage and would
 * have to fall back on D18's identity recovery, which a room made over REST
 * cannot offer until some tab has claimed it with the secret.
 *
 * `host_room` is set first because the copy is taken when the tab opens.
 */
export function openHostScreen(roomCode: string): void {
  setHostRoom(roomCode)
  window.open(`/host/${encodeURIComponent(roomCode)}`, '_blank')
}

/**
 * The card's one-line status, worded from the server's summary. Formatting
 * only: every fact in it — the state, the week, the length, whether it can
 * start — is a field the server sent.
 */
export function statusLabel(summary: RoomSummary | undefined): string {
  if (!summary) return 'Loading…'
  if (!summary.exists) return 'Expired or not found'
  if (summary.state === 'ABANDONED') return 'Ended'
  if (summary.finished) return 'Finished'
  if (summary.state === 'PAUSED') return `Paused in week ${summary.week} of ${summary.duration_weeks}`
  if (summary.state === 'RUNNING') return `Week ${summary.week} of ${summary.duration_weeks}`
  if (summary.can_start) return 'Ready to start'
  return 'Waiting for players'
}

/** How the card's status reads at a glance: a token pair, never the only signal. */
export type StatusTone = 'ready' | 'live' | 'over' | 'waiting' | 'gone'

export function statusTone(summary: RoomSummary | undefined): StatusTone {
  if (!summary) return 'waiting'
  if (!summary.exists) return 'gone'
  if (summary.finished) return 'over'
  if (summary.state === 'RUNNING' || summary.state === 'PAUSED') return 'live'
  return summary.can_start ? 'ready' : 'waiting'
}
