import { Check, ChevronDown } from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react'

export interface SelectOption<V extends string = string> {
  value: V
  label: string
  /**
   * A second, quieter line under the label. It is how a disabled option says
   * *why* it is disabled ("Taken by Ana"), because a greyed-out row with no
   * reason reads as a bug.
   */
  detail?: string
  disabled?: boolean
}

export interface SelectProps<V extends string = string> {
  /** The chosen value. `null`, or a value no option carries, shows the placeholder. */
  value: V | null
  options: readonly SelectOption<V>[]
  onChange: (value: V) => void
  /** Shown on the trigger while nothing is chosen. */
  placeholder?: string
  disabled?: boolean
  /** Lets a `<label htmlFor>` name the control. */
  id?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
  /** `sm` for a control that sits inside a row of text, `md` for a form field. */
  size?: 'sm' | 'md'
  /** Width and layout classes for the outer wrapper, e.g. `w-full`. */
  className?: string
}

const TRIGGER_SIZE: Record<NonNullable<SelectProps['size']>, string> = {
  sm: 'gap-2 px-2.5 py-1 text-sm',
  md: 'gap-3 px-3 py-2',
}

/**
 * The one dropdown in the app, in place of the browser's native `<select>`.
 *
 * A native select draws its popup with the operating system's chrome — a grey
 * system list on macOS, a blue highlight on Windows — which is the one part of
 * every screen the bone-and-amber theme could not reach. This draws the popup
 * itself, in the theme's tokens, and keeps the behaviour a native select gives
 * for free.
 *
 * It is the WAI-ARIA "select-only combobox": a `button` with
 * `role="combobox"` that keeps focus the whole time, and a `listbox` whose
 * active option is pointed at by `aria-activedescendant`. Keyboard: Up/Down
 * and Home/End move, Enter or Space chooses, Escape and Tab close, and typing
 * a letter jumps to the next option starting with it. Disabled options are
 * still listed — a seat that is taken should be seen to be taken — but are
 * skipped by the keys and ignore clicks.
 *
 * **Never put it inside a `<label>`.** A click on an option would bubble to
 * the label, which re-clicks the trigger and opens the list again. Name it
 * with `<label htmlFor={id}>`, `aria-labelledby` or `aria-label` instead.
 */
