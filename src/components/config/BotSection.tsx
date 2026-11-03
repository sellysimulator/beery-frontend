import type { ReactElement } from 'react'
import { useConfigFormContext } from './configFormContext'
import { BOT_BETA_LABEL } from './copy'
import { NumberField, SliderField } from './fields'

/**
 * Bot difficulty: the Sterman anchor-and-adjust parameters.
 *
 * `beta` gets the slider and the top of the section because it is the single
 * most instructive knob in the form (`beer-game-spec.md section 8.5`): it is how
 * much of its supply line a bot counts before ordering more. At 0 the bot
 * re-orders to cover a shortfall it has already covered and panics its way
 * into the bullwhip; at 1 it counts every unit in transit and swings far less.
 *
 * It does not make the bot steady, and the copy must not say so (2026-11-03,
 * `08 §3.1`). The bot aims for a stock of `target_stock_multiplier` times its
 * starting inventory, keeps no target for its pipeline, and its supply line is
 * only the beer already shipped to it, not orders its supplier has yet to
 * ship. So even at 1, with flat demand, it orders well above demand at first
 * and then cuts back. The labels describe what the knob changes, not an
 * outcome it does not deliver.
 */
export function BotSection(): ReactElement {
  // The server's ranges, never a copy (`useLimits`).
  const { limits } = useConfigFormContext()
  const weight = limits.max_bot_weight
  return (
    <div className="flex flex-col gap-4">
      <SliderField
        name="bot.beta"
        label={BOT_BETA_LABEL}
        hint={`0 is a bot that ignores the beer already on its way and keeps re-ordering for it. ${weight} is a bot that counts every unit in transit: its swings are much milder, but it still over-orders at first — it aims for the target stock below, and orders its supplier has not shipped yet are invisible to it.`}
        min={0}
        max={weight}
        step={0.05}
        lowLabel="0 — ignores it"
        highLabel={`${weight} — counts all of it`}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <NumberField
          name="bot.theta"
          label="Demand smoothing"
          hint={`How fast a bot updates its view of demand. 0 to ${weight}.`}
          min={0}
          max={weight}
          step={0.05}
        />
        <NumberField
          name="bot.alpha"
          label="Stock correction"
          hint={`How hard a bot pulls its inventory back to target. 0 to ${weight}.`}
          min={0}
          max={weight}
          step={0.05}
        />
        <NumberField
          name="bot.target_stock_multiplier"
          label="Target stock multiplier"
          hint={`Target inventory as a multiple of the starting inventory. A target above the starting stock makes a bot order more than demand while it builds it. 0 to ${limits.max_target_stock_multiplier}.`}
          min={0}
          max={limits.max_target_stock_multiplier}
          step={0.5}
        />
      </div>
    </div>
  )
}

export default BotSection
