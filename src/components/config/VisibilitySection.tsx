import type { ReactElement } from 'react'
import { useConfigFormContext } from './configFormContext'
import { VISIBILITY_COPY } from './copy'
import { NumberField, SwitchField } from './fields'

/**
 * The teaching levers.
 *
 * Each switch carries the one line from `beer-game-manual.md` Part 1 Step 3
 * saying what it teaches, always rendered rather than hidden behind a tooltip:
 * these are the settings a host changes *between* two runs of the same
 * scenario to make a point, and the point is the thing worth reading.
 *
 * There is no "negative orders" switch: the option was removed on 2026-11-02.
 * It never worked (a negative order froze the week), and every order now has a
 * floor of 0.
 */
export function VisibilitySection(): ReactElement {
  const { limits } = useConfigFormContext()
  return (
    <div className="flex flex-col gap-3">
      {VISIBILITY_COPY.map((lever) => (
        <SwitchField
          key={lever.name}
          name={`visibility.${lever.name}`}
          label={lever.label}
          explanation={lever.explanation}
        />
      ))}

      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField
          name="visibility.max_order_quantity"
          label="Largest order a player may place"
          hint={`0 or blank = no limit of your own; the hard ceiling of ${limits.max_order_quantity} still applies. A player's order above the limit is refused, not cut down.`}
          placeholder="No limit"
          nullable
          min={0}
          max={limits.max_order_quantity}
        />
      </div>
    </div>
  )
}

export default VisibilitySection
