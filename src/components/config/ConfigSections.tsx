import type { ReactElement, ReactNode } from 'react'
import type { DemandKind, GameConfig } from '../../types/game'
import BotSection from './BotSection'
import ConfigSection from './ConfigSection'
import DemandEditor from './DemandEditor'
import LengthSection from './LengthSection'
import PresetCards from './PresetCards'
import RoleGrid from './RoleGrid'
import VisibilitySection from './VisibilitySection'
import { ConfigFormContext, type ConfigFormContextValue } from './configFormContext'
import type { ConfigPatch } from './configPatch'
import { TextField } from './fields'
import LeadTimeRow from './LeadTimeRow'

export interface ConfigSectionsProps {
  /** The config every input renders from: the room's stored one, or a draft. */
  config: GameConfig
  /** The form, the save path, the read-only flag and the server's ranges. */
  context: ConfigFormContextValue
  /** The generator the host just picked, until the config agrees; else null. */
  pendingKind: DemandKind | null
  onKindChange: (kind: DemandKind) => void
  onApplyPreset: (patch: ConfigPatch) => void
  onClearPreset: () => void
  showBots: boolean
  /** Messages shown above the first section (a missing key, a refusal). */
  notices?: ReactNode
}

/**
 * The host config form's sections, and nothing else: no store, no room, no
 * save path of its own.
 *
 * Every field reads the form and saves through `context.saveApi`, so the same
 * sections run over a live room (the lobby's `ConfigPanel`, where a save goes
 * over the socket or `PUT /rooms/{code}/config`) and over a local draft with
 * no room behind it (`/multihost/new`, where a save is validated by
 * `POST /rooms/preview` and kept as the draft). The demand preview and the
 * lead-time row are the server's in both (`useConfigPreview`).
 */
export function ConfigSections({
  config,
  context,
  pendingKind,
  onKindChange,
  onApplyPreset,
  onClearPreset,
  showBots,
  notices,
}: ConfigSectionsProps): ReactElement {
  const { saveApi } = context

  return (
    <ConfigFormContext.Provider value={context}>
      <form
        onSubmit={(event) => event.preventDefault()}
        aria-label="Game settings"
        className="flex flex-col gap-4"
      >
        {notices}

        <ConfigSection
          id="config-presets"
          title="Presets"
          description="Start from a known scenario, then change anything you like."
        >
          <PresetCards
            presetName={config.preset_name}
            onApplyPreset={onApplyPreset}
            onClearPreset={onClearPreset}
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
          <DemandEditor config={config} pendingKind={pendingKind} onKindChange={onKindChange} />
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

export default ConfigSections
