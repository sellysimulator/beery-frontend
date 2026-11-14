/**
 * A config form over a local draft, with no room behind it: the multi-game
 * setup page (`/multihost/new`, 2026-11-14).
 *
 * It is `useConfigSave`'s twin. The lobby's save path sends a patch to the
 * room and renders whatever the server stored; this one sends the patch, with
 * the current draft, to `POST /rooms/preview` and keeps whatever the server
 * validated as the new draft. So the merge rule (`merge_config_patch`: a
 * changed demand kind replaces the block), the new generator's defaults and
 * every range check stay the server's, exactly as in the lobby, and a refusal
 * is the same 422 naming the field. Nothing is stored on the server.
 *
 * The draft only ever holds a config the server accepted. A refused edit
 * leaves it as it was and surfaces as `serverError`; the setup page must not
 * create games while one is showing or while an edit is still on its way
 * (`settled`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { errorMessage } from '../../api/http'
import { previewConfig } from '../../api/rooms'
import type { ConfigPreview, GameConfig } from '../../types/game'
import { mergePatch, type ConfigPatch } from './configPatch'
import { primePreview } from './useConfigPreview'
import {
  SAVE_DEBOUNCE_MS,
  flattenPatch,
  sameValue,
  valueAt,
  type ConfigSaveApi,
  type ServerFieldError,
} from './useConfigSave'

export interface DraftConfigApi {
  /** The last config the server validated, or null until one is set. */
  draft: GameConfig | null
  /** Start over from a whole config the server sent (a preset's). */
  reset(config: GameConfig): void
  /** What the form saves through, as `ConfigSaveApi` is in the lobby. */
  saveApi: ConfigSaveApi
  /** True when no edit is queued or on its way. */
  settled: boolean
}

/**
 * The dotted field a preview 422 names. `GameConfig.from_host_input` answers
 * `"<field>: <message>"` as a string `detail`, and the field is the same
 * dotted path the form registers its inputs under.
 */
export function fieldFromPreviewError(err: unknown): ServerFieldError | null {
  const response = (err as { response?: { status?: unknown; data?: { detail?: unknown } } } | null)
    ?.response
  const detail = response?.data?.detail
  if (response?.status !== 422 || typeof detail !== 'string') return null
  const match = /^([A-Za-z_][\w.]*): (.+)$/s.exec(detail)
  if (!match) return null
  return { field: match[1], message: match[2] }
}

function isConfigPreview(value: unknown): value is ConfigPreview & { config: GameConfig } {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    Array.isArray(candidate.demand_series) &&
    typeof candidate.config === 'object' &&
    candidate.config !== null
  )
}

export function useDraftConfig(): DraftConfigApi {
  const [draft, setDraft] = useState<GameConfig | null>(null)
  const [serverError, setServerError] = useState<ServerFieldError | null>(null)
  const [clamped, setClamped] = useState<Record<string, unknown>>({})
  const [inFlight, setInFlight] = useState(0)
  const [queued, setQueued] = useState(false)

  // The draft the next request builds on. A ref as well as state, because
  // requests are chained: the second edit must merge over the first one's
  // answer, which lands between renders.
  const latest = useRef<GameConfig | null>(null)
  const pending = useRef<ConfigPatch | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chain = useRef<Promise<void>>(Promise.resolve())
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (timer.current !== null) clearTimeout(timer.current)
    }
  }, [])

  const reset = useCallback((config: GameConfig) => {
    latest.current = config
    setDraft(config)
    setServerError(null)
    setClamped({})
  }, [])

  const send = useCallback((patch: ConfigPatch) => {
    // As in the lobby: touching any field means the host is no longer running
    // the preset they picked; a preset selection carries its own name.
    const payload: ConfigPatch = 'preset_name' in patch ? patch : { ...patch, preset_name: null }
    setInFlight((count) => count + 1)
    setServerError(null)

    chain.current = chain.current.then(async () => {
      const base = latest.current
      if (base === null) return
      try {
        const answer: unknown = await previewConfig(base, payload)
        if (!isConfigPreview(answer)) throw new Error('The server sent no config.')
        const config = answer.config
        latest.current = config
        primePreview(config, answer)
        if (!mounted.current) return
        setDraft(config)
        const differences: Record<string, unknown> = {}
        for (const [path, sent] of Object.entries(flattenPatch(payload))) {
          const stored = valueAt(config, path)
          if (stored !== undefined && !sameValue(stored, sent)) differences[path] = stored
        }
        setClamped(differences)
      } catch (err) {
        if (!mounted.current) return
        setServerError(
          fieldFromPreviewError(err) ?? {
            field: null,
            message: errorMessage(err, 'Could not check that setting.'),
          },
        )
      } finally {
        if (mounted.current) setInFlight((count) => count - 1)
      }
    })
  }, [])

  const flush = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
    const patch = pending.current
    pending.current = null
    setQueued(false)
    if (patch) send(patch)
  }, [send])

  const canSave = draft !== null

  const save = useCallback(
    (patch: ConfigPatch, immediate = false) => {
      if (latest.current === null) return
      pending.current = mergePatch(pending.current ?? {}, patch)
      setQueued(true)

      if (immediate) {
        flush()
        return
      }
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = setTimeout(flush, SAVE_DEBOUNCE_MS)
    },
    [flush],
  )

  const clampedAt = useCallback((path: string) => clamped[path], [clamped])
  const clearServerError = useCallback(() => setServerError(null), [])

  const saveApi = useMemo<ConfigSaveApi>(
    () => ({ save, flush, clampedAt, serverError, clearServerError, canSave }),
    [save, flush, clampedAt, serverError, clearServerError, canSave],
  )

  return { draft, reset, saveApi, settled: !queued && inFlight === 0 }
}
