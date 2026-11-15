import { useState, type ReactElement } from 'react'
import http, { errorMessage } from '../../api/http'
import { markExportDownloaded, wasExportDownloaded } from '../../utils/storage'

export interface ExportControlsProps {
  roomCode: string
  /** The game's permanent id; the export is addressed by it. */
  publicId?: string
}

type Format = 'csv' | 'json'

const FORMATS: ReadonlyArray<{ format: Format; label: string }> = [
  { format: 'csv', label: 'CSV' },
  { format: 'json', label: 'JSON' },
]

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
 * CSV and JSON of the complete week-by-week record, for anyone who can see
 * this results screen (2026-11-14).
 *
 * The export is not bound to the host. A host may be a guest, and a guest
 * host has no account to fall back on once the room or the tab is gone, so
 * every viewer — host included — downloads by the game's permanent id,
 * `GET /games/id/{public_id}/export`, with no secret and no token. The file
 * carries what this screen already shows (names, seats, figures) and no
 * account or credential. The export by room code stays host-only on the
 * server and is not used here.
 *
 * **Once per game and format per browser session.** After a download the
 * button is disabled and says so, from a sessionStorage flag
 * (`markExportDownloaded`). That is a courtesy against an accidental flood of
 * clicks, **not** a guard: storage can be cleared and the route called
 * directly. The real limit is the server's per-address export budget
 * (`core/abuse.py`, 100 an hour across both formats), whose 429 shows here as
 * `errorMessage`'s rate-limit sentence.
 */
export function ExportControls({ roomCode, publicId }: ExportControlsProps): ReactElement | null {
  const [busy, setBusy] = useState<Format | null>(null)
  const [error, setError] = useState('')
  // Re-read on every render; bumped after a download so the button updates.
  const [, setDownloads] = useState(0)

  if (!publicId) return null

  async function download(format: Format): Promise<void> {
    if (!publicId || wasExportDownloaded(publicId, format)) return
    setBusy(format)
    setError('')
    try {
      const response = await http.get(`/games/id/${publicId}/export`, {
        params: { format },
        responseType: 'blob',
      })
      saveFile(response.data, `beer-game-${roomCode}.${format}`)
      markExportDownloaded(publicId, format)
      setDownloads((count) => count + 1)
    } catch (err) {
      setError(errorMessage(err, 'The export could not be downloaded.'))
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
        Every week of every role, as a spreadsheet (CSV) or as data (JSON). Each file can be
        downloaded once per browser session.
      </p>

      <div className="flex flex-wrap gap-3">
        {FORMATS.map(({ format, label }) => {
          const done = wasExportDownloaded(publicId, format)
          return (
            <button
              key={format}
              type="button"
              disabled={busy !== null || done}
              onClick={() => void download(format)}
              className="rounded-md border border-border-strong px-4 py-2 font-semibold transition hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:text-ink-subtle"
            >
              {busy === format
                ? 'Downloading…'
                : done
                  ? `${label} already downloaded this session`
                  : `Download ${label}`}
            </button>
          )
        })}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  )
}

export default ExportControls
