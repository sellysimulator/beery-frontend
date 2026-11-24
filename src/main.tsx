// Socket listeners are registered here, as a module side effect, BEFORE React
// renders anything. A handler mounted inside a component is registered twice
// under StrictMode and every event is then applied twice.
import './api/socketHandlers'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App'
import { AuthProvider } from './auth/AuthContext'
import { BackendStatusProvider } from './contexts/BackendStatusContext'
import AlertContainer from './components/shared/AlertContainer'
import ErrorBoundary from './components/shared/ErrorBoundary'
import { claimPreloadReload } from './utils/storage'

// After a deploy, an open tab may request chunk files that no longer exist. Reload once.
window.addEventListener('vite:preloadError', (event) => {
  if (!claimPreloadReload()) return
  event.preventDefault()
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* ErrorBoundary is outermost so that a provider throwing is caught too,
        and AlertContainer sits beside App inside the router so an alert can
        render a link. */}
    <ErrorBoundary>
      <AuthProvider>
        <BackendStatusProvider>
          <BrowserRouter>
            <AlertContainer />
            <App />
          </BrowserRouter>
        </BackendStatusProvider>
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
)
