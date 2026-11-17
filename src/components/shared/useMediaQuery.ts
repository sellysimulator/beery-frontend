import { useCallback, useSyncExternalStore } from 'react'

/**
 * Follows a media query, subscribing rather than polling.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`: the query is an
 * external store and React has a hook for exactly that, which also keeps the
 * first render truthful instead of painting a wrong answer and correcting it.
 *
 * `matchMedia` is guarded because jsdom only grows one when `setup.ts` fills it
 * in, and a component that throws in a test harness is a component nobody can
 * assert anything about.
 *
 * It lived privately in `BoardViewToggle.tsx` until the 3D board's touch
 * controls (24 §5.7) needed the same answer for `(any-pointer: coarse)`. Two
 * copies of a subscription are two subscriptions that drift, so there is one.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void): (() => void) => {
      if (typeof window.matchMedia !== 'function') return () => {}
      const list = window.matchMedia(query)
      list.addEventListener('change', onStoreChange)
      return () => list.removeEventListener('change', onStoreChange)
    },
    [query],
  )

  const getSnapshot = useCallback((): boolean => {
    if (typeof window.matchMedia !== 'function') return false
    return window.matchMedia(query).matches
  }, [query])

  return useSyncExternalStore(subscribe, getSnapshot)
}

export default useMediaQuery