export function Select<V extends string = string>({
  value,
  options,
  onChange,
  placeholder = 'Choose…',
  disabled = false,
  id,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  size = 'md',
  className = '',
}: SelectProps<V>): ReactElement {
  const generatedId = useId()
  const triggerId = id ?? `${generatedId}-trigger`
  const listboxId = `${generatedId}-listbox`
  const optionId = (index: number): string => `${generatedId}-option-${index}`

  const [expanded, setOpen] = useState(false)
  // A list left open when the control becomes disabled would otherwise stay
  // open with nothing able to close it but a click elsewhere.
  const open = expanded && !disabled
  const [activeIndex, setActiveIndex] = useState(-1)
  const rootRef = useRef<HTMLDivElement>(null)
  const typeahead = useRef({ text: '', at: 0 })

  const selectedIndex = options.findIndex((option) => option.value === value)
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null

  const enabledIndexes = options
    .map((option, index) => (option.disabled ? -1 : index))
    .filter((index) => index >= 0)

  // A click anywhere outside closes the list, as a native select does.
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  // Keep the active option in view in a list long enough to scroll. jsdom has
  // no `scrollIntoView`, hence the optional call.
  useEffect(() => {
    if (!open || activeIndex < 0) return
    const node = document.getElementById(`${generatedId}-option-${activeIndex}`)
    node?.scrollIntoView?.({ block: 'nearest' })
  }, [open, activeIndex, generatedId])

  function openList(index: number = selectedIndex): void {
    if (disabled) return
    const start = enabledIndexes.includes(index) ? index : (enabledIndexes[0] ?? -1)
    setActiveIndex(start)
    setOpen(true)
  }

  function choose(index: number): void {
    const option = options[index]
    if (!option || option.disabled) return
    setOpen(false)
    if (option.value !== value) onChange(option.value)
  }

  function step(delta: 1 | -1): void {
    if (enabledIndexes.length === 0) return
    const position = enabledIndexes.indexOf(activeIndex)
    const next =
      position === -1
        ? delta === 1
          ? 0
          : enabledIndexes.length - 1
        : Math.min(Math.max(position + delta, 0), enabledIndexes.length - 1)
    setActiveIndex(enabledIndexes[next])
  }

  /** The next enabled option whose label starts with what was typed. */
  function matchTyped(key: string): number {
    const now = Date.now()
    const buffer = now - typeahead.current.at < 600 ? typeahead.current.text + key : key
    typeahead.current = { text: buffer, at: now }
    const needle = buffer.toLowerCase()
    const from = open ? activeIndex : selectedIndex
    const ordered = [
      ...enabledIndexes.filter((index) => index > from),
      ...enabledIndexes.filter((index) => index <= from),
    ]
    // Repeating one letter cycles through the options that start with it.
    const repeated = needle.length > 1 && [...needle].every((char) => char === needle[0])
    const target = repeated ? needle[0] : needle
    return ordered.find((index) => options[index].label.toLowerCase().startsWith(target)) ?? -1
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (disabled) return
    const { key } = event

    if (!open) {
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') {
        event.preventDefault()
        openList()
      } else if (key === 'Home' || key === 'End') {
        event.preventDefault()
        openList(key === 'Home' ? enabledIndexes[0] : enabledIndexes[enabledIndexes.length - 1])
      } else if (key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
        const match = matchTyped(key)
        if (match >= 0) openList(match)
      }
      return
    }

    switch (key) {
      case 'ArrowDown':
        event.preventDefault()
        step(1)
        return
      case 'ArrowUp':
        event.preventDefault()
        if (event.altKey) choose(activeIndex)
        else step(-1)
        return
      case 'Home':
        event.preventDefault()
        setActiveIndex(enabledIndexes[0] ?? -1)
        return
      case 'End':
        event.preventDefault()
        setActiveIndex(enabledIndexes[enabledIndexes.length - 1] ?? -1)
        return
      case 'Enter':
      case ' ':
        event.preventDefault()
        choose(activeIndex)
        return
      case 'Escape':
        event.preventDefault()
        setOpen(false)
        return
      case 'Tab':
        // Closes without choosing: a choice here is sent to the server the
        // moment it is made, so leaving the field must not make one.
        setOpen(false)
        return
      default:
        if (key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
          const match = matchTyped(key)
          if (match >= 0) setActiveIndex(match)
        }
    }
  }

  return (
    <div ref={rootRef} className={`relative inline-flex ${className}`}>
      <button
        type="button"
        id={triggerId}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid || undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
        className={`flex w-full items-center justify-between rounded-md border bg-surface-raised text-left text-ink transition-colors ${
          TRIGGER_SIZE[size]
        } ${
          open
            ? 'border-brand ring-2 ring-brand-soft'
            : ariaInvalid
              ? 'border-danger'
              : 'border-border hover:border-border-strong'
        } disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-sunken disabled:text-ink-subtle`}
      >
        <span className={`truncate ${selected ? '' : 'text-ink-subtle'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 transition-transform ${
            disabled ? 'text-ink-subtle' : 'text-brand-strong'
          } ${open ? 'rotate-180' : ''}`}
        />
      </button>

      <ul
        id={listboxId}
        role="listbox"
        aria-labelledby={ariaLabelledBy ?? (ariaLabel ? undefined : triggerId)}
        aria-label={ariaLabel}
        hidden={!open}
        tabIndex={-1}
        className="absolute left-0 top-full z-50 mt-1 max-h-72 w-max min-w-full max-w-[min(22rem,calc(100vw-2rem))] overflow-auto rounded-lg border border-border bg-surface-raised py-1 shadow-lg"
      >
        {options.map((option, index) => {
          const isSelected = index === selectedIndex
          const isActive = index === activeIndex
          return (
            <li
              key={option.value}
              id={optionId(index)}
              role="option"
              aria-selected={isSelected}
              aria-disabled={option.disabled || undefined}
              data-value={option.value}
              // Keeps focus on the trigger, so `onBlur` does not close the
              // list before the click lands.
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => {
                if (!option.disabled) setActiveIndex(index)
              }}
              onClick={() => choose(index)}
              className={`flex items-start gap-2 px-3 py-2 text-sm ${
                option.disabled
                  ? 'cursor-not-allowed text-ink-subtle'
                  : `cursor-pointer text-ink ${isActive ? 'bg-brand-soft' : ''}`
              }`}
            >
              <Check
                aria-hidden="true"
                className={`mt-0.5 h-4 w-4 shrink-0 text-brand-strong ${
                  isSelected ? 'visible' : 'invisible'
                }`}
              />
              <span className="flex flex-col">
                <span className={isSelected ? 'font-semibold' : ''}>{option.label}</span>
                {option.detail ? (
                  <span className="text-xs text-ink-muted">{option.detail}</span>
                ) : null}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default Select
