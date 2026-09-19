import { useId, useState, type FormEvent, type ReactElement } from 'react'
import type { PlayerView } from '../../types/game'
import { UPSTREAM_LABEL } from './RoleBanner'

export interface DecisionFormProps {
  view: PlayerView
  /** The open week, from the store. It goes out with the emit as a guard. */
  week: number
  /** Paused, or the game is over: the confirm control is dead (§2.7, FM 10). */
  disabled: boolean
  /** Pre-fills the input when the player reopens a submitted order. */
  initialOrder: number | null
  /** True when this is a re-open of an already-submitted order (§2.4). */
  isChange: boolean
  /** A server refusal to render beside the form, or null. */
  notice: string | null
  onSubmit(order: number): void
  onCancel(): void
}

const BUTTON_CLASS =
  'rounded-md border border-border-strong px-3 py-2 text-sm hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-50'

function weeksPhrase(weeks: number): string {
  return weeks === 1 ? '1 week' : `${weeks} weeks`
}

/**
 * "What you can do" — one number, and everything a player needs to know
 * before choosing it (`beer-game-spec.md` section 9.2).
 *
 * The typed value is the only thing on this screen that lives in component
 * state, and losing it on a refresh is the documented behaviour: a player who
 * reloads mid-decision loses their unconfirmed typing and nothing else
 * (§3.3).
 *
 * The arrival preview is the one client-side arithmetic this screen is
 * allowed: `week + your_state.order_arrival_lead_weeks`, a single number the
 * server computed for exactly this sentence. The form never assembles a lead
 * time out of individual delays — none are sent, because the Retailer and the
 * Factory each break a different term of that sum
 * (`07-game-engine.md` section 3.8).
 */
export function DecisionForm({
  view,
  week,
  disabled,
  initialOrder,
  isChange,
  notice,
  onSubmit,
  onCancel,
}: DecisionFormProps): ReactElement {
  const inputId = useId()
  const [value, setValue] = useState(initialOrder === null ? '' : String(initialOrder))

  const isFactory = view.role === 'FACTORY'
  const supplier = UPSTREAM_LABEL[view.role]
  const label = isFactory
    ? 'How many units to start producing'
    : `How many units to order from ${supplier ?? 'your supplier'}`

  const parsed = Number.parseInt(value, 10)
  const hasNumber = value.trim() !== '' && Number.isFinite(parsed)
  const maximum = view.max_order_quantity
  const aboveMaximum = hasNumber && maximum !== null && parsed > maximum
  const belowMinimum = hasNumber && !view.allow_negative_orders && parsed < 0
  const canSubmit = hasNumber && !aboveMaximum && !belowMinimum && !disabled

  // The server's lead time, added to the store's week. Nothing else.
  const arrivalWeek = week + view.order_arrival_lead_weeks
  const preview = isFactory
    ? `Producing ${parsed} units. It will finish in ${weeksPhrase(
        view.order_arrival_lead_weeks,
      )}, around week ${arrivalWeek}.`
    : `Ordering ${parsed} units. It will reach you in ${weeksPhrase(
        view.order_arrival_lead_weeks,
      )}, around week ${arrivalWeek}.`

  // The lead time is worth knowing before a number is typed, not after: it is
  // the whole reason this game is hard (`beer-game-manual.md` Part 2).
  const emptyPreview = isFactory
    ? `Anything you start now will finish in ${weeksPhrase(
        view.order_arrival_lead_weeks,
      )}, around week ${arrivalWeek}.`
    : `Anything you order now will reach you in ${weeksPhrase(
        view.order_arrival_lead_weeks,
      )}, around week ${arrivalWeek}.`

  const minimumText = view.allow_negative_orders
    ? 'Minimum: none — negative orders are allowed in this game.'
    : 'Minimum 0 units.'
  const maximumText =
    maximum === null ? 'Maximum: none set.' : `Maximum ${maximum} units.`

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!canSubmit) return
    onSubmit(parsed)
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised px-5 py-4"
      aria-label="What you can do"
    >
      <label htmlFor={inputId} className="text-lg font-semibold">
        {label}
      </label>

      <input
        id={inputId}
        name="order"
        type="number"
        inputMode="numeric"
        step={1}
        min={view.allow_negative_orders ? undefined : 0}
        max={maximum ?? undefined}
        value={value}
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
        className="numeric w-full rounded-md border border-border-strong bg-surface px-4 py-3 text-3xl disabled:cursor-not-allowed disabled:opacity-60"
      />

      <p className="text-base text-ink-muted" aria-live="polite">
        {hasNumber ? preview : emptyPreview}
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={BUTTON_CLASS}
          disabled={disabled}
          onClick={() => setValue(String(view.incoming_order))}
        >
          Match incoming order
        </button>
        <button
          type="button"
          className={BUTTON_CLASS}
          disabled={disabled || view.last_order === null}
          onClick={() => setValue(String(view.last_order ?? 0))}
        >
          Repeat last order
        </button>
        <button
          type="button"
          className={BUTTON_CLASS}
          disabled={disabled}
          onClick={() => setValue('0')}
        >
          Order zero
        </button>
      </div>

      <p className="text-sm text-ink-muted">{`${minimumText} ${maximumText}`}</p>

      {aboveMaximum ? (
        <p className="text-sm text-danger">{`That is above the maximum of ${maximum} units.`}</p>
      ) : null}
      {belowMinimum ? (
        <p className="text-sm text-danger">
          Negative orders are not allowed in this game.
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-danger">
          {notice}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-md bg-brand px-5 py-3 text-lg font-semibold text-ink-inverse hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isChange ? 'Confirm the change' : 'Confirm order'}
        </button>
        {isChange ? (
          <button type="button" className={BUTTON_CLASS} onClick={onCancel}>
            Keep my last order
          </button>
        ) : null}
      </div>
    </form>
  )
}

export default DecisionForm
