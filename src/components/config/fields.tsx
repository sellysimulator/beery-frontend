import type { ChangeEvent, FocusEvent, ReactElement } from 'react'
import { errorAt, fieldId, fieldPath, useConfigFormContext } from './configFormContext'
import { pathPatch } from './configPatch'

/**
 * The input primitives the whole panel is built from.
 *
 * Every one of them does the same three things, which is the reason they are
 * primitives rather than markup repeated per section:
 *
 * 1. It renders from React Hook Form, whose values are re-synced from
 *    `useGameStore().config` on every change the server acknowledges
 *    (`18 section 3.0`). Nothing here keeps its own copy of a value, so a clamp
 *    is visible the moment it comes back.
 * 2. It reports three kinds of message in one place: the Zod hint, the note
 *    left when the server stored something other than what was sent, and the
 *    field-level 422.
 * 3. It picks the save timing its control deserves — a switch saves on the
 *    toggle, a number saves debounced and again on blur (`18 section 3.1`).
 */

interface MessagesProps {
  name: string
  hint?: string
  min?: number
  max?: number
  unit?: string
}

/**
 * The note shown when the server stored a different value from the one sent.
 *
 * Naming the limit rather than the value is what tells a host *why* their 500
 * became 104; "Adjusted to 104" reads like a glitch, "Maximum is 104 weeks"
 * reads like a rule.
 */
function clampNote(stored: unknown, min?: number, max?: number, unit?: string): string {
  const suffix = unit ? ` ${unit}` : ''
  if (typeof stored === 'number') {
    if (max !== undefined && stored === max) return `Maximum is ${max}${suffix}.`
    if (min !== undefined && stored === min) return `Minimum is ${min}${suffix}.`
  }
  if (stored === null) return 'The server cleared this value.'
  return `Adjusted to ${String(stored)}${suffix}.`
}

function useFieldMessages({ name, min, max, unit }: MessagesProps) {
  const { form, saveApi } = useConfigFormContext()

  const hintMessage = errorAt(form.formState.errors, name)
  const stored = saveApi.clampedAt(name)
  const clampMessage = stored === undefined ? undefined : clampNote(stored, min, max, unit)
  const serverMessage = saveApi.serverError?.field === name ? saveApi.serverError.message : undefined

  return { hintMessage, clampMessage, serverMessage }
}

interface FieldShellProps {
  name: string
  label: string
  labelHidden?: boolean
  hint?: string
  hintMessage?: string
  clampMessage?: string
  serverMessage?: string
  children: ReactElement
}

function FieldShell({
  name,
  label,
  labelHidden,
  hint,
  hintMessage,
  clampMessage,
  serverMessage,
  children,
}: FieldShellProps): ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={fieldId(name)}
        className={labelHidden ? 'sr-only' : 'text-sm font-medium text-ink'}
      >
        {label}
      </label>
      {hint ? (
        <p id={`${fieldId(name)}-hint`} className="text-xs text-ink-muted">
          {hint}
        </p>
      ) : null}
      {children}
      {serverMessage ? (
        <p id={`${fieldId(name)}-error`} className="text-xs text-danger">
          {serverMessage}
        </p>
      ) : hintMessage ? (
        <p id={`${fieldId(name)}-error`} className="text-xs text-danger">
          {hintMessage}
        </p>
      ) : clampMessage ? (
        <p id={`${fieldId(name)}-error`} className="text-xs text-warning">
          {clampMessage}
        </p>
      ) : null}
    </div>
  )
}

function describedBy(name: string, hint: boolean, message: boolean): string | undefined {
  const ids = [hint ? `${fieldId(name)}-hint` : null, message ? `${fieldId(name)}-error` : null]
    .filter((id): id is string => id !== null)
    .join(' ')
  return ids || undefined
}

const INPUT_CLASS =
  'w-full rounded-md border border-border bg-surface-raised px-2 py-1.5 text-ink numeric disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-subtle'

export interface NumberFieldProps {
  /** The dotted config path, which is also the input name. */
  name: string
  label: string
  /** Grid cells carry the label in the row header, so it is visually hidden. */
  labelHidden?: boolean
  hint?: string
  min?: number
  max?: number
  step?: number
  /** A unit for the clamp note: "Maximum is 104 weeks." */
  unit?: string
  /** An empty input means `null` — "no cap", "no seed" — rather than 0. */
  nullable?: boolean
  placeholder?: string
}

