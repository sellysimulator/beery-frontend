import type { ReactElement, ReactNode } from 'react'

export interface ManualSectionProps {
  heading: string
  children: ReactNode
}

/** One headed chapter of a manual. */
export function ManualSection({ heading, children }: ManualSectionProps): ReactElement {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">{heading}</h2>
      {children}
    </section>
  )
}

export default ManualSection
