import { Route, Routes } from 'react-router-dom'
import type { ReactElement } from 'react'
import { discoverRoutes, type RouteGuard } from './routes/registry'
import AuthGuard from './components/shared/AuthGuard'
import BackendGuard from './components/shared/BackendGuard'
import NotFound from './components/shared/NotFound'

/**
 * Wraps a page element in the guards its descriptor names. Guards compose
 * outside-in: auth first, so an unidentified visitor is redirected instead of
 * being made to wait on a cold-starting backend.
 */
function withGuards(element: ReactElement, guard: RouteGuard): ReactElement {
  let wrapped = element
  if (guard === 'backend' || guard === 'auth+backend') {
    wrapped = <BackendGuard>{wrapped}</BackendGuard>
  }
  if (guard === 'auth' || guard === 'auth+backend') {
    wrapped = <AuthGuard>{wrapped}</AuthGuard>
  }
  return wrapped
}

/**
 * Renders only the `<Routes>`. No router and no provider live here — `main.tsx`
 * owns those — which is what lets a test render `<App />` inside a
 * `<MemoryRouter initialEntries={[...]}>` at any path.
 *
 * No page component is named. The table is assembled from whatever modules
 * exist in `src/pages/` (D19), so sections 17, 21 and 22 add screens by
 * dropping in a file. With `src/pages/` empty every path falls through to the
 * shared `NotFound`.
 */
export default function App(): ReactElement {
  const routes = discoverRoutes()

  return (
    <Routes>
      {routes.map((descriptor) => (
        <Route
          key={`${descriptor.path}:${descriptor.guard}`}
          path={descriptor.path}
          element={withGuards(descriptor.element, descriptor.guard)}
        />
      ))}
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
