import type { ReactElement } from 'react'
import { Link } from 'react-router-dom'

export interface ManualLinkProps {
  to: string
  label: string
}

/**
 * The manual link that follows a participant through the session.
 *
 * It floats rather than living in a header because the question it answers —
 * "what does backlog actually cost me?" — arrives mid-decision, and a player
 * who has to leave the screen to look it up will guess instead.
 */
export function ManualLink({ to, label }: ManualLinkProps): ReactElement {
  return (
    <Link
      to={to}
      className="fixed bottom-4 right-4 z-40 rounded-full border border-border-strong bg-surface-raised px-4 py-2 text-sm shadow-lg hover:border-brand hover:text-brand"
    >
      {label}
    </Link>
  )
}

export default ManualLink
