import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { checkHealth } from '../api/health'
import { reconnectIfGaveUp } from '../api/socket'

export interface BackendStatusValue {
  status: 'checking' | 'ok' | 'down'
  /** Whole seconds since this wake-up attempt began. Resets on `retry()`. */
  elapsed: number
  retry(): void
}

const BackendStatusContext = createContext<BackendStatusValue | undefined>(undefined)

const POLL_INTERVAL_MS = 3000
const ELAPSED_TICK_MS = 1000

/**
 * Starts the health-check loop for the whole app lifetime — one provider, one
 * interval. It checks on mount and then every 3000 ms while the status is not
 * `ok`, and stops polling once it is, because a free-tier host cold-starts in
 * 30-60 seconds and a route that needs the backend must not look dead while it
 * wakes.
 *
 * It also counts the seconds the wait has lasted. `BackendWakeUp` turns that
 * into a progress bar and a message that changes as the wait goes on: a
 * spinner alone gives a player no way to tell a 40-second cold start from an
 * app that has hung.
 */
export function BackendStatusProvider(props: { children: ReactNode }): ReactElement {
  const [status, setStatus] = useState<BackendStatusValue['status']>('checking')
  const [elapsed, setElapsed] = useState(0)
  // Bumped by `retry()` to restart the loop with an immediate probe.
  const [cycle, setCycle] = useState(0)
  // Set in the effect below, never during render: reading the clock while
  // rendering is impure (react-hooks/purity).
  const startedAt = useRef(0)

  useEffect(() => {
    startedAt.current = Date.now()
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | undefined

    const probe = () => {
      void checkHealth().then((ok) => {
        if (cancelled) return
        setStatus(ok ? 'ok' : 'down')
        if (ok && timer !== undefined) {
          clearInterval(timer)
          timer = undefined
        }
      })
    }

    probe()
    timer = setInterval(probe, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      if (timer !== undefined) clearInterval(timer)
    }
  }, [cycle])

  // A socket that exhausted its retries while the backend slept would stay
  // dead after the wake-up; the moment the backend answers, restart it.
  useEffect(() => {
    if (status === 'ok') reconnectIfGaveUp()
  }, [status])

  // The ticker is separate from the probe so that it stops the moment the
  // backend answers: once the app is through, nothing re-renders every second.
  useEffect(() => {
    if (status === 'ok') return
    const tick = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt.current) / ELAPSED_TICK_MS))
    }, ELAPSED_TICK_MS)
    return () => clearInterval(tick)
  }, [status, cycle])

  const retry = useCallback(() => {
    // `startedAt` is reset by the probe effect that the cycle bump re-runs.
    setElapsed(0)
    setStatus('checking')
    setCycle((n) => n + 1)
  }, [])

  const value = useMemo<BackendStatusValue>(
    () => ({ status, elapsed, retry }),
    [status, elapsed, retry],
  )

  return (
    <BackendStatusContext.Provider value={value}>
      {props.children}
    </BackendStatusContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useBackendStatus(): BackendStatusValue {
  const ctx = useContext(BackendStatusContext)
  if (!ctx) {
    throw new Error('useBackendStatus must be used inside <BackendStatusProvider>')
  }
  return ctx
}
