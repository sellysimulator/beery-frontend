import { useState, type ChangeEvent, type DragEvent, type ReactElement } from 'react'
import { FORM_LIMITS } from '../../schemas/configSchema'
import type { CustomDemand, DemandConfig, DemandKind } from '../../types/game'
import { useConfigFormContext } from './configFormContext'
import { pathPatch } from './configPatch'
import { DEMAND_KIND_DESCRIPTION, DEMAND_KIND_LABEL, DISTRIBUTION_LABEL } from './copy'
import { formatCustomValues, parseCustomValues, readDroppedFile } from './customValues'
import { DEMAND_KINDS } from './demandDefaults'
import DemandPreview from './DemandPreview'
import { NumberField, SelectField } from './fields'

const quantity = { min: 0, max: FORM_LIMITS.max_order_quantity, step: 1 }
const week = { min: 1, max: FORM_LIMITS.max_weeks, step: 1, unit: 'weeks' }

function ParameterBlock({ demand }: { demand: DemandConfig }): ReactElement | null {
  switch (demand.kind) {
    case 'CONSTANT':
      return (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumberField name="demand.value" label="Units per week" {...quantity} />
        </div>
      )

    case 'STEP':
      return (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumberField name="demand.initial_value" label="Before the step" {...quantity} />
          <NumberField name="demand.step_week" label="Step happens in week" {...week} />
          <NumberField name="demand.step_value" label="After the step" {...quantity} />
        </div>
      )

    case 'RAMP':
      return (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumberField name="demand.initial_value" label="Starting level" {...quantity} />
          <NumberField
            name="demand.slope_per_week"
            label="Change per week"
            min={-FORM_LIMITS.max_order_quantity}
            max={FORM_LIMITS.max_order_quantity}
            step={0.5}
          />
          <NumberField name="demand.start_week" label="Ramp starts in week" {...week} />
          <NumberField
            name="demand.cap"
            label="Ceiling"
            hint="Leave blank for none."
            placeholder="None"
            nullable
            {...quantity}
          />
        </div>
      )

    case 'SEASONAL':
      return (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumberField name="demand.base" label="Base level" {...quantity} />
          <NumberField name="demand.amplitude" label="Swing above and below" {...quantity} />
          <NumberField name="demand.period_weeks" label="Weeks per cycle" {...week} />
          <NumberField
            name="demand.phase"
            label="Phase"
            hint="Radians. 0 starts the cycle at the base level."
            min={-Math.PI * 2}
            max={Math.PI * 2}
            step={0.1}
          />
        </div>
      )

    case 'STOCHASTIC':
      return (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <SelectField
            name="demand.distribution"
            label="Distribution"
            options={Object.entries(DISTRIBUTION_LABEL).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          <NumberField
            name="demand.mean"
            label="Mean"
            min={0}
            max={FORM_LIMITS.max_unit_value}
            step={0.5}
          />
          <NumberField
            name="demand.stdev"
            label="Standard deviation"
            min={0}
            max={FORM_LIMITS.max_unit_value}
            step={0.5}
          />
          <NumberField name="demand.min" label="Never below" {...quantity} />
          <NumberField name="demand.max" label="Never above" {...quantity} />
        </div>
      )

    case 'CUSTOM':
      return null
  }
}

export interface DemandEditorProps {
  /** The demand the form is showing: the stored object, or a pending kind's defaults. */
  demand: DemandConfig
  durationWeeks: number
  /** Switching generator replaces the whole demand object. */
  onKindChange: (kind: DemandKind) => void
}

/**
 * The customer demand generator, its parameters, and a live preview.
 *
 * Changing the generator replaces the parameter block *and* the demand object
 * with that kind's declared defaults, carrying nothing across: the server does
 * exactly the same with a payload that changes `demand.kind`
 * (`18 section 3.1a`), and a `step_week` surviving into a `SEASONAL` config is a
 * scenario nobody described (AC 7, FM 2).
 *
 * `CUSTOM` is the one generator with a hard client-side block: a series shorter
 * than `duration_weeks` is the single demand error the server rejects rather
 * than clamps, and a host should not have to submit to find that out
 * (`18 section 3.2`).
 */
export function DemandEditor({
  demand,
  durationWeeks,
  onKindChange,
}: DemandEditorProps): ReactElement {
  const { saveApi, readOnly } = useConfigFormContext()

  /**
   * The unsaved paste, tagged with the generator it was typed against.
   *
   * Tagging is what makes switching away from `CUSTOM` and back show the stored
   * series again rather than a leftover draft, without an effect that resets
   * state after the fact — the comparison happens while rendering, so there is
   * never a frame showing the wrong series.
   */
  const [draft, setDraft] = useState<{ kind: DemandKind; text: string; error: string | null } | null>(
    null,
  )
  const activeDraft = draft !== null && draft.kind === demand.kind ? draft : null

  const storedValues = demand.kind === 'CUSTOM' ? (demand as CustomDemand).values : []
  const parsed = activeDraft === null ? null : parseCustomValues(activeDraft.text)
  const values = parsed ? parsed.values : storedValues
  const shortfall = Math.max(0, durationWeeks - values.length)

  function commitCustom(text: string): void {
    setDraft({ kind: demand.kind, text, error: null })
    const result = parseCustomValues(text)
    // Blocked, not clamped: sending a short series earns a 422 naming the field.
    if (result.values.length >= durationWeeks) {
      saveApi.save(pathPatch('demand.values', result.values))
    }
  }

  function handleDrop(event: DragEvent<HTMLTextAreaElement>): void {
    const file = event.dataTransfer.files.item(0)
    if (!file) return
    event.preventDefault()

    void readDroppedFile(file)
      .then((text) => commitCustom(text))
      .catch(() =>
        setDraft((previous) => ({
          kind: demand.kind,
          text: previous?.text ?? '',
          error: 'Could not read that file. Paste the numbers instead.',
        })),
      )
  }

  function handleTextChange(event: ChangeEvent<HTMLTextAreaElement>): void {
    commitCustom(event.target.value)
  }

  const previewDemand: DemandConfig =
    demand.kind === 'CUSTOM' ? { kind: 'CUSTOM', values } : demand

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          name="demand.kind"
          label="Generator"
          options={DEMAND_KINDS.map((kind) => ({ value: kind, label: DEMAND_KIND_LABEL[kind] }))}
          onSelect={(value) => onKindChange(value as DemandKind)}
        />
        <p className="self-end pb-2 text-sm text-ink-muted">
          {DEMAND_KIND_DESCRIPTION[demand.kind]}
        </p>
      </div>

      <ParameterBlock demand={demand} />

      {demand.kind === 'CUSTOM' ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="config-demand-values" className="text-sm font-medium text-ink">
            One week per value
          </label>
          <p id="config-demand-values-hint" className="text-xs text-ink-muted">
            Paste a comma- or newline-separated list, or drop a CSV file here.
          </p>
          <textarea
            name="demand.values"
            id="config-demand-values"
            aria-describedby={
              shortfall > 0
                ? 'config-demand-values-hint config-demand-values-count config-demand-values-error'
                : 'config-demand-values-hint config-demand-values-count'
            }
            aria-invalid={shortfall > 0 || undefined}
            value={activeDraft?.text ?? formatCustomValues(storedValues)}
            onChange={handleTextChange}
            onBlur={() => saveApi.flush()}
            onDrop={handleDrop}
            onDragOver={(event) => event.preventDefault()}
            disabled={readOnly || !saveApi.canSave}
            rows={4}
            className="w-full rounded-md border border-border bg-surface-raised px-3 py-2 font-mono text-ink disabled:cursor-not-allowed disabled:bg-surface-sunken"
          />
          <p id="config-demand-values-count" className="text-sm text-ink-muted">
            {values.length} of {durationWeeks} weeks
          </p>
          {parsed && parsed.rejected.length ? (
            <p className="text-sm text-warning">
              Ignored {parsed.rejected.length} value
              {parsed.rejected.length === 1 ? '' : 's'} that are not whole numbers:{' '}
              {parsed.rejected.slice(0, 5).join(', ')}
            </p>
          ) : null}
          {shortfall > 0 ? (
            <p id="config-demand-values-error" role="alert" className="text-sm text-danger">
              This series is {shortfall} week{shortfall === 1 ? '' : 's'} short of the{' '}
              {durationWeeks}-week game. Add the missing weeks before starting; the server will
              not accept it as it is.
            </p>
          ) : null}
          {activeDraft?.error ? (
            <p className="text-sm text-danger">{activeDraft.error}</p>
          ) : null}
        </div>
      ) : null}

      <DemandPreview demand={previewDemand} durationWeeks={durationWeeks} />
    </div>
  )
}

export default DemandEditor
