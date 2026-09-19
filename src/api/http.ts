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
 * A string `detail` returns the string, an array joins its `msg` values, and
 * anything else — an object, `null`, a bare network error — returns the
 * fallback. A lone object is not a shape FastAPI produces, so digging a `msg`
 * out of one would be guessing at a payload the contract does not define.
 */
export function errorMessage(err: unknown, fallback: string): string {
  const response = (err as { response?: { data?: { detail?: unknown } } } | null | undefined)
    ?.response
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

export default http
