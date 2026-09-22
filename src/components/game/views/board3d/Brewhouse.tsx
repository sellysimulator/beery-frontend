import type { ReactElement } from 'react'
import type { Vec3 } from './sceneLayout'
import {
  accentMaterial,
  BREWHOUSE_BANDS_GEOMETRY,
  BREWHOUSE_TANKS_GEOMETRY,
  STRUCTURE_MATERIAL,
} from './sceneMaterials'

/**
 * The FACTORY's four brewing tanks — the one fixture that tells a player which
 * seat they are in before they have moved (24 §3.7, AC 8).
 *
 * `r = 1.4`, `h = 4`, four of them, procedural: ~800 triangles, one hoisted
 * geometry, zero bytes of download, where a tank model would have been a fifth
 * GLB against a 699 KB budget that is already spent (24 §3.7, §7.1).
 *
 * The tanks stand over the production line's four lanes, so `SUPPLY_LANE_X`
 * places them: the same `−6, −2, +2, +6` §3.7 draws, read from the frozen
 * layout rather than typed again here. A tank over a lane is the picture the
 * seat needs — what this room receives, it brewed itself.
 */

export interface BrewhouseProps {
  /** `ZONES.brewhouse`, from the fixture. */
  readonly position: Vec3
  /** The role accent, on architecture only (24 §3.8). */
  readonly accent: string
}

/**
 * **Two draw calls**: the four tank bodies are one merged geometry and the
 * four accent bands are another, both built once in `sceneMaterials.ts` over
 * `SUPPLY_LANE_X`. They cannot be one mesh — structural grey for the drums and
 * the role accent for the bands is 24 §3.8's rule, and a band per tank is what
 * makes the row read as this role's brewhouse rather than four grey drums.
 */
export function Brewhouse({ position, accent }: BrewhouseProps): ReactElement {
  return (
    <group position={[0, 0, position[2]]}>
      <mesh geometry={BREWHOUSE_TANKS_GEOMETRY} material={STRUCTURE_MATERIAL} />
      <mesh geometry={BREWHOUSE_BANDS_GEOMETRY} material={accentMaterial(accent)} />
    </group>
  )
}

export default Brewhouse
