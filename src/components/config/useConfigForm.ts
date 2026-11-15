/**
 * The form state every config form needs, whatever holds the config: the
 * server's ranges, the Zod schema built from them, the React Hook Form
 * instance, the just-picked demand generator, and the two handlers that
 * change the config wholesale (a demand kind, a preset).
 *
 * Shared by the lobby's `ConfigPanel` (the config is the room's, in the store,
 * saved by `useConfigSave`) and the multi-game setup page (the config is a
 * local draft, validated by `useDraftConfig`). Both render the same
 * `ConfigSections`; only the `ConfigSaveApi` behind them differs.
 */
import { useMemo, useState } from 'react'
import { useForm, type UseFormReturn } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { buildConfigFormSchema, type ConfigFormValues } from '../../schemas/configSchema'
import type { DemandKind, GameConfig } from '../../types/game'
import type { ConfigFormContextValue } from './configFormContext'
import type { ConfigPatch } from './configPatch'
import { toFormValues } from './formValues'
import type { ConfigSaveApi } from './useConfigSave'
import { useLimits } from './useLimits'

export interface ConfigFormState {
  form: UseFormReturn<ConfigFormValues>
  /** Null until the server's ranges have arrived: render a loading line. */
  contextValue: ConfigFormContextValue | null
  limitsError: string | null
  /** The generator the host just picked, until the config agrees; else null. */
  activePendingKind: DemandKind | null
  handleKindChange(kind: DemandKind): void
  handleApplyPreset(patch: ConfigPatch): void
}

export function useConfigForm(
  config: GameConfig | null,
  saveApi: ConfigSaveApi,
  readOnly: boolean,
): ConfigFormState {
  /**
   * The demand generator the host has just picked, before the server has
   * acknowledged it. It is the one value the form shows ahead of the config,
   * and it shows only the kind: the parameters are the server's defaults and
   * appear when the config does, with a placeholder until then.
   * `toFormValues` ignores it as soon as the config agrees, so it expires on
   * its own rather than being cleared by an effect a render later.
   */
  const [pendingKind, setPendingKind] = useState<DemandKind | null>(null)
  const { limits, error: limitsError } = useLimits()

  // No config, no values: nothing is rendered until the config is here, so
  // the form needs no placeholder (and no copy of the defaults).
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

  const contextValue: ConfigFormContextValue | null = useMemo(
    () => (limits ? { form, saveApi, readOnly, limits } : null),
    [form, saveApi, readOnly, limits],
  )

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

  return {
    form,
    contextValue,
    limitsError,
    activePendingKind,
    handleKindChange,
    handleApplyPreset,
  }
}
