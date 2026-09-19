import type { ReactElement } from 'react'
import { isHostForRoom } from '../../utils/storage'

export interface DebriefNotesProps {
  roomCode: string
}

/**
 * The host's script, verbatim from `beer-game-manual.md` Part 1 Step 7.
 *
 * Host-only and collapsed by default: it is a prompt for the person running
 * the room, not something the room should be reading off the projector while
 * the host talks.
 *
 * The closing point is the one that matters, and it is the reason this panel
 * exists at all — the debrief lands or fails on it.
 */
export function DebriefNotes({ roomCode }: DebriefNotesProps): ReactElement | null {
  if (!isHostForRoom(roomCode)) return null

  return (
    <details
      data-print="omit"
      className="rounded-lg border border-border bg-surface-sunken px-5 py-4"
    >
      <summary className="cursor-pointer font-semibold">Your debrief notes</summary>
      <ol className="mt-3 flex list-decimal flex-col gap-3 pl-5 text-sm text-ink-muted">
        <li>
          <strong className="text-ink">Total cost per role and for the chain.</strong> Ask
          who they think did worst, before revealing it.
        </li>
        <li>
          <strong className="text-ink">The big chart</strong> — true customer demand
          plotted against all four order streams. Customer demand barely moves. The
          Retailer&apos;s orders swing. The Wholesaler&apos;s swing more. The
          Factory&apos;s are wild. That&apos;s the bullwhip effect, and they produced it
          themselves.
        </li>
        <li>
          <strong className="text-ink">The bullwhip ratio</strong> per role — how much
          each stage amplified the variation.
        </li>
        <li>
          Ask each player what they were thinking when they placed their largest order.
          Almost always, the answer is some version of{' '}
          <em>&ldquo;I&apos;d ordered more but nothing was arriving, so I ordered
          again.&rdquo;</em>{' '}
          That&apos;s supply-line underweighting, and it&apos;s the real finding.
        </li>
        <li>
          Point out that no one was incompetent and no one was acting in bad faith. The
          structure produced the outcome.
        </li>
      </ol>
    </details>
  )
}

export default DebriefNotes