export function NumberField({
  name,
  label,
  labelHidden,
  hint,
  min,
  max,
  step,
  unit,
  nullable,
  placeholder,
}: NumberFieldProps): ReactElement {
  const { form, saveApi, readOnly } = useConfigFormContext()
  const { hintMessage, clampMessage, serverMessage } = useFieldMessages({ name, min, max, unit })

  const registration = form.register(fieldPath(name), {
    setValueAs: (raw: unknown) => {
      if (raw === '' || raw === null || raw === undefined) return nullable ? null : Number.NaN
      return Number(raw)
    },
  })

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    void registration.onChange(event)
    const raw = event.target.value

    if (raw === '') {
      // A blank non-nullable field is a half-typed value, not a save.
      if (nullable) saveApi.save(pathPatch(name, null))
      return
    }

    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return
    saveApi.save(pathPatch(name, parsed))
  }

  function handleBlur(event: FocusEvent<HTMLInputElement>): void {
    void registration.onBlur(event)
    saveApi.flush()
  }

  // A clamp is not a rejection: the value was accepted, it was just adjusted.
  // Marking it `aria-invalid` would tell a screen reader the host has to fix
  // something they do not, so only the two real refusals set the flag, while
  // all three notes stay reachable through `aria-describedby` (section 2.5a).
  const rejected = Boolean(serverMessage ?? hintMessage)
  const described = Boolean(serverMessage ?? hintMessage ?? clampMessage)

  return (
    <FieldShell
      name={name}
      label={label}
      labelHidden={labelHidden}
      hint={hint}
      hintMessage={hintMessage}
      clampMessage={clampMessage}
      serverMessage={serverMessage}
    >
      <input
        {...registration}
        onChange={handleChange}
        onBlur={handleBlur}
        id={fieldId(name)}
        type="number"
        inputMode="decimal"
        step={step ?? 1}
        min={min}
        max={max}
        placeholder={placeholder}
        disabled={readOnly || !saveApi.canSave}
        aria-invalid={rejected || undefined}
        aria-describedby={describedBy(name, Boolean(hint), described)}
        className={INPUT_CLASS}
      />
    </FieldShell>
  )
}

export interface TextFieldProps {
  name: string
  label: string
  hint?: string
  maxLength?: number
}

export function TextField({ name, label, hint, maxLength }: TextFieldProps): ReactElement {
  const { form, saveApi, readOnly } = useConfigFormContext()
  const { hintMessage, clampMessage, serverMessage } = useFieldMessages({ name })

  const registration = form.register(fieldPath(name))

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    void registration.onChange(event)
    saveApi.save(pathPatch(name, event.target.value))
  }

  function handleBlur(event: FocusEvent<HTMLInputElement>): void {
    void registration.onBlur(event)
    saveApi.flush()
  }

  // A clamp is not a rejection: the value was accepted, it was just adjusted.
  // Marking it `aria-invalid` would tell a screen reader the host has to fix
  // something they do not, so only the two real refusals set the flag, while
  // all three notes stay reachable through `aria-describedby` (section 2.5a).
  const rejected = Boolean(serverMessage ?? hintMessage)
  const described = Boolean(serverMessage ?? hintMessage ?? clampMessage)

  return (
    <FieldShell
      name={name}
      label={label}
      hint={hint}
      hintMessage={hintMessage}
      clampMessage={clampMessage}
      serverMessage={serverMessage}
    >
      <input
        {...registration}
        onChange={handleChange}
        onBlur={handleBlur}
        id={fieldId(name)}
        type="text"
        maxLength={maxLength}
        disabled={readOnly || !saveApi.canSave}
        aria-invalid={rejected || undefined}
        aria-describedby={describedBy(name, Boolean(hint), described)}
        className={INPUT_CLASS}
      />
    </FieldShell>
  )
}

export interface SwitchFieldProps {
  name: string
  label: string
  /** The one line saying what this lever teaches. Always rendered. */
  explanation?: string
}

export function SwitchField({ name, label, explanation }: SwitchFieldProps): ReactElement {
  const { form, saveApi, readOnly } = useConfigFormContext()
  const registration = form.register(fieldPath(name))

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    void registration.onChange(event)
    // A toggle is a finished decision, so it saves at once (18 section 3.1).
    saveApi.save(pathPatch(name, event.target.checked), true)
  }

  return (
    <div className="flex items-start gap-3 rounded-md border border-border bg-surface-raised px-3 py-3">
      <input
        {...registration}
        onChange={handleChange}
        id={fieldId(name)}
        type="checkbox"
        disabled={readOnly || !saveApi.canSave}
        aria-describedby={explanation ? `${fieldId(name)}-hint` : undefined}
        className="mt-1 h-5 w-5 accent-[var(--color-brand)]"
      />
      <div className="flex flex-col gap-0.5">
        <label htmlFor={fieldId(name)} className="text-base font-medium text-ink">
          {label}
        </label>
        {explanation ? (
          <p id={`${fieldId(name)}-hint`} className="text-sm text-ink-muted">
            {explanation}
          </p>
        ) : null}
      </div>
    </div>
  )
}

