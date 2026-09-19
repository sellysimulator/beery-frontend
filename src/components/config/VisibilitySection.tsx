import type { ReactElement } from 'react'
import { FORM_LIMITS } from '../../schemas/configSchema'
import { VISIBILITY_COPY } from './copy'
import { NumberField, SwitchField } from './fields'

/**
 * The teaching levers.
 *
 * Each switch carries the one line from `beer-game-manual.md` Part 1 Step 3
 * saying what it teaches, always rendered rather than hidden behind a tooltip:
 * these are the settings a host changes *between* two runs of the same
 * scenario to make a point, and the point is the thing worth reading.
 */
export function VisibilitySection(): ReactElement {
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
          hint="Leave blank for no limit beyond the hard ceiling."
          placeholder="No limit"
          nullable
          min={0}
          max={FORM_LIMITS.max_order_quantity}
        />
      </div>

      <SwitchField
        name="visibility.allow_negative_orders"
        label="Allow negative orders"
        explanation="Lets a player send stock back up the chain. Off is the standard game."
      />
    </div>
  )
}

export default VisibilitySection
