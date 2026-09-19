import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { errorMessage } from '../../api/http'
import { getRoomConfig } from '../../api/rooms'
import { configFormSchema, type ConfigFormValues } from '../../schemas/configSchema'
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
import { defaultDemand } from './demandDefaults'
import { TextField } from './fields'
import { PLACEHOLDER_FORM_VALUES, toFormValues } from './formValues'
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
 *   field being edited and nothing else. That is the only arrangement in which
 *   a server-side clamp is visible — type 500 weeks and the field becomes 104,
 *   because 104 is what the game will actually play.
 * - **The server owns the rules.** Zod mirrors the ranges for immediate
 *   feedback, but nothing here rejects a value the server would accept, and the
 *   one hard client-side block is a `CUSTOM` demand series shorter than
 *   `duration_weeks` — the single demand error the server rejects rather than
 *   clamps (`18 section 3.2`).
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
   * and it can only ever show that kind's *declared defaults* — which is
   * exactly what went out in the payload beside it — so it cannot mask a clamp.
   * `toFormValues` ignores it as soon as the stored config agrees, so it
   * expires on its own rather than being cleared by an effect a render later.
   */
  const [pendingKind, setPendingKind] = useState<DemandKind | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const saveApi = useConfigSave(roomCode, hostSecret, locked)

  const values = useMemo(
    () => (config ? toFormValues(config, pendingKind) : PLACEHOLDER_FORM_VALUES),
    [config, pendingKind],
  )

  const form = useForm<ConfigFormValues>({
    resolver: zodResolver(configFormSchema),
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

  const contextValue: ConfigFormContextValue = useMemo(
    () => ({ form, saveApi, readOnly: locked }),
    [form, saveApi, locked],
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

  if (locked) {
    return (
      <ConfigFormContext.Provider value={contextValue}>
        <ConfigSummary config={config} />
      </ConfigFormContext.Provider>
    )
  }

  function handleKindChange(kind: DemandKind): void {
    setPendingKind(kind)
    // The whole demand object, and no field of the previous kind (AC 7, FM 2).
    saveApi.save({ demand: defaultDemand(kind) as unknown as ConfigPatch }, true)
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
          <RoleGrid group="starting" roles={config.roles} onApplyToAll={(p) => saveApi.save(p, true)} />
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
            demand={values.demand}
            durationWeeks={config.duration_weeks}
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
