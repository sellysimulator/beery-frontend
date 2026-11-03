/**
 * Turning the stored config into React Hook Form's values, and back again.
 *
 * `useForm({ values })` re-syncs the whole form whenever this object changes,
 * which is exactly the arrangement `18 section 3.0` describes: the store holds
 * the truth, React Hook Form holds only the keystrokes of the field being
 * edited, and what the server stored reappears in the input the moment the
 * response lands (AC 12, FM 1).
 *
 * There is no placeholder config here and no table of defaults (2026-11-03).
 * The panel renders nothing until the stored config arrives, so `useForm` is
 * given no values until then; and a newly picked demand generator gets its
 * defaults from the server, which fills every field a patch leaves out
 * (`config_merge.merge_config_patch`).
 */
import type { ConfigFormValues } from '../../schemas/configSchema'
import type { DemandConfig, DemandKind, GameConfig } from '../../types/game'

/**
 * The demand the editor shows for a generator the host has just picked,
 * before the server has stored it: the kind and nothing else. Its parameters
 * are the server's defaults, which arrive with the stored config; until then
 * the editor shows a placeholder for them. A `CUSTOM` series starts as the
 * host's own empty paste.
 */
export function pendingDemand(kind: DemandKind): DemandConfig {
  return (kind === 'CUSTOM' ? { kind, values: [] } : { kind }) as DemandConfig
}

/**
 * The form's values for a stored config.
 *
 * `demandKindOverride` is the one place the form runs ahead of the server: a
 * host who picks a different generator sees that generator selected at once.
 * It stops applying as soon as the stored config agrees, so nothing here can
 * mask what the server stored.
 */
export function toFormValues(
  config: GameConfig,
  demandKindOverride: DemandKind | null,
): ConfigFormValues {
  const demand =
    demandKindOverride !== null && demandKindOverride !== config.demand.kind
      ? pendingDemand(demandKindOverride)
      : config.demand

  return {
    duration_weeks: config.duration_weeks,
    pause_on_disconnect: config.pause_on_disconnect,
    bot_fill_empty_roles: config.bot_fill_empty_roles,
    random_seed: config.random_seed,
    currency_symbol: config.currency_symbol,
    role_assignment_mode: config.role_assignment_mode,
    preset_name: config.preset_name,
    roles: {
      RETAILER: { ...config.roles.RETAILER },
      WHOLESALER: { ...config.roles.WHOLESALER },
      DISTRIBUTOR: { ...config.roles.DISTRIBUTOR },
      FACTORY: { ...config.roles.FACTORY },
    },
    demand: { ...demand },
    visibility: { ...config.visibility },
    bot: { ...config.bot },
  }
}
