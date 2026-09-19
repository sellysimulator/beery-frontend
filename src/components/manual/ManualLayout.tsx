import type { ReactElement, ReactNode } from 'react'
import { Link } from 'react-router-dom'

export interface ManualLayoutProps {
  title: string
  /** One sentence saying who this manual is for. */
  audience: string
  otherManual: { to: string; label: string }
  children: ReactNode
}

/**
 * The frame both manuals share.
 *
 * Manuals are public and backend-independent: a host sends the link to people
 * who have not signed in, have not joined anything, and may be reading it on a
 * phone on the way to the session. Nothing here touches the store, the socket
 * or the API.
 */
export function ManualLayout({
  title,
  audience,
  otherManual,
  children,
}: ManualLayoutProps): ReactElement {
  return (
    <div className="min-h-screen px-6 py-10">
      <article className="mx-auto flex max-w-3xl flex-col gap-6">
        <header className="flex flex-col gap-3 border-b border-border pb-6">
          <nav className="flex flex-wrap gap-4 text-sm">
            <Link to="/" className="text-ink-muted hover:text-brand">
              Back to the start
            </Link>
            <Link to={otherManual.to} className="text-ink-muted hover:text-brand">
              {otherManual.label}
            </Link>
          </nav>
          <h1 className="text-3xl font-bold">{title}</h1>
          <p className="text-ink-muted">{audience}</p>
        </header>

        {children}
      </article>
    </div>
  )
}

export default ManualLayout
