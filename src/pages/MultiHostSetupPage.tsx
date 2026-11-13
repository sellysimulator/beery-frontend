import { useEffect, useState, type FormEvent, type ReactElement } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { errorMessage } from '../api/http'
import { createRoomBatch, listPresets } from '../api/rooms'
import { useLimits } from '../components/config/useLimits'
import Select from '../components/shared/Select'
import type { PresetSummary } from '../types/game'
import {
  MAX_DISPLAY_NAME_LENGTH,
  getDisplayName,
  setDisplayName,
  setHostBatch,
  setHostSecret,
} from '../utils/storage'
import type { RouteDescriptor } from '../routes/registry'

/**
 * `/multihost/new`: how many games, which preset, and the name to host as —
 * then `POST /rooms/batch-create` makes them all at once and the dashboard
 * (`/multihost`) lists them.
 *
 * Deliberately not the room's whole config form. That form (`components/
 * config`) is bound to a live room — it saves each edit over the socket and
 * previews against the stored config — and every game's host screen still
 * offers it, unchanged, until that game starts. Here the host picks a preset,
 * exactly as `HomePage`'s single create does.
 *
 * The count's range is the server's (`GET /rooms/limits`, `min_batch_rooms` /
 * `max_batch_rooms`); a count outside it is refused, never clamped (rule 12).
 *
 * Every secret is stored **before** navigating, as `HomePage` does: each is
 * returned exactly once, and nothing is stored at all unless every room in the
 * answer carries one, so the dashboard never lists a game it cannot host.
 */
export function MultiHostSetupPage(): ReactElement {
  const navigate = useNavigate()
  const { limits, error: limitsError } = useLimits()

  const [presets, setPresets] = useState<PresetSummary[]>([])
  // Null until the host types: the field shows the server's minimum till then.
  const [countText, setCountText] = useState<string | null>(null)
  const [preset, setPreset] = useState('')
  const [displayName, setName] = useState(() => getDisplayName() ?? '')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  useEffect(() => {
    let cancelled = false
    // A convenience, as on the home page: a failure leaves "Default settings".
    listPresets()
      .then((response) => {
        if (!cancelled) setPresets(response.presets)
      })
      .catch(() => {
        if (!cancelled) setPresets([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const min = limits?.min_batch_rooms ?? null
  const max = limits?.max_batch_rooms ?? null
  const shownCount = countText ?? (min !== null ? String(min) : '')
  const count = /^\d+$/.test(shownCount) ? Number(shownCount) : null
  const countError =
    min === null || max === null
      ? null
      : count === null || count < min || count > max
        ? `Enter a whole number from ${min} to ${max}.`
        : null
  const ready = limits !== null && count !== null && countError === null

  async function handleCreate(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!ready || count === null || creating) return
    setCreating(true)
    setCreateError('')
    try {
      const { rooms } = await createRoomBatch({
        count,
        preset: preset === '' ? null : preset,
        host_display_name: displayName.trim() || 'Host',
      })
      if (rooms.length === 0 || rooms.some((room) => !room.host_secret)) {
        setCreateError('The server returned no host secret for a game. Please try again.')
        return
      }
      setDisplayName(displayName)
      for (const room of rooms) setHostSecret(room.room_code, room.host_secret)
      setHostBatch(rooms.map((room) => room.room_code))
      navigate('/multihost')
    } catch (err) {
      setCreateError(errorMessage(err, 'Could not create the games.'))
    } finally {
      setCreating(false)
    }
  }

  const selectedPreset = presets.find((candidate) => candidate.name === preset)

  return (
    <div className="min-h-screen px-6 py-10">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <Link to="/home" className="text-sm text-ink-muted hover:text-brand">
            ← Back
          </Link>
          <h1 className="text-2xl font-semibold">Host several games</h1>
          <p className="text-ink-muted">
            Create several games at once, each with its own code, invite link and host screen. You
            can still change any game&apos;s settings from its own host screen before it starts.
          </p>
        </header>

        <form
          onSubmit={(event) => void handleCreate(event)}
          className="flex flex-col gap-4 rounded-lg border border-border bg-surface-raised px-5 py-5"
        >
          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor="batch-count">Number of games</label>
            <input
              id="batch-count"
              type="number"
              inputMode="numeric"
              value={shownCount}
              min={min ?? undefined}
              max={max ?? undefined}
              step={1}
              disabled={limits === null}
              onChange={(event) => setCountText(event.target.value)}
              onWheel={(event) => event.currentTarget.blur()}
              aria-invalid={countError !== null}
              aria-describedby="batch-count-hint"
              className="numeric w-32 rounded-md border border-border bg-surface px-3 py-2 text-ink"
            />
            <span
              id="batch-count-hint"
              className={countError ? 'text-danger' : 'text-ink-muted'}
            >
              {limitsError
                ? limitsError
                : countError
                  ? countError
                  : min !== null && max !== null
                    ? `From ${min} to ${max}.`
                    : 'Loading the allowed range…'}
            </span>
          </div>

          <div className="flex flex-col gap-1 text-sm">
            <span id="batch-preset-label">Preset</span>
            <Select
              aria-labelledby="batch-preset-label"
              value={preset}
              onChange={setPreset}
              options={[
                { value: '', label: 'Default settings' },
                ...presets.map((candidate) => ({ value: candidate.name, label: candidate.label })),
              ]}
              className="w-full"
            />
          </div>
          {selectedPreset ? (
            <p className="text-sm text-ink-muted">{selectedPreset.description}</p>
          ) : null}

          <label className="flex flex-col gap-1 text-sm">
            <span>Name to host as</span>
            <input
              type="text"
              value={displayName}
              maxLength={MAX_DISPLAY_NAME_LENGTH}
              onChange={(event) => setName(event.target.value)}
              placeholder="Host"
              className="rounded-md border border-border bg-surface px-3 py-2 text-ink"
            />
          </label>

          {createError ? (
            <p role="alert" className="text-sm text-danger">
              {createError}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={!ready || creating}
            className="rounded-md bg-brand px-4 py-3 font-semibold text-ink-inverse transition hover:bg-brand-strong disabled:bg-surface-sunken disabled:text-ink-subtle"
          >
            {creating ? 'Creating games…' : ready ? `Create ${count} games` : 'Create games'}
          </button>
        </form>
      </div>
    </div>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const route: RouteDescriptor = {
  path: '/multihost/new',
  guard: 'auth+backend',
  element: <MultiHostSetupPage />,
}

export default MultiHostSetupPage
