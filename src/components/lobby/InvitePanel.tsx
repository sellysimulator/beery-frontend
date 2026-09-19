import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'

export interface InvitePanelProps {
  roomCode: string
  /**
   * The invite URL, composed by the caller rather than read from
   * `window.location.origin` here, so a test can drive the panel at any origin.
   */
  inviteUrl: string
}

/**
 * Copies `text` to the clipboard, falling back to a hidden textarea.
 *
 * The Clipboard API is tried whenever it exists and the textarea catches what
 * it refuses, rather than the other way round: `navigator.clipboard` is absent
 * or rejects outside a secure context, and a host running the game on a laptop
 * over plain HTTP on a classroom LAN is exactly that case.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the textarea path below.
  }

  try {
    const field = document.createElement('textarea')
    field.value = text
    field.setAttribute('readonly', '')
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.appendChild(field)
    field.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(field)
    return copied
  } catch {
    return false
  }
}

/**
 * The room code, the invite link, and the two ways a host hands it out.
 *
 * The copy button confirms visibly on purpose: a host who clicks Copy and gets
 * no acknowledgement has no way to tell a silent failure from a success, and
 * finds out in front of a room full of people.
 */
export function InvitePanel({ roomCode, inviteUrl }: InvitePanelProps): ReactElement {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )

  const handleCopy = useCallback(async () => {
    const copied = await copyToClipboard(inviteUrl)
    setCopyState(copied ? 'copied' : 'failed')
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopyState('idle'), 4000)
  }, [inviteUrl])

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface-raised px-5 py-5">
      <div>
        <h2 className="text-sm uppercase tracking-wide text-ink-muted">Room code</h2>
        <p className="numeric text-figure text-brand">{roomCode}</p>
      </div>

      <p className="break-all text-sm text-ink-muted">{inviteUrl}</p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="rounded-md border border-border-strong px-4 py-2 text-sm hover:border-brand hover:text-brand"
        >
          Copy invite link
        </button>
      </div>

      <p role="status" aria-live="polite" className="min-h-5 text-sm">
        {copyState === 'copied' ? (
          <span className="text-success">Copied</span>
        ) : copyState === 'failed' ? (
          <span className="text-danger">
            Could not copy automatically. Select the link above and copy it.
          </span>
        ) : null}
      </p>
    </section>
  )
}

export default InvitePanel
