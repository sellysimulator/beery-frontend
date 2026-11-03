/**
 * Every string the configuration panel shows.
 *
 * Copy lives apart from layout because it is the part of this screen that gets
 * read aloud in a classroom: the visibility explanations come from
 * `beer-game-manual.md` Part 1 Step 3, and they are meant to be edited as
 * prose without touching a component.
 *
 * No string here states a game figure. The preset cards are the server's
 * (`GET /rooms/presets`, whose figures are written from each preset's own
 * config), and every number the panel previews comes from `POST /rooms/preview`
 * (2026-11-03): copy that restates an engine value is a second copy of it.
 *
 * English only, inline, no i18n layer (D13).
 */
import type { DemandKind, Distribution, Role, RoleAssignmentMode } from '../../types/game'

export const ROLE_COLUMN_LABEL: Record<Role, string> = {
  RETAILER: 'Retailer',
  WHOLESALER: 'Wholesaler',
  DISTRIBUTOR: 'Distributor',
  FACTORY: 'Factory',
}

export const ROLE_MODE_LABEL: Record<RoleAssignmentMode, string> = {
  HOST_ASSIGNS: 'You assign the roles',
  PLAYER_CHOOSES: 'Players choose their own',
  RANDOM: 'Deal the roles at random when the game starts',
}

/** The generator picker's order. The kinds are the server's `DemandKind`. */
export const DEMAND_KINDS: readonly DemandKind[] = [
  'CONSTANT',
  'STEP',
  'RAMP',
  'SEASONAL',
  'STOCHASTIC',
  'CUSTOM',
] as const

export const DEMAND_KIND_LABEL: Record<DemandKind, string> = {
  CONSTANT: 'Constant',
  STEP: 'Step',
  RAMP: 'Ramp',
  SEASONAL: 'Seasonal',
  STOCHASTIC: 'Random',
  CUSTOM: 'Custom series',
}

export const DEMAND_KIND_DESCRIPTION: Record<DemandKind, string> = {
  CONSTANT: 'The same number every week. The calmest scenario, and the one with no bullwhip to measure against.',
  STEP: 'Steady, then one permanent jump. The classic scenario.',
  RAMP: 'A steady climb from a starting level, optionally capped.',
  SEASONAL: 'A repeating wave around a base level.',
  STOCHASTIC: 'Drawn at random each week. The seed decides the actual series.',
  CUSTOM: 'Exactly the weeks you paste in.',
}

export const DISTRIBUTION_LABEL: Record<Distribution, string> = {
  NORMAL: 'Normal',
  POISSON: 'Poisson',
  UNIFORM: 'Uniform',
}

/** `beer-game-manual.md` Part 1 Step 3. One line per switch, always rendered. */
export const VISIBILITY_COPY: {
  name:
    | 'show_true_customer_demand_to_all'
    | 'show_all_inventories'
    | 'show_supply_line_prominently'
    | 'show_leaderboard_during_game'
    | 'show_running_cost_to_players'
    | 'show_neighbour_inventory'
  label: string
  explanation: string
}[] = [
  {
    name: 'show_true_customer_demand_to_all',
    label: 'Show true customer demand to everyone',
    explanation:
      'Run the same scenario a second time with this on, to show how much information sharing is worth.',
  },
  {
    name: 'show_all_inventories',
    label: 'Show all inventories',
    explanation: 'Full transparency across the chain.',
  },
  {
    name: 'show_supply_line_prominently',
    label: 'Highlight the supply line',
    explanation:
      "Keep this on for beginners — it reminds players what they've ordered but not yet received. Turn it off to make the game considerably harder.",
  },
  {
    name: 'show_leaderboard_during_game',
    label: 'Show a live leaderboard',
    explanation: 'Competitive, but it can distort behaviour.',
  },
  {
    name: 'show_running_cost_to_players',
    label: 'Show running cost to players',
    explanation: 'Players see their own accumulated cost.',
  },
  {
    name: 'show_neighbour_inventory',
    label: 'Show neighbour inventory',
    explanation: "Reveal the immediate neighbours' stock and backlog.",
  },
]

export const LOCKED_BANNER =
  'Settings are locked while the game is running. To change them, end the game and create a new room.'

export const EXAMPLE_DRAW_NOTE =
  'Example draw; the real series is generated at start. Set a random seed to preview the exact series.'

/** Shown in place of a preview until the server has answered for this draft. */
export const PREVIEW_LOADING = 'Working out the preview…'

/** The lead-time row under the starting conditions. Its figures are the server's. */
export const LEAD_TIME_LABEL = 'Order-to-arrival lead time'
export const LEAD_TIME_HELP =
  'Worked out by the server from the delays above: weeks from this role ordering to the beer arriving.'

/**
 * The beta slider's question. The bot's supply line is the beer already
 * shipped to it and still in transit (`08-bot-agent.md`): orders its supplier
 * has not shipped yet are not in it, so "what it has ordered" would overstate
 * what the knob does.
 */
export const BOT_BETA_LABEL = 'How much do bots count the beer already shipped to them?'
