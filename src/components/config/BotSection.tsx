import type { ReactElement } from 'react'
import { BOT_BETA_LABEL } from './copy'
import { NumberField, SliderField } from './fields'

/**
 * Bot difficulty: the Sterman anchor-and-adjust parameters.
 *
 * `beta` gets the slider and the top of the section because it is the single
 * most instructive knob in the form (`beer-game-spec.md section 8.5`): it is how
 * much a bot accounts for what it has already ordered but not yet received. At
 * 0 the bot re-orders to cover a shortfall it has already covered and panics
 * its way into the bullwhip; at 1 it is steady. Demonstrating that is most of
 * what the supply-line lever teaches, with a bot instead of a volunteer.
 */
export function BotSection(): ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <SliderField
        name="bot.beta"
        label={BOT_BETA_LABEL}
        hint="0 is a bot that ignores its supply line and panics. 1 is a bot that counts every unit already on its way."
        min={0}
        max={1}
        step={0.05}
        lowLabel="0 — panicking"
        highLabel="1 — steady"
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <NumberField
          name="bot.theta"
          label="Demand smoothing"
          hint="How fast a bot updates its view of demand. 0 to 1."
          min={0}
          max={1}
          step={0.05}
        />
        <NumberField
          name="bot.alpha"
          label="Stock correction"
          hint="How hard a bot pulls its inventory back to target. 0 to 1."
          min={0}
          max={1}
          step={0.05}
        />
        <NumberField
          name="bot.target_stock_multiplier"
          label="Target stock multiplier"
          hint="Target inventory as a multiple of the starting inventory."
          min={0}
          max={10}
          step={0.5}
        />
      </div>
    </div>
  )
}

export default BotSection
