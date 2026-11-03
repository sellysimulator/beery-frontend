/**
 * What a draft config will play: the customer demand series and each role's
 * lead time, worked out by the server (`POST /rooms/preview`, `10 §3.5b`).
 *
 * This replaced the panel's own copy of the demand generators (2026-11-03).
 * That copy had to reproduce the server's half-up rounding, the ramp's `+ 1`
 * and the seasonal `w - 1` offset exactly, and a lead time was about to need a
 * second copy of the engine's delay arithmetic. The server now runs the
 * functions the engine itself runs, on the draft, and the panel only draws
 * the answer. A draft the server refuses comes back as its own message,
 * naming the field and the range, which the preview shows in place of a chart.
 *
 * The request is debounced while the host types, and answers are remembered
 * by draft, so the lead-time row and the demand chart share one request and
 * switching a value back is instant. Until a draft has an answer the caller
 * shows a placeholder, never a guessed series.
 */
import { useEffect, useState } from 'react'
import { errorMessage } from '../../api/http'
import { previewConfig } from '../../api/rooms'
import type { ConfigPreview } from '../../types/game'

/** Long enough to swallow a typed number, short enough to feel live. */
export const PREVIEW_DEBOUNCE_MS = 300

/** Answers by draft. Small: a host revisits a handful of drafts, not hundreds. */
const MAX_REMEMBERED = 32
const answers = new Map<string, ConfigPreview>()
const inFlight = new Map<string, Promise<ConfigPreview>>()

function isPreview(value: unknown): value is ConfigPreview {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    Array.isArray(candidate.demand_series) &&
    typeof candidate.demand_is_example === 'boolean' &&
    typeof candidate.lead_times === 'object' &&
    candidate.lead_times !== null
  )
}

function remember(key: string, preview: ConfigPreview): void {
  answers.delete(key)
  answers.set(key, preview)
  if (answers.size > MAX_REMEMBERED) {
    const oldest = answers.keys().next().value
    if (oldest !== undefined) answers.delete(oldest)
  }
}

function requestPreview(key: string): Promise<ConfigPreview> {
  // Two callers whose timers fire a moment apart share one request: the
  // second finds either the answer or the request still on its way.
  const known = answers.get(key)
  if (known) return Promise.resolve(known)
  const pending = inFlight.get(key)
  if (pending) return pending
  const request = previewConfig(JSON.parse(key) as object)
    .then((data) => {
      if (!isPreview(data)) throw new Error('The server sent no preview.')
      remember(key, data)
      return data
    })
    .finally(() => {
      inFlight.delete(key)
    })
  inFlight.set(key, request)
  return request
}

export interface ConfigPreviewState {
  /** The server's answer for this exact draft, or null until it arrives. */
  preview: ConfigPreview | null
  /** The server's refusal of this draft, or a failed request, in words. */
  error: string | null
  /** True while this draft has neither an answer nor an error. */
  loading: boolean
}

interface Settled {
  key: string
  preview: ConfigPreview | null
  error: string | null
}

/**
 * The server's preview of `draft`, a whole config in payload shape, or of
 * nothing when `draft` is null.
 */
export function useConfigPreview(draft: object | null): ConfigPreviewState {
  const key = draft === null ? null : JSON.stringify(draft)
  const [settled, setSettled] = useState<Settled | null>(null)
  const remembered = key === null ? undefined : answers.get(key)

  useEffect(() => {
    if (key === null || answers.has(key)) return
    let cancelled = false
    const timer = setTimeout(() => {
      requestPreview(key)
        .then((preview) => {
          if (!cancelled) setSettled({ key, preview, error: null })
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setSettled({
              key,
              preview: null,
              error: errorMessage(err, 'Could not draw the preview.'),
            })
          }
        })
    }, PREVIEW_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [key])

  if (key === null) return { preview: null, error: null, loading: false }
  if (remembered) return { preview: remembered, error: null, loading: false }
  if (settled !== null && settled.key === key) {
    return { preview: settled.preview, error: settled.error, loading: false }
  }
  return { preview: null, error: null, loading: true }
}

/** Tests only: forget every answer, so a test can serve a different one. */
export function resetPreviewCacheForTests(): void {
  answers.clear()
  inFlight.clear()
}
