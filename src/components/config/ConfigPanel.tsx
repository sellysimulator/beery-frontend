import { useEffect, useState, type ReactElement } from 'react'
import { errorMessage } from '../../api/http'
import { getRoomConfig } from '../../api/rooms'
import { useGameStore } from '../../store/gameStore'
import { getHostSecret } from '../../utils/storage'
import ConfigSections from './ConfigSections'
import ConfigSummary from './ConfigSummary'
import { useConfigForm } from './useConfigForm'
import { useConfigSave } from './useConfigSave'

/**
 * The host configuration panel: the form where a teaching intention becomes a
 * game.
 *
 * It takes no props and reads the store directly, like every screen
 * (`00-conventions.md` section 4). Section 17's host lobby resolves this module
 * by path and name through `shellScreens.ts`, which is the seam that lets this
 * section land without either of us editing the other's file (**D19**).
 *
 * Three rules shape everything below:
 *
 * - **The store is the source of truth** (`18 section 3.0`). Every input renders
 *   from `useGameStore().config`; React Hook Form holds the keystrokes of the
 *   field being edited and nothing else. What the field shows once a save
 *   lands is what the game will actually play.
 * - **The server owns the rules and the numbers.** Every range the form checks
 *   comes from `GET /rooms/limits` (`useLimits`), the same object the server
 *   validates against, so the two cannot disagree. A value outside its range
 *   is refused with a message beside the field and is not sent; the server
 *   refuses one that arrives anyway. Nothing is clamped (2026-11-02). Until the
 *   ranges have arrived the panel shows a loading line, never a guessed range.
 *   The demand preview and the lead times are the server's too
 *   (`POST /rooms/preview`, `useConfigPreview`), and so are a new generator's
 *   defaults: the panel holds no generator, no delay arithmetic and no default
 *   (2026-11-03).
 * - **Authority is `host_secret`.** Every save carries it, over the socket when
 *   connected and over `PUT /rooms/{code}/config` when not. A client-side "I am
 *   the host" boolean is never sent (**D3**).
 *
 * The sections themselves are `ConfigSections`, which holds no state and knows
 * no room; the form state is `useConfigForm`. This panel supplies the room:
 * the store's config, `useConfigSave`, the locked summary and the missing-key
 * notice. The multi-game setup page supplies a local draft instead
 * (`useDraftConfig`) and renders the same sections (2026-11-14).
 */
export function ConfigPanel(): ReactElement {
  const roomCode = useGameStore((state) => state.roomCode)
  const roomState = useGameStore((state) => state.roomState)
  const config = useGameStore((state) => state.config)
  const participants = useGameStore((state) => state.participants)

  const hostSecret = roomCode === null ? null : getHostSecret(roomCode)
  const locked = roomState === 'RUNNING' || roomState === 'PAUSED' || roomState === 'FINISHED'

  const [loadError, setLoadError] = useState<string | null>(null)

  const saveApi = useConfigSave(roomCode, hostSecret, locked)
  const { contextValue, limitsError, activePendingKind, handleKindChange, handleApplyPreset } =
    useConfigForm(config, saveApi, locked)

  /**
   * The host arrives here with a room the server already holds a config for,
   * and `config_updated` only fires on a change. Reading it once over REST is
   * what puts the stored values on screen; after that the socket keeps them
   * current.
   */
  useEffect(() => {
    if (config || roomCode === null || hostSecret === null) return
    let cancelled = false

    void getRoomConfig(roomCode, hostSecret)
      .then((response) => {
        if (!cancelled) useGameStore.getState().setConfig(response.config)
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(errorMessage(err, 'Could not load the current settings.'))
      })

    return () => {
      cancelled = true
    }
  }, [config, hostSecret, roomCode])

  // `config` is compared loosely on purpose. The store types it as
  // `GameConfig | null`, but a caller that replaces the whole state rather than
  // patching it leaves the key `undefined`, and the difference between the two
  // is nothing this panel should crash over: either way there is no config to
  // render yet.
  if (!config) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-ink-muted">
        {loadError ?? 'Loading the current settings…'}
      </p>
    )
  }

  // The summary shows stored values only, and needs no ranges.
  if (locked) {
    return <ConfigSummary config={config} />
  }

  if (!contextValue) {
    return (
      <p
        role={limitsError ? 'alert' : undefined}
        className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-ink-muted"
      >
        {limitsError ?? 'Loading the current settings…'}
      </p>
    )
  }

  const showBots =
    config.bot_fill_empty_roles ||
    (Array.isArray(participants) && participants.some((p) => p.is_bot))
  const panelError = saveApi.serverError?.field === null ? saveApi.serverError.message : null

  return (
    <ConfigSections
      config={config}
      context={contextValue}
      pendingKind={activePendingKind}
      onKindChange={handleKindChange}
      onApplyPreset={handleApplyPreset}
      onClearPreset={() => saveApi.save({ preset_name: null }, true)}
      showBots={showBots}
      notices={
        <>
          {hostSecret === null ? (
            <p role="status" className="rounded-lg border border-warning bg-warning-soft px-4 py-3 text-sm text-ink">
              This tab does not hold this room&apos;s host key, so the settings are read-only here.
              Open the room from the tab you created it in.
            </p>
          ) : null}

          {panelError ? (
            <p role="alert" className="rounded-lg border border-danger bg-danger-soft px-4 py-3 text-sm text-ink">
              {panelError}
            </p>
          ) : null}
        </>
      }
    />
  )
}

export default ConfigPanel
