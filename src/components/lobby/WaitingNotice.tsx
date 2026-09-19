import type { ReactElement, ReactNode } from 'react'
import LoadingSpinner from '../shared/LoadingSpinner'

export interface WaitingNoticeProps {
  /** What is being waited for, and who is holding it up. */
  title: string
  detail?: ReactNode
}

/**
 * Every wait in this app says what is being waited for and who is holding it
 * up (`beer-game-spec.md` section 9.4). A bare spinner tells a player nothing
 * and reads, after twenty seconds, as a broken page — so the spinner is the
 * decoration and the sentence is the content.
 */
export function WaitingNotice({ title, detail }: WaitingNoticeProps): ReactElement {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-border bg-surface-raised px-6 py-8 text-center">
      <LoadingSpinner size="sm" label={title} />
      {detail ? <p className="max-w-md text-sm text-ink-muted">{detail}</p> : null}
    </div>
  )
}

export default WaitingNotice
