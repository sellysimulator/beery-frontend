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

/** True when the backend answered 2xx. False on any error. Never throws. */
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
      return res.ok
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return false
  }
}
