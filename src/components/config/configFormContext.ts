/**
 * The two things every field in the panel needs: the React Hook Form instance
 * that holds the in-flight keystrokes, and the save path.
 *
 * A context rather than props because the panel is four levels deep in places
 * (panel -> section -> role grid -> cell) and threading two unchanging objects
 * through every one of them buries the parts that do differ.
 */
import { createContext, use } from 'react'
import type { FieldErrors, Path, UseFormReturn } from 'react-hook-form'
import type { ConfigFormValues } from '../../schemas/configSchema'
import type { ConfigSaveApi } from './useConfigSave'

export interface ConfigFormContextValue {
  form: UseFormReturn<ConfigFormValues>
  saveApi: ConfigSaveApi
  /** True once the game has started: the panel renders a summary instead. */
  readOnly: boolean
}

export const ConfigFormContext = createContext<ConfigFormContextValue | null>(null)

export function useConfigFormContext(): ConfigFormContextValue {
  const value = use(ConfigFormContext)
  if (!value) {
    throw new Error('A configuration field was rendered outside ConfigPanel.')
  }
  return value
}

/**
 * A dotted field name as React Hook Form types it.
 *
 * The names are built from the config's own shape — `roles.FACTORY.production_delay_weeks`
 * — so they are strings by construction. `Path<ConfigFormValues>` cannot express
 * that without enumerating the demand union at every call site, and the payload
 * these names build is validated by Zod either way.
 */
export function fieldPath(name: string): Path<ConfigFormValues> {
  return name as Path<ConfigFormValues>
}

/** The Zod message for a dotted path, or undefined. */
export function errorAt(errors: FieldErrors<ConfigFormValues>, path: string): string | undefined {
  let cursor: unknown = errors

  for (const segment of path.split('.')) {
    if (typeof cursor !== 'object' || cursor === null) return undefined
    cursor = (cursor as Record<string, unknown>)[segment]
  }

  if (typeof cursor !== 'object' || cursor === null) return undefined
  const message = (cursor as { message?: unknown }).message
  return typeof message === 'string' ? message : undefined
}

/** A DOM id for a dotted field name. */
export function fieldId(name: string): string {
  return `config-${name.replace(/\./g, '-')}`
}
