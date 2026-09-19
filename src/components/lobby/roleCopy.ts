/**
 * Role names and the one-line descriptions a player choosing a seat reads.
 *
 * The descriptions are `beer-game-manual.md` Part 2 *The chain*, so somebody
 * picking in `PLAYER_CHOOSES` mode knows what they are picking rather than
 * guessing from a label.
 */
import type { Role } from '../../types/game'

export const ROLE_LABEL: Record<Role, string> = {
  RETAILER: 'Retailer',
  WHOLESALER: 'Wholesaler',
  DISTRIBUTOR: 'Distributor',
  FACTORY: 'Factory',
}

export const ROLE_DESCRIPTION: Record<Role, string> = {
  RETAILER:
    "You sell to the public, and you're the only one who sees what real customers want.",
  WHOLESALER: 'You supply the Retailer and order from the Distributor.',
  DISTRIBUTOR: 'You supply the Wholesaler and order from the Factory.',
  FACTORY:
    "You brew. You don't order from anyone — you start production, and it takes time.",
}

export const ROLE_MODE_LABEL = {
  HOST_ASSIGNS: 'You assign the roles',
  PLAYER_CHOOSES: 'Players choose their own',
  RANDOM: 'Deal the roles at random when the game starts',
} as const

export const ROLE_MODE_DESCRIPTION = {
  HOST_ASSIGNS: 'Put each person in a specific seat. Nothing starts until all four are filled.',
  PLAYER_CHOOSES: 'First come, first served from the lobby. You can override any claim.',
  RANDOM: 'Nobody can cherry-pick the easy seat. Players learn their role when the game starts.',
} as const
