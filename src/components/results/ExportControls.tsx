import { useEffect, useState, type ReactElement } from 'react'
import http, { errorMessage } from '../../api/http'
import { useAuth } from '../../auth/AuthContext'
import { getHostSecret, isHostForRoom } from '../../utils/storage'

export interface ExportControlsProps {
  roomCode: string
  /** The game's permanent id; only the persisted record has it. */
  publicId?: string
}

type Format = 'csv' | 'json'

/** What a refused export says, instead of a raw 403 (section 2.4). */
export const EXPORT_FORBIDDEN_MESSAGE =
  'Only the host who created this room can export it.'

function statusOf(err: unknown): number | null {
  const response = (err as { response?: { status?: unknown } } | null | undefined)?.response
  return typeof response?.status === 'number' ? response.status : null
}

/**
 * Hands the downloaded body to the browser.
 *
 * Guarded because `URL.createObjectURL` does not exist in every environment
 * this component renders in; a missing saver must not turn a successful
 * request into a thrown error on the debrief screen.
 */
function saveFile(data: unknown, filename: string): void {
  if (typeof URL.createObjectURL !== 'function') return

  const blob = data instanceof Blob ? data : new Blob([String(data)])
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/**
 * CSV and JSON of the complete week-by-week record, for the host only.
 *
 * Two ways in, both decided by the server (`15 §3.2`, `§9`):
 *  - the host's tab: the stored `host_secret`, presented in `X-Host-Secret` —
 *    never a client-side "I am the host" boolean (**D3**);
 *  - the host's account, in any tab: a signed-in caller the server confirms
 *    hosted this game (`GET /users/me/hosted-games/{publicId}`) downloads by
 *    the game's permanent id with their own token. A guest host gets there by
 *    claiming their results (`GuestClaimPrompt`).
 *
 * Anyone else renders nothing at all rather than a disabled button, because a
 * disabled button is an invitation to try it from devtools.
 *
 * The 24-hour prompt is not decoration: once the room expires only the
 * account way is left, so a guest host who has not signed in by then has
 * nothing left to export.
 */
export function ExportControls({ roomCode, publicId }: ExportControlsProps): ReactElement | null {
  const { mode } = useAuth()
  const [busy, setBusy] = useState<Format | null>(null)
  const [error, setError] = useState('')
  const [hostedId, setHostedId] = useState<string | null>(null)

  const hostTab = isHostForRoom(roomCode)
  const askAccount = !hostTab && mode === 'authenticated' && Boolean(publicId)

  useEffect(() => {
    if (!askAccount || !publicId) return
    let cancelled = false
    http
      .get(`/users/me/hosted-games/${publicId}`)
      .then(() => {
        if (!cancelled) setHostedId(publicId)
      })
      // A 404 means "not the host": the controls stay absent, with nothing to say.
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [askAccount, publicId])

  const byAccount = askAccount && hostedId === publicId
  if (!hostTab && !byAccount) return null

  const secret = hostTab ? getHostSecret(roomCode) : null

  async function download(format: Format): Promise<void> {
    if (!secret && !byAccount) return
    setBusy(format)
    setError('')
    try {
      // The account way needs no header: `http` attaches the signed-in token.
      const response = secret
        ? await http.get(`/games/${roomCode}/export`, {
            params: { format },
            headers: { 'X-Host-Secret': secret },
            responseType: 'blob',
          })
        : await http.get(`/games/id/${publicId}/export`, {
            params: { format },
            responseType: 'blob',
          })
      saveFile(response.data, `beer-game-${roomCode}.${format}`)
    } catch (err) {
      setError(
        statusOf(err) === 403
          ? EXPORT_FORBIDDEN_MESSAGE
          : errorMessage(err, 'The export could not be downloaded.'),
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <section
      data-print="omit"
      aria-label="Export the full record"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised px-5 py-4"
    >
      <h2 className="text-lg font-semibold">Export the full record</h2>
      <p className="text-sm text-ink-muted">
        {byAccount
          ? 'You hosted this game, so your account can download its full record.'
          : "Download now — the room's data expires in 24 hours, and after that only a signed-in host can export it."}
      </p>

      {secret || byAccount ? (
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void download('csv')}
            className="rounded-md border border-border-strong px-4 py-2 font-semibold transition hover:border-brand hover:text-brand disabled:text-ink-subtle"
          >
            {busy === 'csv' ? 'Downloading…' : 'Download CSV'}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void download('json')}
            className="rounded-md border border-border-strong px-4 py-2 font-semibold transition hover:border-brand hover:text-brand disabled:text-ink-subtle"
          >
            {busy === 'json' ? 'Downloading…' : 'Download JSON'}
          </button>
        </div>
      ) : (
        <p className="text-sm text-ink-muted">
          This tab no longer holds the room&apos;s host key, so it cannot download the
          record.
        </p>
      )}

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  )
}

export default ExportControls
