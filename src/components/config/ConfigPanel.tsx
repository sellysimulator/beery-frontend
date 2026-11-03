import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { errorMessage } from '../../api/http'
import { getRoomConfig } from '../../api/rooms'
import { buildConfigFormSchema, type ConfigFormValues } from '../../schemas/configSchema'
import { useGameStore } from '../../store/gameStore'
import type { DemandKind } from '../../types/game'
import { getHostSecret } from '../../utils/storage'
import BotSection from './BotSection'
import ConfigSection from './ConfigSection'
import ConfigSummary from './ConfigSummary'
import DemandEditor from './DemandEditor'
import LengthSection from './LengthSection'
import PresetCards from './PresetCards'
import RoleGrid from './RoleGrid'
import VisibilitySection from './VisibilitySection'
import { ConfigFormContext, type ConfigFormContextValue } from './configFormContext'
import type { ConfigPatch } from './configPatch'
import { TextField } from './fields'
import { toFormValues } from './formValues'
import LeadTimeRow from './LeadTimeRow'
import { useConfigSave } from './useConfigSave'
import { useLimits } from './useLimits'

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
 */
export function ConfigPanel(): ReactElement {
  const roomCode = useGameStore((state) => state.roomCode)
  const roomState = useGameStore((state) => state.roomState)
  const config = useGameStore((state) => state.config)
  const participants = useGameStore((state) => state.participants)

  const hostSecret = roomCode === null ? null : getHostSecret(roomCode)
  const locked = roomState === 'RUNNING' || roomState === 'PAUSED' || roomState === 'FINISHED'

  /**
   * The demand generator the host has just picked, before the server has
   * acknowledged it. It is the one value the panel shows ahead of the store,
   * and it shows only the kind: the parameters are the server's defaults and
   * appear when the stored config does, with a placeholder until then.
   * `toFormValues` ignores it as soon as the stored config agrees, so it
   * expires on its own rather than being cleared by an effect a render later.
   */
  const [pendingKind, setPendingKind] = useState<DemandKind | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const saveApi = useConfigSave(roomCode, hostSecret, locked)
  const { limits, error: limitsError } = useLimits()

  // No config, no values: nothing is rendered until the stored config is here,
  // so the form needs no placeholder (and the panel no copy of the defaults).
  const values = useMemo(
    () => (config ? toFormValues(config, pendingKind) : undefined),
    [config, pendingKind],
  )
  const activePendingKind =
    config && pendingKind !== null && pendingKind !== config.demand.kind ? pendingKind : null

  const schema = useMemo(() => (limits ? buildConfigFormSchema(limits) : null), [limits])

  const form = useForm<ConfigFormValues>({
    // No resolver until the ranges arrive; nothing is rendered before then.
    resolver: schema ? zodResolver(schema) : undefined,
    values,
    mode: 'onChange',
  })

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

  const contextValue: ConfigFormContextValue | null = useMemo(
    () => (limits ? { form, saveApi, readOnly: locked, limits } : null),
    [form, saveApi, locked, limits],
  )

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

  function handleKindChange(kind: DemandKind): void {
    setPendingKind(kind)
    // A `CUSTOM` series has no default: nothing is saved until one is pasted,
    // because an empty series is refused (`03 §3.1`).
    if (kind === 'CUSTOM') return
    // The kind and no field of the previous kind (AC 7, FM 2). A changed kind
    // replaces the stored demand object, and the server fills every field
    // the patch leaves out with that kind's own default (`10 §3.3`).
    saveApi.save({ demand: { kind } }, true)
  }

  function handleApplyPreset(patch: ConfigPatch): void {
    setPendingKind(null)
    saveApi.save(patch, true)
  }

  const showBots =
    config.bot_fill_empty_roles ||
    (Array.isArray(participants) && participants.some((p) => p.is_bot))
  const panelError = saveApi.serverError?.field === null ? saveApi.serverError.message : null

  return (
    <ConfigFormContext.Provider value={contextValue}>
      <form
        onSubmit={(event) => event.preventDefault()}
        aria-label="Game settings"
        className="flex flex-col gap-4"
      >
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

        <ConfigSection
          id="config-presets"
          title="Presets"
          description="Start from a known scenario, then change anything you like."
        >
          <PresetCards
            presetName={config.preset_name}
            onApplyPreset={handleApplyPreset}
            onClearPreset={() => saveApi.save({ preset_name: null }, true)}
          />
        </ConfigSection>

        <ConfigSection
          id="config-length"
          title="Length and pacing"
          description="How long the session runs, and what happens when somebody drops out."
        >
          <LengthSection />
        </ConfigSection>

        <ConfigSection
          id="config-starting"
          title="Starting conditions"
          description="Where every role begins. Asymmetry here is a teaching tool — one role starting short is a whole lesson on its own."
        >
          <RoleGrid
            group="starting"
            roles={config.roles}
            onApplyToAll={(p) => saveApi.save(p, true)}
            leadTimes={<LeadTimeRow config={config} />}
          />
        </ConfigSection>

        <ConfigSection
          id="config-costs"
          title="Costs"
          description="What each role pays per week. Backlog costing more than holding is what makes hoarding rational."
        >
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-4">
              <TextField
                name="currency_symbol"
                label="Currency symbol"
                hint="Shown beside every figure in the game."
                maxLength={4}
              />
            </div>
            <RoleGrid group="costs" roles={config.roles} onApplyToAll={(p) => saveApi.save(p, true)} />
          </div>
        </ConfigSection>

        <ConfigSection
          id="config-demand"
          title="Customer demand"
          description="What the Retailer's customers ask for each week. Only the Retailer sees it, unless you turn that off below."
        >
          <DemandEditor
            config={config}
            pendingKind={activePendingKind}
            onKindChange={handleKindChange}
          />
        </ConfigSection>

        <ConfigSection
          id="config-visibility"
          title="Visibility"
          description="The teaching levers. Run the same scenario twice with different answers here and the difference is the lesson."
        >
          <VisibilitySection />
        </ConfigSection>

        {showBots ? (
          <ConfigSection
            id="config-bots"
            title="Bot difficulty"
            description="How the bots decide what to order."
          >
            <BotSection />
          </ConfigSection>
        ) : null}
      </form>
    </ConfigFormContext.Provider>
  )
}

export default ConfigPanel
