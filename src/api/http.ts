import axios, { type AxiosInstance } from 'axios'
import { auth } from '../../firebase'

const API_BASE = import.meta.env.VITE_API_BASE_URL || ''

const http: AxiosInstance = axios.create({
  baseURL: `${API_BASE}/api/v1`,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15_000,
})

/**
 * Attach the Firebase ID token so the backend can verify it. The uid is
 * always derived server-side from the verified token and is never sent in a
 * body or a path (`02-identity-and-auth.md`). Guests have no Firebase user,
 * so no header is added for them.
 */
http.interceptors.request.use(async (config) => {
  const user = auth.currentUser
  if (user) {
    config.headers.Authorization = `Bearer ${await user.getIdToken()}`
  }
  return config
})

/**
 * Turn an unknown error into a string that is always safe to render.
 *
 * FastAPI returns `detail` as a string for `HTTPException` but as an ARRAY of
 * objects for 422 validation errors. Putting that array into React state and
 * rendering it throws "Objects are not valid as a React child (found: object
 * with keys {type, loc, msg, input, ctx, url})", turning a readable validation
 * message into a white screen. Every API error is funnelled through here.
 *
 * The backend's abuse limits come first, by status, whatever the body says:
 * a 429 (rate limit, with `Retry-After` in seconds), a 503 (the room store is
 * full, or the host itself is overloaded) and a 413 (a body over the 64 KB
 * cap) each get one fixed sentence. Then a string `detail` returns the
 * string, an array joins its `msg` values, and anything else — an object,
 * `null`, a bare network error — returns the fallback. A lone object is not a
 * shape FastAPI produces, so digging a `msg` out of one would be guessing at a
 * payload the contract does not define.
 */
export function errorMessage(err: unknown, fallback: string): string {
  const response = (
    err as
      | { response?: { status?: unknown; headers?: unknown; data?: { detail?: unknown } } }
      | null
      | undefined
  )?.response

  if (response?.status === 429) {
    const seconds = retryAfterSeconds(response.headers)
    return seconds === null
      ? 'Too many requests from your network. Please wait a moment and try again.'
      : `Too many requests from your network. Please wait about ${seconds} seconds and try again.`
  }
  if (response?.status === 503) return 'The server is busy right now — please try again in a minute.'
  if (response?.status === 413) return 'That request was too large.'

  const detail = response?.data?.detail

  if (typeof detail === 'string' && detail.trim()) return detail.trim()

  if (Array.isArray(detail)) {
    const messages = detail
      .map((entry) =>
        entry && typeof entry === 'object' && typeof (entry as { msg?: unknown }).msg === 'string'
          ? ((entry as { msg: string }).msg)
          : null,
      )
      .filter((msg): msg is string => Boolean(msg && msg.trim()))
    if (messages.length) return messages.join('; ')
  }

  return fallback
}

/** True for a refusal by the backend's rate limit (HTTP 429). */
export function isRateLimited(err: unknown): boolean {
  return (err as { response?: { status?: unknown } } | null | undefined)?.response?.status === 429
}

/**
 * `Retry-After` as whole seconds, or null when it is absent or not a plain
 * number (the backend only ever sends seconds). Axios lower-cases header
 * names. The browser hides the header unless CORS exposes it, so a null here
 * is normal and the message simply leaves the number out.
 */
function retryAfterSeconds(headers: unknown): number | null {
  const raw = (headers as Record<string, unknown> | null | undefined)?.['retry-after']
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : ''
  if (!/^\d+$/.test(text)) return null
  const seconds = Number(text)
  return seconds > 0 ? seconds : null
}

export default http
