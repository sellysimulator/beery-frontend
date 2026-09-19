/**
 * The per-role parameter rows, and which roles each one exists for.
 *
 * They live apart from the grid that renders them because the read-only
 * summary (`18 section 3.3`) has to show the same parameters, in the same
 * order, under the same names — a second list would drift the first time a
 * knob is added, and the host reading it mid-game is the one person who cannot
 * check.
 */
import { FORM_LIMITS } from '../../schemas/configSchema'
import type { Role } from '../../types/game'

export interface RoleRow {
  /** The key inside a role's config, which is also the last path segment. */
  key: string
  label: string
  help?: string
  min: number
  max: number
  step: number
  unit?: string
  nullable?: boolean
  placeholder?: string
  /** Roles this parameter does not exist for. */
  hiddenFor?: Role[]
  /** Roles this parameter exists for, when it is not all of them. */
  onlyFor?: Role[]
}

const quantityBounds = { min: 0, max: FORM_LIMITS.max_initial_quantity, step: 1 }
const moneyBounds = { min: 0, max: FORM_LIMITS.max_unit_value, step: 0.05 }
const delayBounds = {
  min: FORM_LIMITS.min_delay_weeks,
  max: FORM_LIMITS.max_delay_weeks,
  step: 1,
  unit: 'weeks',
}

/**
 * Starting conditions, in the order a host reasons about them: what is on the
 * shelf, what is owed, what is already moving, and how long everything takes.
 *
 * Two rows are role-specific, and both are `18 section 2`'s doing:
 *
 * - The **Factory** has no supplier to ship from, so it shows
 *   `production_delay_weeks` and `production_capacity_per_week` where the other
 *   three show `shipping_delay_weeks`.
 * - The **Retailer**'s `information_delay_weeks` is unused
 *   (`06-role-agents.md section 3.1`) and is therefore absent from the DOM, not
 *   merely disabled. A field that does nothing is worse than no field: a host
 *   who sets it believes they changed the game.
 */
export const STARTING_ROWS: RoleRow[] = [
  {
    key: 'initial_inventory',
    label: 'Starting inventory',
    help: 'Units on the shelf in week 1.',
    ...quantityBounds,
  },
  { key: 'initial_backlog', label: 'Starting backlog', ...quantityBounds },
  {
    key: 'initial_pipeline_quantity',
    label: 'Units already in transit',
    help: 'What is in each slot of the inbound pipeline at week 1.',
    ...quantityBounds,
  },
  {
    key: 'initial_order_in_pipeline',
    label: 'Orders already placed',
    ...quantityBounds,
  },
  {
    key: 'shipping_delay_weeks',
    label: 'Shipping delay',
    help: 'Weeks between a supplier shipping and this role receiving.',
    ...delayBounds,
    hiddenFor: ['FACTORY'],
  },
  {
    key: 'production_delay_weeks',
    label: 'Production delay',
    help: 'Weeks between the Factory starting a batch and it being ready.',
    ...delayBounds,
    onlyFor: ['FACTORY'],
  },
  {
    key: 'production_capacity_per_week',
    label: 'Production capacity per week',
    help: 'Leave blank for unlimited.',
    min: 0,
    max: FORM_LIMITS.max_order_quantity,
    step: 1,
    nullable: true,
    placeholder: 'Unlimited',
    onlyFor: ['FACTORY'],
  },
  {
    key: 'information_delay_weeks',
    label: 'Order information delay',
    help: 'Weeks between an order being placed and the supplier seeing it.',
    ...delayBounds,
    hiddenFor: ['RETAILER'],
  },
]

export const COST_ROWS: RoleRow[] = [
  { key: 'holding_cost_per_unit_week', label: 'Holding cost per unit per week', ...moneyBounds },
  { key: 'backlog_cost_per_unit_week', label: 'Backlog cost per unit per week', ...moneyBounds },
  {
    key: 'fixed_order_cost',
    label: 'Fixed cost per order',
    help: 'Charged once in any week an order is placed.',
    ...moneyBounds,
  },
  { key: 'unit_purchase_cost', label: 'Purchase cost per unit', ...moneyBounds },
  {
    key: 'starting_capital',
    label: 'Starting capital',
    help: 'Above zero, players see a balance counting down instead of a cost counting up.',
    ...moneyBounds,
  },
]

export const ROLE_ROW_GROUPS = { starting: STARTING_ROWS, costs: COST_ROWS }

export function showsRow(row: RoleRow, role: Role): boolean {
  if (row.onlyFor && !row.onlyFor.includes(role)) return false
  if (row.hiddenFor?.includes(role)) return false
  return true
}
