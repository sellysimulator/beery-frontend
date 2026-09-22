import type { ReactElement } from 'react'
import type { SouthFixture } from './roleSets'
import type { Vec3 } from './sceneLayout'
import { CHECKOUT_Z, HALL } from './sceneLayout'
import {
  accentMaterial,
  CROSS_DOCK_AISLE_GEOMETRY,
  CROSS_DOCK_KERBS_GEOMETRY,
  DOCK_FRAMES_GEOMETRY,
  DOCK_LEAVES_GEOMETRY,
  FIXTURE_SIZE,
  GLASS_MATERIAL,
  SHOPFRONT_MULLIONS_GEOMETRY,
  STRUCTURE_MATERIAL,
  SURFACE_MATERIAL,
  UNIT_BOX,
  UNIT_PLANE,
} from './sceneMaterials'

/**
 * The south wall — the one surface that names the seat from the spawn point
 * (24 §3.4–§3.7, AC 8).
 *
 * Four variants, one component, because they are four dressings of the same
 * wall and not four scenes (24 §3.0). Which one to draw is the `SceneModel`'s
 * decision, taken from `RoleSet.south`; everything here is how it is built.
 *
 * - **shopfront** — glass `y` 0 → 3.5 and a checkout counter. The only room
 *   in the game you can see out of, and the only one with people in it.
 * - **dock-doors** — three roller doors at `−7, 0, +7`. No glass, no people.
 * - **cross-dock** — no doors and, since 2026-09-22, no piers and no lintel
 *   either: the bay is open at both ends, and the accent aisle runs straight
 *   through it past the order desk between two waist-high kerbs.
 * - **dispatch-yard** — one door, onto the yard the finished beer leaves by.
 *
 * `doorClosed` is `SceneModel.dispatchDoorClosed`, which is `gameOver`: the
 * door drops to the floor and the week cannot leave the building. One mesh
 * translated, per 24 §4.3 — not a second scene, not an overlay.
 *
 * **Every repeated part here is merged** (24 §7.1, AC 19): five mullions are
 * one mesh, three door frames are one and their three leaves are another —
 * they roll up together, because `gameOver` is one state for the whole hall —
 * and the cross-dock's two kerbs are one. What stays separate is what differs:
 * a material, or a coordinate frame. The shopfront's counter and its accent
 * top are two materials; the cross-dock's kerbs sit on the south wall while
 * its aisle runs the length of the hall, so they are in different frames and
 * cannot share a mesh.
 */

export interface SouthFaceProps {
  readonly variant: SouthFixture
  /** The fixture's centre on the south wall. */
  readonly position: Vec3
  readonly accent: string
  /** True when the game is over (24 §4.3). */
  readonly doorClosed: boolean
}

export function SouthFace({ variant, position, accent, doorClosed }: SouthFaceProps): ReactElement {
  const z = position[2]
  const paint = accentMaterial(accent)

  if (variant === 'shopfront') {
    const { glassHeight, counter } = FIXTURE_SIZE.shopfront
    return (
      <group>
        <mesh
          geometry={UNIT_PLANE}
          material={GLASS_MATERIAL}
          position={[0, glassHeight / 2, z - 0.1]}
          scale={[HALL.width - 2, glassHeight, 1]}
        />
        {/* Mullions, so the glass reads as a shopfront rather than as a hole
            in the wall where the wall should be. */}
        <mesh
          geometry={SHOPFRONT_MULLIONS_GEOMETRY}
          material={STRUCTURE_MATERIAL}
          position={[0, 0, z - 0.1]}
        />
        {/* The checkout the two customers stand at (24 §3.4). */}
        <mesh
          geometry={UNIT_BOX}
          material={SURFACE_MATERIAL}
          position={[0, counter.height / 2, CHECKOUT_Z]}
          scale={[counter.width, counter.height, counter.depth]}
        />
        <mesh
          geometry={UNIT_BOX}
          material={paint}
          position={[0, counter.height, CHECKOUT_Z]}
          scale={[counter.width, 0.08, counter.depth]}
        />
      </group>
    )
  }

  if (variant === 'dock-doors') {
    const { height } = FIXTURE_SIZE.dockDoor
    // Shut, a leaf fills its opening; open, it is rolled up above the lintel.
    const leafY = doorClosed ? height / 2 : height + 0.5
    return (
      <group position={[0, 0, z - 0.2]}>
        <mesh geometry={DOCK_FRAMES_GEOMETRY} material={STRUCTURE_MATERIAL} />
        <mesh geometry={DOCK_LEAVES_GEOMETRY} material={paint} position={[0, leafY, 0]} />
      </group>
    )
  }

  if (variant === 'cross-dock') {
    return (
      <group>
        {/* The through-aisle of 24 §3.6, painted down `x = 0` from the
            receiving bay to the dispatch bay and straight past the order desk:
            five arrows and the two edge stripes that make them a lane, in one
            merged geometry. In world coordinates, not the wall's — the aisle
            is the length of the hall.

            This is now the *whole* of the Distributor's identity at the south
            end. Two piers and the lintel across them were the third of the
            three overhead structures a player asked to have removed on
            2026-09-22, and §3.6's "the only room you can see all the way
            through" survives them: with nothing built across the bay, the
            aisle runs out of the building, and the three-tier racking either
            side of it is the other half of what AC 8 asks a player to
            recognise the seat by. */}
        <mesh geometry={CROSS_DOCK_AISLE_GEOMETRY} material={paint} />
        {/* Two waist-high kerbs where the aisle leaves the hall. They say
            "through here" at 0.9 m; nothing at all is over the player's head. */}
        <mesh
          geometry={CROSS_DOCK_KERBS_GEOMETRY}
          material={STRUCTURE_MATERIAL}
          position={[0, 0, z - 0.2]}
        />
      </group>
    )
  }

  const { width, height } = FIXTURE_SIZE.dispatchDoor
  const doorY = doorClosed ? height / 2 : height + 0.5
  return (
    <group position={[0, 0, z - 0.2]}>
      <mesh
        geometry={UNIT_BOX}
        material={STRUCTURE_MATERIAL}
        position={[0, height / 2, 0.12]}
        scale={[width + 0.6, height + 0.4, 0.2]}
      />
      <mesh
        geometry={UNIT_BOX}
        material={paint}
        position={[0, doorY, 0]}
        scale={[width, height, 0.14]}
      />
    </group>
  )
}

export default SouthFace
