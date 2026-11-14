import { useCallback, useEffect, useState } from 'react'
import { errorMessage } from '../../api/http'
import { getRoomsSummary } from '../../api/rooms'
import type { HostedRoom, RoomSummary } from '../../types/game'

/** How often the dashboard asks for its rooms' seats and state. */
export const SUMMARY_POLL_MS = 5000

export interface RoomsSummaryState {
  /** The latest answer, keyed by room code; a room is absent until it arrives. */
  summaries: Record<string, RoomSummary>
  /**
   * When the request behind `summaries` was **sent** (`Date.now()`), null
   * before the first answer. The dashboard counts a "Start all" from the
   * first answer sent at or after its refresh, so a poll already in flight
   * when the host clicked does not count.
   */
  asOf: number | null
  /** The last refresh's failure, cleared by the next success. */
  error: string | null
  /** Ask again now, outside the interval. */
  refresh: () => void
}

/**
 * Polls `POST /rooms/summary` for the batch's rooms every `SUMMARY_POLL_MS`.
 *
 * REST, not the socket: the dashboard never joins a room's channel (it would
 * receive every room's broadcasts into the one store). It skips a tick while
 * the tab is hidden and asks again as soon as it is shown. `rooms` must be a
 * stable reference — the dashboard keeps it in state.
 */
export function useRoomsSummary(rooms: HostedRoom[]): RoomsSummaryState {
  const [summaries, setSummaries] = useState<Record<string, RoomSummary>>({})
  const [asOf, setAsOf] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    if (rooms.length === 0) return
    let cancelled = false

    function poll(): void {
      if (document.hidden) return
      const sentAt = Date.now()
      getRoomsSummary(rooms)
        .then((answer) => {
          if (cancelled) return
          setSummaries(Object.fromEntries(answer.map((summary) => [summary.room_code, summary])))
          setAsOf(sentAt)
          setError(null)
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(errorMessage(err, 'Could not refresh the games.'))
        })
    }

    poll()
    const timer = window.setInterval(poll, SUMMARY_POLL_MS)
    document.addEventListener('visibilitychange', poll)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', poll)
    }
  }, [rooms, tick])

  return { summaries, asOf, error, refresh }
}
