/**
 * The per-role parameter rows, and which roles each one exists for.
 *
 * They live apart from the grid that renders them because the read-only
 * summary (`18 section 3.3`) has to show the same parameters, in the same
 * order, under the same names — a second list would drift the first time a
 * knob is added, and the host reading it mid-game is the one person who cannot
 * check.
 */
import type { Limits, Role } from '../../types/game'

/**
 * Which of the server's ranges a row is checked against. The numbers
 * themselves come from `GET /rooms/limits` at render time (`boundsFor`): the
 * form keeps no copy of them (2026-11-02).
 */
export type RowBounds = 'quantity' | 'money' | 'delay' | 'cap'

export interface RoleRow {
  /** The key inside a role's config, which is also the last path segment. */
  key: string
  label: string
  help?: string
  bounds: RowBounds
  unit?: string
  nullable?: boolean
  placeholder?: string
  /** Roles this parameter does not exist for. */
  hiddenFor?: Role[]
  /** Roles this parameter exists for, when it is not all of them. */
  onlyFor?: Role[]
}

export interface Bounds {
  min: number
  max: number
  step: number
}

/** A row's range, read from the server's limits. */
export function boundsFor(row: RoleRow, limits: Limits): Bounds {
  switch (row.bounds) {
    case 'quantity':
      return { min: 0, max: limits.max_initial_quantity, step: 1 }
    case 'money':
      return { min: 0, max: limits.max_unit_value, step: 0.05 }
    case 'delay':
      return { min: limits.min_delay_weeks, max: limits.max_delay_weeks, step: 1 }
    case 'cap':
      return { min: 0, max: limits.max_order_quantity, step: 1 }
  }
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
 *
 * Both order rows describe orders arriving AT the role, because that is what
 * the engine does with them (`config_models.order_delay_weeks`): a role's
 * order delay is how long its customer's orders take to reach it, so the
 * Distributor's sets the Wholesaler's lead time, not the Distributor's own.
 * The labels said the opposite until 2026-11-02.
 */
export const STARTING_ROWS: RoleRow[] = [
  {
    key: 'initial_inventory',
    label: 'Starting inventory',
    help: 'Units on the shelf in week 1.',
    bounds: 'quantity',
  },
  { key: 'initial_backlog', label: 'Starting backlog', bounds: 'quantity' },
  {
    key: 'initial_pipeline_quantity',
    label: 'Units already in transit',
    help: 'What is in each slot of the inbound pipeline at week 1.',
    bounds: 'quantity',
  },
  {
    key: 'initial_order_in_pipeline',
    label: 'Incoming orders already on the way',
    help:
      "Orders from this role's customer already travelling to it in week 1, one amount per week of its order delay. " +
      "The customer sees them as \u201cOrders you've placed\u201d \u2014 so the Wholesaler's value is what the Retailer sees. " +
      'The Retailer has no incoming order line: its value only sets a Retailer bot\u2019s first guess at demand.',
    bounds: 'quantity',
  },
  {
    key: 'shipping_delay_weeks',
    label: 'Shipping delay',
    help: 'Weeks between a supplier shipping and this role receiving.',
    bounds: 'delay',
    unit: 'weeks',
    hiddenFor: ['FACTORY'],
  },
  {
    key: 'production_delay_weeks',
    label: 'Production delay',
    help: 'Weeks between the Factory starting a batch and it being ready.',
    bounds: 'delay',
    unit: 'weeks',
    onlyFor: ['FACTORY'],
  },
  {
    key: 'production_capacity_per_week',
    label: 'Production capacity per week',
    help: '0 or blank = unlimited. Anything over capacity waits in a queue; it is never lost.',
    bounds: 'cap',
    nullable: true,
    placeholder: 'Unlimited',
    onlyFor: ['FACTORY'],
  },
  {
    key: 'information_delay_weeks',
    label: 'Order delay to this role',
    help:
      "Weeks an order from this role's customer (the role below it) takes to reach this role. " +
      "The Wholesaler's sets how long the Retailer's orders take, and it adds to the Retailer's lead time. " +
      "Not shown for the Retailer: customers' orders reach it at once.",
    bounds: 'delay',
    unit: 'weeks',
    hiddenFor: ['RETAILER'],
  },
]

export const COST_ROWS: RoleRow[] = [
  { key: 'holding_cost_per_unit_week', label: 'Holding cost per unit per week', bounds: 'money' },
  { key: 'backlog_cost_per_unit_week', label: 'Backlog cost per unit per week', bounds: 'money' },
  {
    key: 'fixed_order_cost',
    label: 'Fixed cost per order',
    help: 'Charged once in any week an order above zero is placed, when the week closes.',
    bounds: 'money',
  },
  {
    key: 'unit_purchase_cost',
    label: 'Purchase cost per unit',
    help: 'Charged on every unit ordered, when the week closes.',
    bounds: 'money',
  },
  {
    key: 'starting_capital',
    label: 'Starting capital',
    help: 'Above zero, players see a balance counting down instead of a cost counting up.',
    bounds: 'money',
  },
]

export const ROLE_ROW_GROUPS = { starting: STARTING_ROWS, costs: COST_ROWS }

export function showsRow(row: RoleRow, role: Role): boolean {
  if (row.onlyFor && !row.onlyFor.includes(role)) return false
  if (row.hiddenFor?.includes(role)) return false
  return true
}
