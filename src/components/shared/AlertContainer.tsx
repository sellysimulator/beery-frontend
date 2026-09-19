import type { ReactElement } from 'react'
import { useGameStore, type Alert } from '../../store/gameStore'

const STYLES: Record<Alert['kind'], string> = {
  info: 'border-info/60 bg-info/10',
  success: 'border-success/60 bg-success/10',
  error: 'border-danger/60 bg-danger/10',
}

/** Icons double the colour signal, so an alert never depends on hue alone. */
const ICONS: Record<Alert['kind'], string> = {
  info: 'i',
  success: '✓',
  error: '✕',
}

const LABELS: Record<Alert['kind'], string> = {
  info: 'Note',
  success: 'Success',
  error: 'Error',
}

/**
 * Renders the store's alert queue. Alerts are written only by socket handlers;
 * this component reads them and offers a manual dismiss.
 */
export function AlertContainer(): ReactElement | null {
  const alerts = useGameStore((state) => state.alerts)
  const dismissAlert = useGameStore((state) => state.dismissAlert)

  if (alerts.length === 0) return null

  return (
    <div
      className="fixed top-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-ink shadow-lg backdrop-blur ${STYLES[alert.kind]}`}
        >
          <span aria-hidden="true" className="mt-0.5 font-bold">
            {ICONS[alert.kind]}
          </span>
          <p className="flex-1 text-sm">
            <span className="sr-only">{LABELS[alert.kind]}: </span>
            {alert.message}
          </p>
          <button
            type="button"
            onClick={() => dismissAlert(alert.id)}
            className="text-ink-subtle hover:text-ink"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}

export default AlertContainer
