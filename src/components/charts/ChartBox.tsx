import { useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react'
import ErrorBoundary from '../shared/ErrorBoundary'
import { useCrosshairGroup } from './plugins/CrosshairGroup'
import { stepCrosshair } from './plugins/crosshairSync'

export interface ChartBoxProps {
  /** Rendered as an HTML heading. */
  title: string
  headingLevel?: 2 | 3 | 4
  caption?: string
  /** On the canvas wrapper, which has `role="img"`. */
  ariaLabel: string
  /** Plot height in px. */
  height: number
  controls?: ReactNode
  legend?: ReactNode
  /** The chart's table of plotted server values. */
  table: ReactNode
  /** The `<Line>` / `<Bar>` element. */
  children: ReactNode
}

/**
 * The frame every chart lives in: heading, caption, controls, legend, the
 * canvas, and the table of the same figures.
 *
 * The table is always in the DOM, once. Hidden, it sits in an `sr-only`
 * wrapper for screen readers; "Show table" makes that same element visible
 * below the chart. A second copy for sighted users would be a second thing to
 * keep in step with the first.
 */
export function ChartBox({
  title,
  headingLevel = 3,
  caption,
  ariaLabel,
  height,
  controls,
  legend,
  table,
  children,
}: ChartBoxProps): ReactElement {
  const [showTable, setShowTable] = useState(false)
  const group = useCrosshairGroup()
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4'

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (group === null) return
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      stepCrosshair(group, 1)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      stepCrosshair(group, -1)
    }
  }

  return (
    <figure className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4">
      <figcaption className="flex items-center gap-3">
        <span className="flex min-w-0 flex-col">
          <Heading className="text-base font-semibold">{title}</Heading>
          {caption ? <span className="text-xs text-ink-muted">{caption}</span> : null}
        </span>
        <button
          type="button"
          aria-pressed={showTable}
          onClick={() => setShowTable((current) => !current)}
          data-print="omit"
          className="ml-auto rounded-md border border-border px-3 py-1 text-sm font-semibold text-ink-muted"
        >
          {showTable ? 'Hide table' : 'Show table'}
        </button>
      </figcaption>
      {controls ? <div data-print="omit">{controls}</div> : null}
      {legend ? <div>{legend}</div> : null}
      <ErrorBoundary
        fallback={
          <p className="text-sm text-ink-muted">
            The chart could not be drawn here. The same figures are in the table that follows it.
          </p>
        }
      >
        <div
          role="img"
          aria-label={ariaLabel}
          className="relative"
          style={{ height: `${height}px` }}
          tabIndex={group === null ? undefined : 0}
          onKeyDown={group === null ? undefined : onKeyDown}
        >
          {children}
        </div>
      </ErrorBoundary>
      <div className={showTable ? 'overflow-auto' : 'sr-only'}>{table}</div>
    </figure>
  )
}

export default ChartBox
