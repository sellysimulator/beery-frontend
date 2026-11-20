/**
 * The four dressings of the one hall (spec §9.7).
 *
 * Every coordinate in `sceneLayout.ts` is identical for all four roles. This
 * file holds the **only** role branching in the scene, and the list is closed
 * at four levers: the accent hex, the role sign, the north fixture and
 * the south fixture. Everything that follows — racking, figures, the desk's
 * verb — dresses one of those four; nothing else in `board3d/` is allowed to
 * ask what role the player is sitting in.
 *
 * **Every label is imported, never re-typed.** `RoleBanner.tsx` owns the chain
 * vocabulary and says why in its own `eslint-disable` comment — *"a second
 * copy of 'who the Distributor buys from' in three files is a copy that
 * drifts"* — and a fourth file is not an improvement on a third. A test
 * asserts these fields **by identity against the source records**, so the day
 * somebody edits `RECEIPT_LABEL` and forgets this file is a red test rather
 * than a sign in a warehouse quietly saying last month's words.
 */
import type { Role } from '../../../../types/game'
import { ROLE_DESCRIPTION, ROLE_LABEL } from '../../../lobby/roleCopy'
import {
  DEMAND_SOURCE_LABEL,
  DOWNSTREAM_LABEL,
  RECEIPT_LABEL,
  UPSTREAM_LABEL,
} from '../../RoleBanner'
import { ARCHITECTURE_HEX } from './scenePalette'

/** What the hall's north end is: a road in from a supplier, or the brewhouse
 *  of a seat that has no supplier at all. */
export type NorthFixture = 'inbound-road' | 'brewhouse'

/** What the hall's south end is — the one wall a player can name the seat by. */
export type SouthFixture = 'shopfront' | 'dock-doors' | 'cross-dock' | 'dispatch-yard'

/** How many shelf tiers the racking carries; 1 reads as a shop, 3 as a depot. */
export type RackingTiers = 1 | 2 | 3

/** `person.glb` count at the south end. Only the Retailer sees real people. */
export type CustomerFigureCount = 0 | 2

/** Exactly what varies between the four seats. */
export interface RoleSet {
  accent: string // hex, architecture only
  accentSoft: string // hex
  /** `ROLE_LABEL[role]` */ label: string
  /** `ROLE_DESCRIPTION[role]` */ strapline: string
  /** `RECEIPT_LABEL[role]` */ receiptSign: string
  /** `DEMAND_SOURCE_LABEL[role]` */ demandSign: string
  /** `UPSTREAM_LABEL[role]` — `null` for the FACTORY, which buys from nobody. */
  upstreamName: string | null
  /** `DOWNSTREAM_LABEL[role]` */ downstreamName: string
  north: NorthFixture
  south: SouthFixture
  rackingTiers: RackingTiers
  customerFigures: CustomerFigureCount
  hasOrderRoad: boolean // false for FACTORY — it has no supplier
  hasProductionBay: boolean // true for FACTORY only
  /** The desk's verb: "order from the Wholesaler" vs "start producing". */
  deskVerb: string
}

/**
 * The FACTORY's desk verb, spelled once.
 *
 * The Factory does not order, it starts production, and
 * `DecisionForm.tsx` already branches exactly this way. A Factory desk reading
 * "order from …" would be telling a player the game works in a way it does
 * not.
 */
const FACTORY_DESK_VERB = 'start producing'

/** The other three seats order, and the sentence names their actual supplier. */
function orderingVerb(role: Exclude<Role, 'FACTORY'>): string {
  return `order from ${UPSTREAM_LABEL[role]}`
}

/**
 * `Record<Role, RoleSet>` — the one place role branching lives in the scene.
 *
 * Read the four dressings against spec §9.7: people and glass identify the
 * Retailer, three roller doors and a truck tail the Wholesaler, a through-aisle
 * under three-tier racking the Distributor, and four brewing tanks the Factory,
 * each from the spawn point alone.
 */
