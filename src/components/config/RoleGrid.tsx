import type { ReactElement } from 'react'
import { ROLE_ORDER, type GameConfigRoles } from '../../types/game'
import { useConfigFormContext } from './configFormContext'
import type { ConfigPatch } from './configPatch'
import { ROLE_COLUMN_LABEL } from './copy'
import { NumberField } from './fields'
import { ROLE_ROW_GROUPS, showsRow } from './roleRows'

export interface RoleGridProps {
  group: keyof typeof ROLE_ROW_GROUPS
  /** The stored per-role config, which *Apply to all* copies from. */
  roles: GameConfigRoles
  /** Sends a patch immediately; *Apply to all* is a finished decision. */
  onApplyToAll: (patch: ConfigPatch) => void
}

/**
 * One parameter per row, one role per column, so a host can see asymmetry at a
 * glance — which is the whole reason the grid is a grid rather than four
 * stacked forms.
 *
 * *Apply to all* copies the Retailer column into the other three. It copies
 * only what the Retailer column actually shows: the Retailer has no
 * `information_delay_weeks` on screen, so pressing the button cannot silently
 * push a value the host was never able to see.
 */
export function RoleGrid({ group, roles, onApplyToAll }: RoleGridProps): ReactElement {
  const { readOnly, saveApi } = useConfigFormContext()
  const rows = ROLE_ROW_GROUPS[group]

  function handleApplyToAll(): void {
    const source = roles.RETAILER as unknown as Record<string, unknown>
    const patchRoles: Record<string, Record<string, unknown>> = {}

    for (const role of ROLE_ORDER) {
      if (role === 'RETAILER') continue

      const target: Record<string, unknown> = {}
      for (const row of rows) {
        if (!showsRow(row, 'RETAILER') || !showsRow(row, role)) continue
        target[row.key] = source[row.key]
      }
      if (Object.keys(target).length) patchRoles[role] = target
    }

    if (Object.keys(patchRoles).length) onApplyToAll({ roles: patchRoles })
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <button
          type="button"
          onClick={handleApplyToAll}
          disabled={readOnly || !saveApi.canSave}
          className="rounded-md border border-border-strong px-3 py-1.5 text-sm text-ink hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:text-ink-subtle"
        >
          Apply Retailer column to all
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-3xl border-collapse text-left">
          <thead>
            <tr>
              <th scope="col" className="w-64 pb-2 text-sm font-semibold text-ink-muted">
                Parameter
              </th>
              {ROLE_ORDER.map((role) => (
                <th key={role} scope="col" className="pb-2 text-sm font-semibold text-ink">
                  {ROLE_COLUMN_LABEL[role]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-border align-top">
                <th scope="row" className="py-3 pr-4 text-sm font-normal text-ink">
                  <span className="block font-medium">{row.label}</span>
                  {row.help ? <span className="block text-xs text-ink-muted">{row.help}</span> : null}
                </th>
                {ROLE_ORDER.map((role) => (
                  <td key={role} className="px-2 py-3">
                    {showsRow(row, role) ? (
                      <NumberField
                        name={`roles.${role}.${row.key}`}
                        label={`${ROLE_COLUMN_LABEL[role]} — ${row.label}`}
                        labelHidden
                        min={row.min}
                        max={row.max}
                        step={row.step}
                        unit={row.unit}
                        nullable={row.nullable}
                        placeholder={row.placeholder}
                      />
                    ) : (
                      <span aria-hidden="true" className="text-ink-subtle">
                        &mdash;
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default RoleGrid
