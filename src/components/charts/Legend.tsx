import type { ReactElement } from 'react'

export interface LegendSwatch {
  kind: 'line' | 'fill'
  color: string
  dash?: readonly number[]
  width?: number
}

export interface LegendItem {
  key: string
  label: string
  swatch: LegendSwatch
}

export interface LegendProps {
  items: readonly LegendItem[]
  /** With `onToggle`: switch mode. The keys that are switched off. */
  hidden?: ReadonlySet<string>
  onToggle?: (key: string) => void
  /** Hover and focus emphasis: the key, or `null` when it ends. */
  onFocusItem?: (key: string | null) => void
  /** The group's name. */
  ariaLabel?: string
}

/**
 * A swatch drawn as the series itself: the line with its dash, or a filled
 * square. It is decorative (`aria-hidden`), so it never leaks into the
 * control's accessible name, which is exactly the series label.
 */
function Swatch({ swatch }: { swatch: LegendSwatch }): ReactElement {
  if (swatch.kind === 'line') {
    return (
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 28 8"
        className="h-2 w-7 shrink-0"
      >
        <line
          x1="0"
          y1="4"
          x2="28"
          y2="4"
          stroke={swatch.color}
          strokeWidth={swatch.width ?? 2.5}
          strokeDasharray={swatch.dash && swatch.dash.length > 0 ? swatch.dash.join(' ') : undefined}
        />
      </svg>
    )
  }
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 12 12" className="h-3 w-3 shrink-0">
      <rect width="12" height="12" fill={swatch.color} />
    </svg>
  )
}

/**
 * The one legend every chart uses. It is real DOM rather than the canvas
 * legend Chart.js paints, so it works with a keyboard and a screen reader
 * (`21 §2.2a`). Given `onToggle` each item is a `role="switch"` button named
 * after its series; without it the legend is a static list.
 */
export function Legend({
  items,
  hidden,
  onToggle,
  onFocusItem,
  ariaLabel = 'Show or hide a series',
}: LegendProps): ReactElement {
  if (!onToggle) {
    return (
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {items.map((item) => (
          <li
            key={item.key}
            data-series={item.key}
            className="flex items-center gap-2 text-sm text-ink-muted"
            onMouseEnter={onFocusItem ? () => onFocusItem(item.key) : undefined}
            onMouseLeave={onFocusItem ? () => onFocusItem(null) : undefined}
          >
            <Swatch swatch={item.swatch} />
            <span>{item.label}</span>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div data-print="omit" role="group" aria-label={ariaLabel} className="flex flex-wrap items-center gap-2">
      {items.map((item) => {
        const shown = !hidden?.has(item.key)
        return (
          <button
            key={item.key}
            type="button"
            role="switch"
            aria-checked={shown}
            data-series={item.key}
            onClick={() => onToggle(item.key)}
            onMouseEnter={onFocusItem ? () => onFocusItem(item.key) : undefined}
            onMouseLeave={onFocusItem ? () => onFocusItem(null) : undefined}
            onFocus={onFocusItem ? () => onFocusItem(item.key) : undefined}
            onBlur={onFocusItem ? () => onFocusItem(null) : undefined}
            className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-semibold transition ${
              shown
                ? 'border-border-strong bg-surface-raised text-ink'
                : 'border-border bg-surface-sunken text-ink-subtle line-through'
            }`}
          >
            <Swatch swatch={item.swatch} />
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

export default Legend