export const ROLE_SETS: Record<Role, RoleSet> = {
  /** The shop: the only room with people in it, and the only one
   *  whose south wall is glass. One-tier shelving keeps it open and shallow. */
  RETAILER: {
    accent: ARCHITECTURE_HEX.roleRetailer,
    accentSoft: ARCHITECTURE_HEX.roleRetailerSoft,
    label: ROLE_LABEL.RETAILER,
    strapline: ROLE_DESCRIPTION.RETAILER,
    receiptSign: RECEIPT_LABEL.RETAILER,
    demandSign: DEMAND_SOURCE_LABEL.RETAILER,
    upstreamName: UPSTREAM_LABEL.RETAILER,
    downstreamName: DOWNSTREAM_LABEL.RETAILER,
    north: 'inbound-road',
    south: 'shopfront',
    rackingTiers: 1,
    customerFigures: 2,
    hasOrderRoad: true,
    hasProductionBay: false,
    deskVerb: orderingVerb('RETAILER'),
  },

  /** The loading dock: three roller doors and the blunt rear of a
   *  truck filling the south wall. No glass, no people. */
  WHOLESALER: {
    accent: ARCHITECTURE_HEX.roleWholesaler,
    accentSoft: ARCHITECTURE_HEX.roleWholesalerSoft,
    label: ROLE_LABEL.WHOLESALER,
    strapline: ROLE_DESCRIPTION.WHOLESALER,
    receiptSign: RECEIPT_LABEL.WHOLESALER,
    demandSign: DEMAND_SOURCE_LABEL.WHOLESALER,
    upstreamName: UPSTREAM_LABEL.WHOLESALER,
    downstreamName: DOWNSTREAM_LABEL.WHOLESALER,
    north: 'inbound-road',
    south: 'dock-doors',
    rackingTiers: 2,
    customerFigures: 0,
    hasOrderRoad: true,
    hasProductionBay: false,
    deskVerb: orderingVerb('WHOLESALER'),
  },

  /** The cross-dock: the only room you can see all the way through,
   *  and the only racking that reaches the ceiling. */
  DISTRIBUTOR: {
    accent: ARCHITECTURE_HEX.roleDistributor,
    accentSoft: ARCHITECTURE_HEX.roleDistributorSoft,
    label: ROLE_LABEL.DISTRIBUTOR,
    strapline: ROLE_DESCRIPTION.DISTRIBUTOR,
    receiptSign: RECEIPT_LABEL.DISTRIBUTOR,
    demandSign: DEMAND_SOURCE_LABEL.DISTRIBUTOR,
    upstreamName: UPSTREAM_LABEL.DISTRIBUTOR,
    downstreamName: DOWNSTREAM_LABEL.DISTRIBUTOR,
    north: 'inbound-road',
    south: 'cross-dock',
    rackingTiers: 3,
    customerFigures: 0,
    hasOrderRoad: true,
    hasProductionBay: false,
    deskVerb: orderingVerb('DISTRIBUTOR'),
  },

  /**
   * The brewery. `UPSTREAM_LABEL.FACTORY === null` is the single most
   * important structural fact about this seat, and the room says so: no road,
   * no courier, no gate, and a north-west wall carrying the sign that explains
   * the absence rather than leaving a player hunting for a door that was never
   * built.
   */
  FACTORY: {
    accent: ARCHITECTURE_HEX.roleFactory,
    accentSoft: ARCHITECTURE_HEX.roleFactorySoft,
    label: ROLE_LABEL.FACTORY,
    strapline: ROLE_DESCRIPTION.FACTORY,
    receiptSign: RECEIPT_LABEL.FACTORY,
    demandSign: DEMAND_SOURCE_LABEL.FACTORY,
    upstreamName: UPSTREAM_LABEL.FACTORY,
    downstreamName: DOWNSTREAM_LABEL.FACTORY,
    north: 'brewhouse',
    south: 'dispatch-yard',
    rackingTiers: 2,
    customerFigures: 0,
    hasOrderRoad: false,
    hasProductionBay: true,
    deskVerb: FACTORY_DESK_VERB,
  },
}
