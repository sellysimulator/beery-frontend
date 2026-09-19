import { useId, useState, type ReactNode } from 'react'

export interface TooltipProps {
  /** The explanatory text. Kept in the DOM so it is reachable by assistive tech. */
  text: string
  children: ReactNode
  placement?: 'top' | 'bottom'
}

const PLACEMENT: Record<NonNullable<TooltipProps['placement']>, string> = {
  top: 'bottom-full mb-2',
  bottom: 'top-full mt-2',
}

/**
 * A hover/focus tooltip. It opens on focus as well as hover so the beer game's
 * parameter explanations are reachable by keyboard.
 */
export function Tooltip({ text, children, placement = 'top' }: TooltipProps) {
  const [open, setOpen] = useState(false)
  const id = useId()

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <span aria-describedby={id}>{children}</span>
      <span
        id={id}
        role="tooltip"
        className={`${PLACEMENT[placement]} pointer-events-none absolute left-1/2 z-50 w-max max-w-xs -translate-x-1/2 rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-ink shadow-lg transition-opacity ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {text}
      </span>
    </span>
  )
}

export default Tooltip
