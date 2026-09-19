/**
 * Every string the configuration panel shows.
 *
 * Copy lives apart from layout because it is the part of this screen that gets
 * read aloud in a classroom: the visibility explanations come from
 * `beer-game-manual.md` Part 1 Step 3 and the preset cards from `18 section 2`,
 * and both are meant to be edited as prose without touching a component.
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

/** Section 18 section 2's preset card copy, keyed by the server's preset name. */
export const PRESET_COPY: Record<string, { label: string; description: string }> = {
  CLASSIC_MIT: {
    label: 'Classic MIT',
    description:
      '36 weeks, 2-week delays, demand steps from 4 to 8 at week 5. The standard scenario, and the one that produces the textbook result.',
  },
  FAST_GAME: {
    label: 'Fast Game',
    description: 'The same scenario over 20 weeks, for a tight schedule.',
  },
  CHAOS: {
    label: 'Chaos',
    description:
      'Long delays, random demand, no supply-line prompt. Expect spectacular failure, which is the point.',
  },
}

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

export const EXAMPLE_DRAW_NOTE = 'Example draw; the real series is generated at start.'

export const BOT_BETA_LABEL = "How much do bots account for what they've already ordered?"
