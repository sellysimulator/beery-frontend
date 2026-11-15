import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import type { RoomSummary } from '../../types/game'
import { copyToClipboard } from '../../utils/clipboard'
import { inviteUrl } from '../lobby/roomCode'
import JoinQrOverlay from '../shared/JoinQrOverlay'
import { openHostScreen, startErrorText, statusLabel, statusTone, type StatusTone } from './multihost'

export interface GameCardProps {
  /** Zero-based position in the batch; the card is named `Game <index + 1>`. */
  index: number
  roomCode: string
  /** The server's latest summary of the room; undefined until the first answer. */
  summary: RoomSummary | undefined
  /** The server's last refusal to start this game, until it starts. */
  startError?: string
}

const TONE_CLASS: Record<StatusTone, string> = {
  ready: 'border-success bg-success-soft text-success',
  live: 'border-info bg-info-soft text-info',
  over: 'border-border-strong bg-surface-sunken text-ink-muted',
  waiting: 'border-border bg-surface text-ink-muted',
  gone: 'border-danger bg-danger-soft text-danger',
}

/**
 * One game of the batch: its code, invite link (copy, a small QR, a
 * full-screen QR), its status and seats, and a way into its host screen.
 *
 * The status is a word as well as a colour (rule 11): the tone only repeats
 * what the label says. A room the server no longer knows gets no QR code and
 * no host-screen button, since nobody can join or run it.
 */
export function GameCard({ index, roomCode, summary, startError }: GameCardProps): ReactElement {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [showQr, setShowQr] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const link = inviteUrl(roomCode)
  const gone = summary !== undefined && !summary.exists
  const closeQr = useCallback(() => setShowQr(false), [])

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )

  async function handleCopy(): Promise<void> {
    const copied = await copyToClipboard(link)
    setCopyState(copied ? 'copied' : 'failed')
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopyState('idle'), 4000)
  }

  const seats =
    summary?.exists && summary.seats_taken !== null
      ? `${summary.seats_taken} / ${summary.seats_total}`
      : '–'

  return (
    <article
      aria-label={`Game ${index + 1}`}
      className={`flex flex-col gap-4 rounded-lg border border-border bg-surface-raised px-5 py-5 ${
        gone ? 'opacity-70' : ''
      }`}
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-wide text-ink-muted">Game {index + 1}</p>
          <p className="numeric text-2xl font-semibold text-brand">{roomCode}</p>
        </div>
        <span
          className={`rounded-full border px-2 py-1 text-xs font-semibold ${TONE_CLASS[statusTone(summary)]}`}
        >
          {statusLabel(summary)}
        </span>
      </header>

      {startError ? (
        <p
          role="alert"
          data-testid="start-error"
          className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {startErrorText(index, roomCode, startError)}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-ink-muted">Seats taken</p>
          <p className="numeric text-xl font-semibold" aria-label="Seats taken">
            {seats}
          </p>
          {summary?.exists && !summary.can_start && summary.start_blocked_reason && !summary.finished &&
          summary.state !== 'RUNNING' && summary.state !== 'PAUSED' ? (
            <p className="text-sm text-ink-muted">{summary.start_blocked_reason}</p>
          ) : null}
        </div>
        {!gone ? (
          <button
            type="button"
            onClick={() => setShowQr(true)}
            aria-label={`Show QR code for game ${roomCode}`}
            className="shrink-0 rounded-md border border-border bg-surface-raised p-1 hover:border-brand"
          >
            <QRCodeSVG value={link} size={96} level="M" marginSize={1} title={`Invite link for room ${roomCode}`} />
          </button>
        ) : null}
      </div>

      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor={`invite-${roomCode}`} className="text-ink-muted">
          Invite link
        </label>
        <input
          id={`invite-${roomCode}`}
          readOnly
          value={link}
          aria-label={`Invite link for game ${roomCode}`}
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 rounded-md border border-border bg-surface px-3 py-2 text-ink"
        />
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="rounded-md border border-border-strong px-3 py-2 hover:border-brand hover:text-brand"
          >
            {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy'}
          </button>
          <button
            type="button"
            onClick={() => setShowQr((shown) => !shown)}
            disabled={gone}
            aria-pressed={showQr}
            className="rounded-md border border-border-strong px-3 py-2 hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:text-ink-subtle"
          >
            Show QR
          </button>
        </div>
      </div>

      {showQr && !gone ? (
        <JoinQrOverlay roomCode={roomCode} inviteUrl={link} onClose={closeQr} />
      ) : null}

      {/* A button, not a link: "open in new tab" from a link would not copy
          this tab's sessionStorage, and the host secret with it. */}
      <button
        type="button"
        onClick={() => openHostScreen(roomCode)}
        disabled={gone}
        className="rounded-md bg-brand px-4 py-2 font-semibold text-ink-inverse transition hover:bg-brand-strong disabled:bg-surface-sunken disabled:text-ink-subtle"
      >
        Open host screen ↗
      </button>
    </article>
  )
}

export default GameCard
