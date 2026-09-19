import { useState, type ReactElement, type ReactNode } from 'react'

export interface ConfigSectionProps {
  /** Used for the heading and panel ids, so the toggle is properly labelled. */
  id: string
  title: string
  description?: string
  /** A control that belongs to the section header, such as *Apply to all*. */
  action?: ReactNode
  children: ReactNode
}

/**
 * One collapsible block of the configuration panel.
 *
 * Sections open by default and collapse on request, rather than the other way
 * round: a host meets this screen once, under time pressure, in front of a
 * waiting class, and a form whose fields are all hidden behind closed
 * disclosures reads as an empty page.
 *
 * The toggle is a real button carrying `aria-expanded` and `aria-controls`, so
 * the panel is operable from the keyboard end to end (AC 19) and a screen
 * reader announces the state rather than the caret.
 */
export function ConfigSection({
  id,
  title,
  description,
  action,
  children,
}: ConfigSectionProps): ReactElement {
  const [open, setOpen] = useState(true)

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="rounded-lg border border-border bg-surface-raised"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <h3 id={`${id}-heading`} className="text-xl font-semibold text-ink">
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            aria-controls={`${id}-panel`}
            className="flex items-center gap-2 text-left hover:text-brand-strong"
          >
            <span aria-hidden="true" className="text-ink-subtle">
              {open ? '–' : '+'}
            </span>
            {title}
          </button>
        </h3>
        {action}
      </div>

      <div id={`${id}-panel`} hidden={!open} className="flex flex-col gap-4 px-5 pb-5">
        {description ? <p className="text-sm text-ink-muted">{description}</p> : null}
        {children}
      </div>
    </section>
  )
}

export default ConfigSection
