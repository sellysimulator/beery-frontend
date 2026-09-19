/**
 * The save path: debounce, transport choice, clamp detection and 422 handling.
 *
 * `config_update` over the socket when it is connected, `PUT /rooms/{code}/config`
 * when it is not (`18 section 3.1`). Field-level changes are debounced at 400 ms;
 * a blur of a numeric input and any switch toggle save immediately, because both
 * are the moment a host has finished deciding.
 *
 * Authority is `host_secret` and nothing else. A client-side "I am the host"
 * boolean is a UI hint and is never sent (**D3**).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { configUpdate } from '../../api/games'
import { errorMessage } from '../../api/http'
import { updateRoomConfig } from '../../api/rooms'
import { socket } from '../../api/socket'
import { useGameStore } from '../../store/gameStore'
import type { GameConfig } from '../../types/game'
import { asConfigPayload, fieldFromValidationError, mergePatch, type ConfigPatch } from './configPatch'

/** 18 section 3.1. Long enough to swallow a typed number, short enough to feel live. */
export const SAVE_DEBOUNCE_MS = 400

export interface ServerFieldError {
  /** A dotted path matching the input names, or null for a panel-level error. */
  field: string | null
  message: string
}

export interface ConfigSaveApi {
  /** Queue a patch. Debounced unless `immediate`. */
  save(patch: ConfigPatch, immediate?: boolean): void
  /** Send whatever is queued now — a numeric input's blur does this. */
  flush(): void
  /** What the server stored for a path, when it differs from what was sent. */
  clampedAt(path: string): unknown
  serverError: ServerFieldError | null
  clearServerError(): void
  /** False when this tab holds no `host_secret`, or the room is locked. */
  canSave: boolean
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Every leaf of a patch, keyed by its dotted path. Arrays are leaves. */
function flattenPatch(patch: ConfigPatch, prefix = ''): Record<string, unknown> {
  const flat: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(patch)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (isPlainObject(value)) {
      Object.assign(flat, flattenPatch(value, path))
    } else {
      flat[path] = value
    }
  }

  return flat
}

/** The value a dotted path names inside the stored config, or undefined. */
export function valueAt(config: GameConfig, path: string): unknown {
  let cursor: unknown = config
  for (const segment of path.split('.')) {
    if (!isPlainObject(cursor)) return undefined
    cursor = cursor[segment]
  }
  return cursor
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => sameValue(item, b[index]))
  }
  if (typeof a === 'number' && typeof b === 'number') {
    // A float round-tripped through JSON can differ in the last bit; a clamp
    // never does, so the note stays for real changes only.
    return Math.abs(a - b) < 1e-9
  }
  return false
}

export function useConfigSave(roomCode: string | null, hostSecret: string | null, locked: boolean): ConfigSaveApi {
  const config = useGameStore((state) => state.config)
  const [serverError, setServerError] = useState<ServerFieldError | null>(null)
  const [clamped, setClamped] = useState<Record<string, unknown>>({})

  const pending = useRef<ConfigPatch | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const submitted = useRef<Record<string, unknown>>({})

  const canSave = !locked && roomCode !== null && hostSecret !== null

  /**
   * A clamp is only visible by comparing what went out with what came back
   * (`18 section 3.1`). The form itself renders from the store, so the value is
   * already correct by the time this runs; the note exists to explain why it
   * changed under the host's hands.
   */
  useEffect(() => {
    if (!config) return
    const sentPaths = Object.entries(submitted.current)
    if (!sentPaths.length) return

    submitted.current = {}
    const differences: Record<string, unknown> = {}
    for (const [path, sent] of sentPaths) {
      const stored = valueAt(config, path)
      if (stored === undefined) continue
      if (!sameValue(stored, sent)) differences[path] = stored
    }
    setClamped(differences)
  }, [config])

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )

  const send = useCallback(
    (patch: ConfigPatch) => {
      if (roomCode === null || hostSecret === null) return

      // Touching any field means the host is no longer running the preset they
      // picked. A preset selection sends its own `preset_name` and is left alone.
      const payload: ConfigPatch =
        'preset_name' in patch ? patch : { ...patch, preset_name: null }

      submitted.current = { ...submitted.current, ...flattenPatch(payload) }
      setServerError(null)

      if (socket.connected) {
        configUpdate({
          room_id: roomCode,
          host_secret: hostSecret,
          config: asConfigPayload(payload),
        })
        return
      }

      void updateRoomConfig(roomCode, asConfigPayload(payload), hostSecret)
        .then((response) => {
          // The same place `config_updated` writes (`18 section 3.0`), and the
          // only one the inputs render from. `setConfig` exists for exactly this
          // (`18 section 3.1b`, `16 section 3`): `applyConfigUpdated` is gated on
          // a per-room `seq` the REST route does not carry, and minting one would
          // make the next genuine socket event look stale and be dropped.
          useGameStore.getState().setConfig(response.config)
        })
        .catch((err: unknown) => {
          submitted.current = {}
          setServerError({
            field: fieldFromValidationError(err),
            message: errorMessage(err, 'Could not save that setting.'),
          })
        })
    },
    [hostSecret, roomCode],
  )

  const flush = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
    const patch = pending.current
    pending.current = null
    if (patch) send(patch)
  }, [send])

  const save = useCallback(
    (patch: ConfigPatch, immediate = false) => {
      // FM 6: with the game running nothing this panel does may reach the wire.
      if (!canSave) return

      pending.current = mergePatch(pending.current ?? {}, patch)

      if (immediate) {
        flush()
        return
      }

      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        timer.current = null
        const queued = pending.current
        pending.current = null
        if (queued) send(queued)
      }, SAVE_DEBOUNCE_MS)
    },
    [canSave, flush, send],
  )

  const clampedAt = useCallback((path: string) => clamped[path], [clamped])

  const clearServerError = useCallback(() => setServerError(null), [])

  // Memoised so the context value the panel builds from it is stable, and a
  // section that has not changed is not re-rendered by a keystroke elsewhere.
  return useMemo(
    () => ({ save, flush, clampedAt, serverError, clearServerError, canSave }),
    [save, flush, clampedAt, serverError, clearServerError, canSave],
  )
}
