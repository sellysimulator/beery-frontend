import type { ReactElement } from 'react'

/**
 * Route assembly by page discovery (D19).
 *
 * `App.tsx` names no page component. Every module in `src/pages/` contributes
 * by exporting `route` — a descriptor, or an array of them for a page that
 * also owns a redirect — and the registry collects them in module-name order.
 * Adding a screen means dropping in a file; nothing upstream is edited.
 *
 * The registry must work with `src/pages/` empty or absent: section 16 ships
 * no page at all, so `discoverRoutes()` returns `[]` and every path falls
 * through to the shared `NotFound`.
 */

export type RouteGuard = 'public' | 'auth' | 'backend' | 'auth+backend'

export interface RouteDescriptor {
  /** A react-router path, e.g. '/host/:roomCode'. */
  path: string
  guard: RouteGuard
  element: ReactElement
}

const VALID_GUARDS: readonly RouteGuard[] = ['public', 'auth', 'backend', 'auth+backend']

function isRouteDescriptor(value: unknown): value is RouteDescriptor {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<RouteDescriptor>
  return (
    typeof candidate.path === 'string' &&
    candidate.path.length > 0 &&
    typeof candidate.guard === 'string' &&
    VALID_GUARDS.includes(candidate.guard) &&
    candidate.element !== undefined &&
    candidate.element !== null
  )
}

/**
 * Every `route` export found in `src/pages/`, in module-name order.
 *
 * `import.meta.glob` resolves at build time and yields `{}` when the directory
 * is empty or does not exist, which is exactly the state this section ships in.
 */
export function discoverRoutes(): RouteDescriptor[] {
  const modules = import.meta.glob<Record<string, unknown>>('../pages/*.tsx', {
    eager: true,
  })

  const routes: RouteDescriptor[] = []

  for (const path of Object.keys(modules).sort()) {
    const exported = modules[path]?.route
    if (Array.isArray(exported)) {
      routes.push(...exported.filter(isRouteDescriptor))
    } else if (isRouteDescriptor(exported)) {
      routes.push(exported)
    }
  }

  return routes
}
