/**
 * The server's ranges for every field the host form checks.
 *
 * The backend is the only copy of these numbers (`app/core/limits.py`, served
 * by `GET /rooms/limits`). The form used to carry its own table, and four of
 * its bounds had drifted from the server's: that is the bug this hook exists
 * to make impossible (2026-11-02). Nothing here falls back to a built-in
 * number when the request fails — a guessed range is exactly the hand-copied
 * value this replaced — so the panel shows the error instead.
 *
 * The response never changes while the app is open, so it is fetched once
 * and shared; a failed fetch is forgotten, so the next mount tries again.
 */
import { useEffect, useState } from 'react'
import { errorMessage } from '../../api/http'
import { getLimits } from '../../api/rooms'
import type { Limits } from '../../types/game'

let pending: Promise<Limits> | null = null

function isLimits(value: unknown): value is Limits {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.max_weeks === 'number' &&
    typeof candidate.max_order_quantity === 'number' &&
    typeof candidate.max_period_weeks === 'number'
  )
}

function loadLimits(): Promise<Limits> {
  if (pending === null) {
    pending = getLimits().then((data) => {
      if (!isLimits(data)) throw new Error('The server sent no setting ranges.')
      return data
    })
    pending.catch(() => {
      pending = null
    })
  }
  return pending
}

export interface LimitsState {
  limits: Limits | null
  error: string | null
}

export function useLimits(): LimitsState {
  const [state, setState] = useState<LimitsState>({ limits: null, error: null })

  useEffect(() => {
    let cancelled = false
    void loadLimits()
      .then((limits) => {
        if (!cancelled) setState({ limits, error: null })
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            limits: null,
            error: errorMessage(err, 'Could not load the allowed ranges for the settings.'),
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return state
}

/** Tests only: forget the shared response, so a test can serve a different one. */
export function resetLimitsCacheForTests(): void {
  pending = null
}
