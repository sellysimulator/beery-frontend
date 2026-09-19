import type { ReactElement, ReactNode } from 'react'
import { useBackendStatus } from '../../contexts/BackendStatusContext'
import BackendWakeUp from './BackendWakeUp'

/**
 * Renders `BackendWakeUp` until the health probe succeeds, and the route's own
 * content once it does. Public routes — the welcome screen and the manuals —
 * are not wrapped in this and render without waiting.
 */
export function BackendGuard(props: { children: ReactNode }): ReactElement {
  const { status } = useBackendStatus()
  if (status !== 'ok') return <BackendWakeUp />
  return <>{props.children}</>
}

export default BackendGuard
