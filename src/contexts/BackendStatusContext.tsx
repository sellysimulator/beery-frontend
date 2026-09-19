import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { checkHealth } from '../api/health'

export interface BackendStatusValue {
  status: 'checking' | 'ok' | 'down'
  retry(): void
}

const BackendStatusContext = createContext<BackendStatusValue | undefined>(undefined)

const POLL_INTERVAL_MS = 3000

/**
 * Starts the health-check loop for the whole app lifetime — one provider, one
 * interval. It checks on mount and then every 3000 ms while the status is not
 * `ok`, and stops polling once it is, because a free-tier host cold-starts in
 * 30-60 seconds and a route that needs the backend must not look dead while it
 * wakes.
 */
export function BackendStatusProvider(props: { children: ReactNode }): ReactElement {
  const [status, setStatus] = useState<BackendStatusValue['status']>('checking')
  // Bumped by `retry()` to restart the loop with an immediate probe.
  const [cycle, setCycle] = useState(0)

  useEffect(() => {
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

  const retry = useCallback(() => {
    setStatus('checking')
    setCycle((n) => n + 1)
  }, [])

  const value = useMemo<BackendStatusValue>(() => ({ status, retry }), [status, retry])

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
