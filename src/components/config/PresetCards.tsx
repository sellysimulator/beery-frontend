import { useEffect, useState, type ReactElement } from 'react'
import { errorMessage } from '../../api/http'
import { listPresets } from '../../api/rooms'
import type { PresetSummary } from '../../types/game'
import { useConfigFormContext } from './configFormContext'
import type { ConfigPatch } from './configPatch'
import { PRESET_COPY } from './copy'

export interface PresetCardsProps {
  /** The preset currently claimed, or null for *Custom*. */
  presetName: string | null
  /** Applies a whole preset: one patch carrying its entire config. */
  onApplyPreset: (patch: ConfigPatch) => void
  /** Drops the claim without changing a value. */
  onClearPreset: () => void
}

/**
 * The three presets, plus *Custom*.
 *
 * Selecting a preset replaces the whole form and sets `preset_name`; editing
 * anything afterwards clears it (`18 section 2`, AC 2 and AC 3). That pairing
 * is the point of the section: a host must not believe they are running Classic
 * MIT when they are not, because "we ran the standard scenario" is the claim
 * the whole debrief rests on.
 *
 * The card copy is this section's, keyed by the preset's name; the label and
 * description the server sends are the fallback, so a preset added later still
 * renders something true rather than nothing.
 */
export function PresetCards({
  presetName,
  onApplyPreset,
  onClearPreset,
}: PresetCardsProps): ReactElement {
  const { readOnly, saveApi } = useConfigFormContext()
  const [presets, setPresets] = useState<PresetSummary[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void listPresets()
      .then((response) => {
        if (!cancelled) setPresets(response.presets)
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(errorMessage(err, 'Could not load the presets.'))
      })

    return () => {
      cancelled = true
    }
  }, [])

  const disabled = readOnly || !saveApi.canSave

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {presets.map((preset) => {
          const copy = PRESET_COPY[preset.name]
          const selected = presetName === preset.name

          return (
            <button
              key={preset.name}
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              onClick={() => onApplyPreset({ ...preset.config, preset_name: preset.name })}
              className={`flex flex-col gap-2 rounded-lg border px-4 py-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
                selected
                  ? 'border-brand-strong bg-brand-soft'
                  : 'border-border bg-surface hover:border-brand'
              }`}
            >
              <span className="text-lg font-semibold text-ink">{copy?.label ?? preset.label}</span>
              <span className="text-sm text-ink-muted">{copy?.description ?? preset.description}</span>
            </button>
          )
        })}

        <button
          type="button"
          disabled={disabled}
          aria-pressed={presetName === null}
          onClick={onClearPreset}
          className={`flex flex-col gap-2 rounded-lg border px-4 py-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
            presetName === null
              ? 'border-brand-strong bg-brand-soft'
              : 'border-border bg-surface hover:border-brand'
          }`}
        >
          <span className="text-lg font-semibold text-ink">Custom</span>
          <span className="text-sm text-ink-muted">
            Your own settings. Changing any field below switches to this.
          </span>
        </button>
      </div>

      {loadError ? <p className="text-sm text-danger">{loadError}</p> : null}
    </div>
  )
}

export default PresetCards
