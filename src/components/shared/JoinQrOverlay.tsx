import { useEffect, useId, useRef, type ReactElement } from 'react'
import { QRCodeSVG } from 'qrcode.react'

export interface JoinQrOverlayProps {
  roomCode: string
  /** The invite link the code encodes (`inviteUrl`, `/join/:roomCode`). */
  inviteUrl: string
  onClose: () => void
}

/**
 * A full-screen QR code of a room's invite link, sized to be projected so a
 * class can scan it from their seats.
 *
 * It encodes the player link and nothing else: never a `host_secret`, which
 * would hand host authority to everyone who scans it. The code is drawn in the
 * browser (`qrcode.react`), so the link is never sent to a QR service.
 *
 * Closes on the Close button, Escape, or a click on the backdrop. Focus moves
 * to Close on open and returns to the trigger on close, as `HostControls`'
 * dialog does. `qrcode.react` draws its own white ground behind the modules,
 * so the code keeps the contrast a scanner needs on any surface.
 */
export function JoinQrOverlay({ roomCode, inviteUrl, onClose }: JoinQrOverlayProps): ReactElement {
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previous = document.activeElement
    closeRef.current?.focus()

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 px-4 py-6"
      onClick={onClose}
      data-testid="join-qr-backdrop"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-full w-full max-w-xl flex-col items-center gap-4 overflow-auto rounded-lg border border-border-strong bg-surface-raised px-6 py-6 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={titleId} className="text-sm uppercase tracking-wide text-ink-muted">
          Scan to join room <span className="sr-only">{roomCode}</span>
        </h2>
        <p className="numeric text-figure text-brand" aria-hidden="true">
          {roomCode}
        </p>
        <div className="aspect-square w-full max-w-[min(80vw,60vh)] rounded-md bg-surface-raised p-3">
          <QRCodeSVG
            value={inviteUrl}
            size={512}
            level="M"
            marginSize={2}
            title={`Invite link for room ${roomCode}`}
            style={{ width: '100%', height: '100%' }}
          />
        </div>
        <p className="break-all text-center text-sm text-ink-muted">{inviteUrl}</p>
        <button
          type="button"
          ref={closeRef}
          onClick={onClose}
          className="rounded-md border border-border-strong px-6 py-2 text-sm font-semibold hover:border-brand hover:text-brand"
        >
          Close
        </button>
      </div>
    </div>
  )
}

export default JoinQrOverlay
