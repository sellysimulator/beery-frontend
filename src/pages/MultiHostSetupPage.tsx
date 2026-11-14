import { useEffect, useState, type ReactElement } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { errorMessage } from '../api/http'
import { createRoomBatch, listPresets } from '../api/rooms'
import ConfigSections from '../components/config/ConfigSections'
import type { ConfigPatch } from '../components/config/configPatch'
import { useConfigForm } from '../components/config/useConfigForm'
import { useDraftConfig } from '../components/config/useDraftConfig'
import type { PresetSummary } from '../types/game'
import {
  MAX_DISPLAY_NAME_LENGTH,
  getDisplayName,
  setDisplayName,
  setHostBatch,
  setHostSecret,
} from '../utils/storage'
import type { RouteDescriptor } from '../routes/registry'

/** The preset a new draft starts from: the server's default, else its first. */
function startingPreset(presets: PresetSummary[]): PresetSummary | null {
  return presets.find((preset) => preset.is_default) ?? presets[0] ?? null
}

/**
 * `/multihost/new`: how many games, the name to host as, and the whole base
 * config every game in the batch starts with — then `POST /rooms/batch-create`
 * makes them all at once and the dashboard (`/multihost`) lists them.
 *
 * The config is the lobby's own form (`ConfigSections`, `useConfigForm`) over
 * a local draft (`useDraftConfig`) instead of a room (2026-11-14). The draft
 * starts from the server's default preset; the preset cards switch it to
 * another, and any field changes it from there. Every edit is merged,
 * defaulted and checked by `POST /rooms/preview`, exactly as a lobby save is,
 * and the demand chart and lead times are that same server preview. A refused
 * edit is the server's 422 naming the field, and nothing can be created while
 * one is showing, while an edit is still on its way, or while a field holds a
 * value outside its range. Each game's own host screen still offers the form
 * until that game starts.
 *
 * The request carries the preset the draft started from and the validated
 * draft itself as the config patch, so the server builds every room from
 * exactly the config the host saw.
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
  const { draft, reset, saveApi, settled } = useDraftConfig()
  const { form, contextValue, limitsError, activePendingKind, handleKindChange, handleApplyPreset } =
    useConfigForm(draft, saveApi, false)
  const limits = contextValue?.limits ?? null

  const [presetsError, setPresetsError] = useState('')
  // The preset the draft started from, sent as the batch's `preset`.
  const [basePreset, setBasePreset] = useState<string | null>(null)
  // Null until the host types: the field shows the server's minimum till then.
  const [countText, setCountText] = useState<string | null>(null)
  const [displayName, setName] = useState(() => getDisplayName() ?? '')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  useEffect(() => {
    let cancelled = false
    listPresets()
      .then((response) => {
        if (cancelled) return
        const preset = startingPreset(response.presets)
        if (!preset) {
          setPresetsError('The server sent no preset to start from.')
          return
        }
        setBasePreset(preset.name)
        reset({ ...preset.config, preset_name: preset.name })
      })
      .catch((err: unknown) => {
        if (!cancelled) setPresetsError(errorMessage(err, 'Could not load the presets.'))
      })
    return () => {
      cancelled = true
    }
  }, [reset])

  function applyPreset(patch: ConfigPatch): void {
    if (typeof patch.preset_name === 'string') setBasePreset(patch.preset_name)
    handleApplyPreset(patch)
  }

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

  const fieldErrors = Object.keys(form.formState.errors).length > 0
  const configBlocker =
    draft === null
      ? 'Loading the settings…'
      : saveApi.serverError !== null
        ? `Fix this setting first: ${saveApi.serverError.field ? `${saveApi.serverError.field}: ` : ''}${saveApi.serverError.message}`
        : fieldErrors
          ? 'Fix the settings marked above first.'
          : activePendingKind !== null
            ? 'Finish the customer demand settings first.'
            : !settled
              ? 'Checking the settings…'
              : null
  const ready =
    limits !== null && count !== null && countError === null && configBlocker === null

  async function handleCreate(): Promise<void> {
    if (!ready || count === null || draft === null || creating) return
    setCreating(true)
    setCreateError('')
    try {
      const { rooms } = await createRoomBatch({
        count,
        preset: basePreset,
        config: draft,
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

  const panelError = saveApi.serverError?.field === null ? saveApi.serverError.message : null

  return (
    <div className="min-h-screen px-6 py-10">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <Link to="/home" className="text-sm text-ink-muted hover:text-brand">
            ← Back
          </Link>
          <h1 className="text-2xl font-semibold">Host several games</h1>
          <p className="text-ink-muted">
            Create several games at once, each with its own code, invite link and host screen.
            Every game starts with the settings below; you can still change any game&apos;s
            settings from its own host screen before it starts.
          </p>
        </header>

        <section
          aria-label="Games"
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
            <span id="batch-count-hint" className={countError ? 'text-danger' : 'text-ink-muted'}>
              {limitsError
                ? limitsError
                : countError
                  ? countError
                  : min !== null && max !== null
                    ? `From ${min} to ${max}.`
                    : 'Loading the allowed range…'}
            </span>
          </div>

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
        </section>

        {draft !== null && contextValue !== null ? (
          <ConfigSections
            config={draft}
            context={contextValue}
            pendingKind={activePendingKind}
            onKindChange={handleKindChange}
            onApplyPreset={applyPreset}
            onClearPreset={() => saveApi.save({ preset_name: null }, true)}
            showBots={draft.bot_fill_empty_roles}
            notices={
              panelError ? (
                <p role="alert" className="rounded-lg border border-danger bg-danger-soft px-4 py-3 text-sm text-ink">
                  {panelError}
                </p>
              ) : null
            }
          />
        ) : (
          <p
            role={presetsError || limitsError ? 'alert' : undefined}
            className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-ink-muted"
          >
            {presetsError || limitsError || 'Loading the settings…'}
          </p>
        )}

        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised px-5 py-5">
          {createError ? (
            <p role="alert" className="text-sm text-danger">
              {createError}
            </p>
          ) : null}
          {configBlocker !== null && draft !== null ? (
            <p role="status" className="text-sm text-ink-muted">
              {configBlocker}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={!ready || creating}
            className="rounded-md bg-brand px-4 py-3 font-semibold text-ink-inverse transition hover:bg-brand-strong disabled:bg-surface-sunken disabled:text-ink-subtle"
          >
            {creating ? 'Creating games…' : ready ? `Create ${count} games` : 'Create games'}
          </button>
        </div>
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
