/**
 * Building the partial config payload the save path sends.
 *
 * The wire shape is a **partial** `GameConfig.to_payload()` — the fields the
 * host changed, and nothing else. The server merges it over the stored config,
 * deeply for `roles`, `visibility`, `bot` and `demand`, so changing one
 * Retailer field must not carry the other three roles along and blank them
 * (`18 section 3.1a`, FM 4).
 *
 * `preset_name` is the one key every edit carries: touching any field means the
 * host is no longer running the preset they picked, and a host must not believe
 * they are running Classic MIT when they are not (`18 section 2`, FM 3).
 */
import type { GameConfig } from '../../types/game'

/** A deeply partial `GameConfig`, in payload shape. */
export type ConfigPatch = Record<string, unknown>

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A nested patch object for one dotted field path.
 *
 * `pathPatch('roles.RETAILER.initial_inventory', 14)` is
 * `{ roles: { RETAILER: { initial_inventory: 14 } } }`.
 */
export function pathPatch(path: string, value: unknown): ConfigPatch {
  const segments = path.split('.')
  const root: ConfigPatch = {}
  let cursor = root

  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      cursor[segment] = value
      return
    }
    const next: ConfigPatch = {}
    cursor[segment] = next
    cursor = next
  })

  return root
}

/**
 * Merges `incoming` over `base`, recursively for plain objects.
 *
 * Arrays replace rather than merge — a `CUSTOM` demand series is one value, not
 * a set of indexed edits — and so does `null`, which is a meaningful value for
 * `random_seed`, `cap`, `production_capacity_per_week` and `preset_name`.
 *
 * Debounced edits accumulate through this, so ten keystrokes across three
 * fields leave one payload carrying all three.
 */
export function mergePatch(base: ConfigPatch, incoming: ConfigPatch): ConfigPatch {
  const merged: ConfigPatch = { ...base }

  for (const [key, value] of Object.entries(incoming)) {
    const existing = merged[key]
    merged[key] =
      isPlainObject(existing) && isPlainObject(value) ? mergePatch(existing, value) : value
  }

  return merged
}

/**
 * The patch as the emitters type it.
 *
 * `Partial<GameConfig>` describes a payload that is partial at the top level
 * only, while the wire contract is partial all the way down: the assertion is
 * the seam between the two, and it is made exactly once, here.
 */
export function asConfigPayload(patch: ConfigPatch): Partial<GameConfig> {
  return patch as Partial<GameConfig>
}

/**
 * The field a FastAPI 422 is complaining about, as a dotted path, or null.
 *
 * FastAPI reports `detail` as an array of objects whose `loc` is a tuple like
 * `['body', 'config', 'demand', 'values']`. The `body` and `config` prefixes
 * are the request envelope rather than anything the host can see, so they are
 * dropped and what remains matches the names this panel registers its inputs
 * under. Anything else — a string `detail`, a network error — yields null and
 * the message is shown at panel level instead.
 */
export function fieldFromValidationError(err: unknown): string | null {
  const detail = (
    err as { response?: { data?: { detail?: unknown } } } | null | undefined
  )?.response?.data?.detail

  if (!Array.isArray(detail)) return null

  for (const entry of detail) {
    if (!isPlainObject(entry)) continue
    const loc = entry.loc
    if (!Array.isArray(loc)) continue

    const segments = loc
      .filter((part): part is string | number => typeof part === 'string' || typeof part === 'number')
      .map(String)
      .filter((part, index) => !(index === 0 && (part === 'body' || part === 'query')))
      .filter((part) => part !== 'config')

    if (segments.length) return segments.join('.')
  }

  return null
}
