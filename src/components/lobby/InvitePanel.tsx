import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { copyToClipboard } from '../../utils/clipboard'
import JoinQrOverlay from '../shared/JoinQrOverlay'

export interface InvitePanelProps {
  roomCode: string
  /**
   * The invite URL, composed by the caller rather than read from
   * `window.location.origin` here, so a test can drive the panel at any origin.
   */
  inviteUrl: string
}

/**
 * The room code, the invite link, and the ways a host hands it out: read the
 * code aloud, copy the link, or put the link up full screen as a QR code for
 * the class to scan (`JoinQrOverlay`, which encodes the player link only).
 *
 * The copy button confirms visibly on purpose: a host who clicks Copy and gets
 * no acknowledgement has no way to tell a silent failure from a success, and
 * finds out in front of a room full of people.
 */
export function InvitePanel({ roomCode, inviteUrl }: InvitePanelProps): ReactElement {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [showQr, setShowQr] = useState(false)
  const closeQr = useCallback(() => setShowQr(false), [])
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
        <button
          type="button"
          onClick={() => setShowQr((shown) => !shown)}
          aria-pressed={showQr}
          className="rounded-md border border-border-strong px-4 py-2 text-sm hover:border-brand hover:text-brand"
        >
          {showQr ? 'Hide QR' : 'Show QR'}
        </button>
      </div>

      {showQr ? (
        <JoinQrOverlay roomCode={roomCode} inviteUrl={inviteUrl} onClose={closeQr} />
      ) : null}

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
