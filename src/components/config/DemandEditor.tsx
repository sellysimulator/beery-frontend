import { useState, type ChangeEvent, type DragEvent, type ReactElement } from 'react'
import type { DemandConfig, DemandKind, GameConfig, Limits } from '../../types/game'
import { useConfigFormContext } from './configFormContext'
import {
  DEMAND_KIND_DESCRIPTION,
  DEMAND_KIND_LABEL,
  DEMAND_KINDS,
  DISTRIBUTION_LABEL,
} from './copy'
import { formatCustomValues, parseCustomValues, readDroppedFile } from './customValues'
import DemandPreview from './DemandPreview'
import { NumberField, SelectField } from './fields'
import { pendingDemand } from './formValues'
import { useConfigPreview } from './useConfigPreview'

interface ParameterBlockProps {
  demand: DemandConfig
  durationWeeks: number
  /** The server's ranges (`GET /rooms/limits`), never a copy. */
  limits: Limits
}

function ParameterBlock({ demand, durationWeeks, limits }: ParameterBlockProps): ReactElement | null {
  const quantity = { min: 0, max: limits.max_order_quantity, step: 1 }
  // A step or a ramp start can fall no later than the game's last week, and a
  // step no earlier than week `min_step_week`: the server's rules, read here.
  const lastWeek = Math.min(durationWeeks, limits.max_weeks)
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
          <NumberField
            name="demand.step_week"
            label="Step happens in week"
            hint={`Week ${limits.min_step_week} to ${lastWeek}.`}
            min={limits.min_step_week}
            max={lastWeek}
            step={1}
          />
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
            min={-limits.max_order_quantity}
            max={limits.max_order_quantity}
            step={0.5}
          />
          <NumberField
            name="demand.start_week"
            label="Ramp starts in week"
            hint={`Week 1 to ${lastWeek}.`}
            min={1}
            max={lastWeek}
            step={1}
          />
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
          <NumberField
            name="demand.period_weeks"
            label="Weeks per cycle"
            hint={`${limits.min_period_weeks} to ${limits.max_period_weeks} weeks.`}
            min={limits.min_period_weeks}
            max={limits.max_period_weeks}
            step={1}
            unit="weeks"
          />
          <NumberField
            name="demand.phase"
            label="Phase"
            hint="Radians, up to one full turn either way. 0 starts the cycle at the base level."
            min={-limits.max_phase}
            max={limits.max_phase}
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
            hint={`0 to ${limits.max_order_quantity}.`}
            min={0}
            max={limits.max_order_quantity}
            step={0.5}
          />
          <NumberField
            name="demand.stdev"
            label="Standard deviation"
            hint={`0 to ${limits.max_order_quantity}.`}
            min={0}
            max={limits.max_order_quantity}
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
  /** The stored config: what the server holds, and what the preview starts from. */
  config: GameConfig
  /**
   * A generator the host has just picked that the stored config does not
   * have yet, or null. Its parameters are the server's defaults, so they are
   * shown once the stored config carries them.
   */
  pendingKind: DemandKind | null
  /** Switching generator replaces the whole demand object. */
  onKindChange: (kind: DemandKind) => void
}

/**
 * The customer demand generator, its parameters, and a live preview.
 *
 * Changing the generator sends the new kind alone, carrying nothing across:
 * the server replaces the demand object and fills every parameter with that
 * kind's declared defaults (`18 section 3.1a`), and a `step_week` surviving
 * into a `SEASONAL` config is a scenario nobody described (AC 7, FM 2). Until
 * the stored config comes back with them, the parameter block says it is
 * waiting; this panel keeps no copy of the defaults (2026-11-03).
 *
 * The preview is the server's (`POST /rooms/preview`): the stored config, with
 * the generator the host just picked or the series they are pasting in place
 * of the stored demand, so a host sees what they are about to save.
 *
 * `CUSTOM` has one more client-side block: a series shorter than
 * `duration_weeks` is refused by the server, and a host should not have to
 * submit to find that out (`18 section 3.2`). Every other range here is the
 * server's own (`useLimits`), checked beside the field before anything is sent.
 */
export function DemandEditor({
  config,
  pendingKind,
  onKindChange,
}: DemandEditorProps): ReactElement {
  const { saveApi, readOnly, limits } = useConfigFormContext()
  const durationWeeks = config.duration_weeks
  const demand: DemandConfig = pendingKind === null ? config.demand : pendingDemand(pendingKind)

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

  const storedValues = demand.kind === 'CUSTOM' ? (demand.values ?? []) : []
  const parsed = activeDraft === null ? null : parseCustomValues(activeDraft.text)
  const values = parsed ? parsed.values : storedValues
  const shortfall = Math.max(0, durationWeeks - values.length)
  // Week entries above the order ceiling: the server refuses the series, so
  // the form names them and does not send it (it used to be clamped to 9999).
  const tooLarge = values.filter((value) => value > limits.max_order_quantity)

  function commitCustom(text: string): void {
    setDraft({ kind: demand.kind, text, error: null })
    const result = parseCustomValues(text)
    // Blocked, not clamped: sending a short series, or one with a week above
    // the ceiling, earns a 422 naming the field.
    const fits = result.values.every((value) => value <= limits.max_order_quantity)
    if (result.values.length >= durationWeeks && fits) {
      // The kind goes with the series. Without it a host switching from
      // another generator saved `values` into that generator's object, which
      // ignored them, and the game never became `CUSTOM` (2026-11-03).
      saveApi.save({ demand: { kind: 'CUSTOM', values: result.values } })
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

  // The draft the server previews: the stored config, with the demand the
  // editor is showing. Unchanged, it is the stored config itself, so the
  // lead-time row's request is this one too (answers are keyed by content).
  const previewDraft =
    demand === config.demand && activeDraft === null
      ? config
      : { ...config, demand: demand.kind === 'CUSTOM' ? { kind: 'CUSTOM', values } : demand }
  const preview = useConfigPreview(previewDraft)

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

      {pendingKind !== null && pendingKind !== 'CUSTOM' ? (
        <p role="status" className="text-sm text-ink-muted">
          {`Loading the ${DEMAND_KIND_LABEL[pendingKind]} settings from the server…`}
        </p>
      ) : (
        <ParameterBlock demand={demand} durationWeeks={durationWeeks} limits={limits} />
      )}

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
          {tooLarge.length ? (
            <p role="alert" className="text-sm text-danger">
              {`Each week can be at most ${limits.max_order_quantity}. Too large: ${tooLarge
                .slice(0, 5)
                .join(', ')}. The series is not saved until every week fits.`}
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

      <DemandPreview state={preview} />
    </div>
  )
}

export default DemandEditor
