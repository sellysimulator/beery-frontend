import type { ReactElement } from 'react'
import { ROLE_ORDER, type GameConfig, type Role } from '../../types/game'
import { BOT_BETA_LABEL, DEMAND_KIND_LABEL, LOCKED_BANNER, ROLE_COLUMN_LABEL, VISIBILITY_COPY } from './copy'
import DemandPreview from './DemandPreview'
import { ROLE_ROW_GROUPS } from './roleRows'

function Row({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-1.5 last:border-b-0">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="numeric text-sm text-ink">{value}</dd>
    </div>
  )
}

function readRole(config: GameConfig, role: Role, key: string): string {
  const source = config.roles[role] as unknown as Record<string, unknown>
  const value = source[key]
  if (value === null || value === undefined) return '—'
  return String(value)
}

function demandSummary(config: GameConfig): string {
  const demand = config.demand
  switch (demand.kind) {
    case 'CONSTANT':
      return `${demand.value} units every week`
    case 'STEP':
      return `${demand.initial_value} until week ${demand.step_week}, then ${demand.step_value}`
    case 'RAMP':
      return `from ${demand.initial_value}, ${demand.slope_per_week} per week from week ${demand.start_week}${
        demand.cap === null ? '' : `, capped at ${demand.cap}`
      }`
    case 'SEASONAL':
      return `base ${demand.base}, swing ${demand.amplitude}, ${demand.period_weeks}-week cycle`
    case 'STOCHASTIC':
      return `${demand.distribution.toLowerCase()}, mean ${demand.mean}, deviation ${demand.stdev}`
    case 'CUSTOM':
      return `${demand.values.length} weeks, pasted in`
  }
}

export interface ConfigSummaryProps {
  config: GameConfig
}

/**
 * What the panel becomes once the game has started.
 *
 * `18 section 3.3` is explicit that disabling the inputs is not enough: a host
 * mid-game is not trying to edit anything, they are answering "how long is
 * this?" or "is the leaderboard on?" out loud, and a page of greyed-out number
 * spinners is the worst possible way to read that back. So the same six
 * sections render as prose and figures, with the banner saying why.
 */
export function ConfigSummary({ config }: ConfigSummaryProps): ReactElement {
  return (
    <div className="flex flex-col gap-5">
      <p role="status" className="rounded-lg border border-warning bg-warning-soft px-4 py-3 text-base text-ink">
        {LOCKED_BANNER}
      </p>

      <section className="flex flex-col gap-2">
        <h3 className="text-xl font-semibold text-ink">Presets</h3>
        <p className="text-base text-ink-muted">
          {config.preset_name === null ? 'Custom settings.' : `Preset: ${config.preset_name}.`}
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-xl font-semibold text-ink">Length and pacing</h3>
        <dl>
          <Row label="Weeks to play" value={String(config.duration_weeks)} />
          <Row label="Pause when somebody drops" value={config.pause_on_disconnect ? 'On' : 'Off'} />
          <Row label="Fill empty seats with bots" value={config.bot_fill_empty_roles ? 'On' : 'Off'} />
          <Row
            label="Random seed"
            value={config.random_seed === null ? 'Chosen at start' : String(config.random_seed)}
          />
          <Row label="Currency" value={config.currency_symbol} />
        </dl>
      </section>

      {(['starting', 'costs'] as const).map((group) => (
        <section key={group} className="flex flex-col gap-2">
          <h3 className="text-xl font-semibold text-ink">
            {group === 'starting' ? 'Starting conditions' : 'Costs'}
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr>
                  <th scope="col" className="pb-2 font-semibold text-ink-muted">
                    Parameter
                  </th>
                  {ROLE_ORDER.map((role) => (
                    <th key={role} scope="col" className="pb-2 font-semibold text-ink">
                      {ROLE_COLUMN_LABEL[role]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROLE_ROW_GROUPS[group].map((row) => (
                  <tr key={row.key} className="border-t border-border">
                    <th scope="row" className="py-1.5 pr-4 font-normal text-ink">
                      {row.label}
                    </th>
                    {ROLE_ORDER.map((role) => (
                      <td key={role} className="numeric py-1.5 text-ink">
                        {readRole(config, role, row.key)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <section className="flex flex-col gap-2">
        <h3 className="text-xl font-semibold text-ink">Customer demand</h3>
        <p className="text-base text-ink">
          {DEMAND_KIND_LABEL[config.demand.kind]} — {demandSummary(config)}
        </p>
        <DemandPreview demand={config.demand} durationWeeks={config.duration_weeks} />
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-xl font-semibold text-ink">Visibility</h3>
        <dl>
          {VISIBILITY_COPY.map((lever) => (
            <Row
              key={lever.name}
              label={lever.label}
              value={config.visibility[lever.name] ? 'On' : 'Off'}
            />
          ))}
          <Row
            label="Largest order a player may place"
            value={
              config.visibility.max_order_quantity === null
                ? 'No limit'
                : String(config.visibility.max_order_quantity)
            }
          />
          <Row
            label="Allow negative orders"
            value={config.visibility.allow_negative_orders ? 'On' : 'Off'}
          />
        </dl>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-xl font-semibold text-ink">Bot difficulty</h3>
        <dl>
          <Row label={BOT_BETA_LABEL} value={String(config.bot.beta)} />
          <Row label="Demand smoothing" value={String(config.bot.theta)} />
          <Row label="Stock correction" value={String(config.bot.alpha)} />
          <Row label="Target stock multiplier" value={String(config.bot.target_stock_multiplier)} />
        </dl>
      </section>
    </div>
  )
}

export default ConfigSummary
