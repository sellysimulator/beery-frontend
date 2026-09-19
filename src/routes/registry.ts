import type { ReactElement } from 'react'

/**
 * Route assembly by page discovery (D19).
 *
 * `App.tsx` names no page component. Every module in `src/pages/` contributes
 * by exporting `route` — a descriptor, or an array of them for a page that
 * also owns a redirect — and the registry collects them in module-name order.
 * Adding a screen means dropping in a file; nothing upstream is edited.
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
 * The collection logic, over an explicit module record — the testable form.
 *
 * `collectRoutes({})` is the empty case, and stays assertable for the life of
 * the project. The live `discoverRoutes()` cannot serve that purpose because
 * `import.meta.glob` is expanded at transform time: once section 17 ships
 * pages, it can never return `[]` again.
 */
export function collectRoutes(modules: Record<string, unknown>): RouteDescriptor[] {
  const routes: RouteDescriptor[] = []

  for (const path of Object.keys(modules).sort()) {
    const module = modules[path]
    if (!module || typeof module !== 'object') continue

    const exported = (module as Record<string, unknown>).route
    if (Array.isArray(exported)) {
      routes.push(...exported.filter(isRouteDescriptor))
    } else if (isRouteDescriptor(exported)) {
      routes.push(exported)
    }
  }

  return routes
}

/**
 * Every `route` export found in `src/pages/`, in module-name order.
 *
 * `import.meta.glob` yields `{}` when the directory is empty or absent, so the
 * registry works before any page exists.
 */
export function discoverRoutes(): RouteDescriptor[] {
  return collectRoutes(import.meta.glob('../pages/*.tsx', { eager: true }))
}