export interface SelectFieldProps {
  name: string
  label: string
  hint?: string
  options: { value: string; label: string }[]
  /** A choice is finished the moment it is made, so it saves at once. */
  onSelect?: (value: string) => void
}

export function SelectField({
  name,
  label,
  hint,
  options,
  onSelect,
}: SelectFieldProps): ReactElement {
  const { form, saveApi, readOnly } = useConfigFormContext()
  const { hintMessage, clampMessage, serverMessage } = useFieldMessages({ name })
  const registration = form.register(fieldPath(name))

  function handleChange(event: ChangeEvent<HTMLSelectElement>): void {
    void registration.onChange(event)
    if (onSelect) {
      onSelect(event.target.value)
      return
    }
    saveApi.save(pathPatch(name, event.target.value), true)
  }

  // A clamp is not a rejection: the value was accepted, it was just adjusted.
  // Marking it `aria-invalid` would tell a screen reader the host has to fix
  // something they do not, so only the two real refusals set the flag, while
  // all three notes stay reachable through `aria-describedby` (section 2.5a).
  const rejected = Boolean(serverMessage ?? hintMessage)
  const described = Boolean(serverMessage ?? hintMessage ?? clampMessage)

  return (
    <FieldShell
      name={name}
      label={label}
      hint={hint}
      hintMessage={hintMessage}
      clampMessage={clampMessage}
      serverMessage={serverMessage}
    >
      <select
        {...registration}
        onChange={handleChange}
        id={fieldId(name)}
        disabled={readOnly || !saveApi.canSave}
        aria-invalid={rejected || undefined}
        aria-describedby={describedBy(name, Boolean(hint), described)}
        className="w-full rounded-md border border-border bg-surface-raised px-2 py-2 text-ink"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  )
}

export interface SliderFieldProps {
  name: string
  label: string
  hint?: string
  min: number
  max: number
  step: number
  /** The words at either end of the track, e.g. "Panicking" / "Steady". */
  lowLabel?: string
  highLabel?: string
}

export function SliderField({
  name,
  label,
  hint,
  min,
  max,
  step,
  lowLabel,
  highLabel,
}: SliderFieldProps): ReactElement {
  const { form, saveApi, readOnly } = useConfigFormContext()
  const { hintMessage, clampMessage, serverMessage } = useFieldMessages({ name, min, max })
  const registration = form.register(fieldPath(name), { valueAsNumber: true })
  const current = form.watch(fieldPath(name))

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    void registration.onChange(event)
    const parsed = Number(event.target.value)
    if (!Number.isFinite(parsed)) return
    saveApi.save(pathPatch(name, parsed))
  }

  function handleBlur(event: FocusEvent<HTMLInputElement>): void {
    void registration.onBlur(event)
    saveApi.flush()
  }

  // A clamp is not a rejection: the value was accepted, it was just adjusted.
  // Marking it `aria-invalid` would tell a screen reader the host has to fix
  // something they do not, so only the two real refusals set the flag, while
  // all three notes stay reachable through `aria-describedby` (section 2.5a).
  const rejected = Boolean(serverMessage ?? hintMessage)
  const described = Boolean(serverMessage ?? hintMessage ?? clampMessage)

  return (
    <FieldShell
      name={name}
      label={label}
      hint={hint}
      hintMessage={hintMessage}
      clampMessage={clampMessage}
      serverMessage={serverMessage}
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <input
            {...registration}
            onChange={handleChange}
            onBlur={handleBlur}
            onPointerUp={() => saveApi.flush()}
            id={fieldId(name)}
            type="range"
            min={min}
            max={max}
            step={step}
            disabled={readOnly || !saveApi.canSave}
            aria-invalid={rejected || undefined}
            aria-describedby={describedBy(name, Boolean(hint), described)}
            className="w-full accent-[var(--color-brand)]"
          />
          <output htmlFor={fieldId(name)} className="numeric w-12 text-right text-ink">
            {typeof current === 'number' ? current : ''}
          </output>
        </div>
        {lowLabel || highLabel ? (
          <div className="flex justify-between text-xs text-ink-subtle">
            <span>{lowLabel}</span>
            <span>{highLabel}</span>
          </div>
        ) : null}
      </div>
    </FieldShell>
  )
}
