/**
 * Backend wake-up probe.
 *
 * `GET /api/v1/health` is deliberately dependency-free server-side: the
 * frontend polls it as a cold-start probe (a free-tier host sleeps and takes
 * 30-60 seconds to come back), and a health check that needed the database
 * would turn a slow database into an app that appears dead.
 *
 * The fetch is plain on purpose — no axios interceptors on the wake-up path,
 * and no second base URL to keep in sync.
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL || ''

const PROBE_TIMEOUT_MS = 8_000

/**
 * True when the backend answered 2xx *with the health payload*. False on any
 * error. Never throws.
 *
 * A 2xx alone is not enough. When `VITE_API_BASE_URL` is empty in a deployed
 * build, this requests `/api/v1/health` from the Hosting origin, whose `**`
 * rewrite answers `200 text/html` with `index.html` — so a probe that trusted
 * `res.ok` declared a backend that was never contacted to be awake, let the
 * app through, and left the real failure to surface later as an unexplained
 * socket error. Requiring `{"status":"ok"}` makes a misconfigured build fail
 * at the wake-up screen, where the wait is already explained.
 */
export async function checkHealth(): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    try {
      const res = await fetch(`${API_BASE}/api/v1/health`, {
        method: 'GET',
        signal: controller.signal,
        cache: 'no-store',
      })
      if (!res.ok) return false
      const body: unknown = await res.json()
      return (
        typeof body === 'object' &&
        body !== null &&
        (body as { status?: unknown }).status === 'ok'
      )
    } finally {
      clearTimeout(timer)
    }
  } catch {
    // Includes the SyntaxError from `res.json()` when the answer is HTML.
    return false
  }
}
