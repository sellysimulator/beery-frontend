import type { ReactElement } from 'react'
import { FORM_LIMITS } from '../../schemas/configSchema'
import { NumberField, SwitchField } from './fields'

/**
 * Length and pacing: the four decisions a host makes about how the session
 * runs rather than about what the chain looks like.
 *
 * There is no decision timer here, and that is deliberate: v1 is untimed
 * (**D6**). `round_timer_seconds` and `timeout_policy` do not exist, a decision
 * window closes when every role has submitted or when the host force-closes
 * it, and a field offering to set a deadline would describe a game this build
 * does not play.
 */
export function LengthSection(): ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField
          name="duration_weeks"
          label="Weeks to play"
          hint={`Between ${FORM_LIMITS.min_weeks} and ${FORM_LIMITS.max_weeks}. Below ${FORM_LIMITS.min_weeks} the bullwhip has no room to develop.`}
          min={FORM_LIMITS.min_weeks}
          max={FORM_LIMITS.max_weeks}
          unit="weeks"
        />
        <NumberField
          name="random_seed"
          label="Random seed"
          hint="Leave blank and the server picks one. The same seed replays the same game."
          placeholder="Chosen at start"
          nullable
          min={0}
          max={Number.MAX_SAFE_INTEGER}
        />
      </div>

      <SwitchField
        name="pause_on_disconnect"
        label="Pause when somebody drops"
        explanation="The game stops and you are told who lost their connection. You decide whether to wait, resume, or put a bot in their seat — nothing is ever substituted automatically."
      />
      <SwitchField
        name="bot_fill_empty_roles"
        label="Fill empty seats with bots"
        explanation="Start with fewer than four people. Bots order using the anchor-and-adjust rule you can tune below."
      />
    </div>
  )
}

export default LengthSection
