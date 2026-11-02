import { createContext, useContext, useId, type ReactElement, type ReactNode } from 'react'

const GroupContext = createContext<string | null>(null)

/**
 * Names a set of charts that share one crosshair. Charts inside it pass the
 * id as `plugins.crosshairSync.group`; the id is only ever compared, so
 * `useId`'s value is as good as any.
 */
export function CrosshairGroup({ children }: { children: ReactNode }): ReactElement {
  const id = useId()
  return <GroupContext.Provider value={`crosshair-${id}`}>{children}</GroupContext.Provider>
}

/** The enclosing group's id, or `null` outside any group. */
// eslint-disable-next-line react-refresh/only-export-components
export function useCrosshairGroup(): string | null {
  return useContext(GroupContext)
}

export default CrosshairGroup
