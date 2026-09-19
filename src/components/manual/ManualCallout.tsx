import type { ReactElement, ReactNode } from 'react'

export interface ManualCalloutProps {
  title: string
  children: ReactNode
}

/** A pulled-out rule or tip — the parts a reader skims back to. */
export function ManualCallout({ title, children }: ManualCalloutProps): ReactElement {
  return (
    <aside className="rounded-lg border border-brand bg-brand-soft px-4 py-4">
      <p className="font-semibold">{title}</p>
      <div className="mt-1 text-sm text-ink-muted">{children}</div>
    </aside>
  )
}

export default ManualCallout
