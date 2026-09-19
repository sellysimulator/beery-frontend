import { useState, type ReactElement } from 'react'
import http, { errorMessage } from '../../api/http'
import { getHostSecret, isHostForRoom } from '../../utils/storage'

export interface ExportControlsProps {
  roomCode: string
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
 * Authority is the stored `host_secret`, presented in `X-Host-Secret` — never
 * a client-side "I am the host" boolean (**D3**). A non-host renders nothing
 * at all rather than a disabled button, because a disabled button is an
 * invitation to try it from devtools.
 *
 * The 24-hour prompt is not decoration: export authority depends on the live
 * room or a registered account (`15 §3.2`), so a guest host who leaves it
 * until tomorrow has nothing left to export.
 */
export function ExportControls({ roomCode }: ExportControlsProps): ReactElement | null {
  const [busy, setBusy] = useState<Format | null>(null)
  const [error, setError] = useState('')

  if (!isHostForRoom(roomCode)) return null

  const secret = getHostSecret(roomCode)

  async function download(format: Format): Promise<void> {
    if (!secret) return
    setBusy(format)
    setError('')
    try {
      const response = await http.get(`/games/${roomCode}/export`, {
        params: { format },
        headers: { 'X-Host-Secret': secret },
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
        Download now — the room&apos;s data expires in 24 hours, and a guest host
        can&apos;t export after that.
      </p>

      {secret ? (
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
