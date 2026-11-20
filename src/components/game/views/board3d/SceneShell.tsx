import type { ReactElement } from 'react'
import * as THREE from 'three'
import { HALL } from './sceneLayout'
import {
  accentMaterial,
  floorGridTexture,
  SHELL_ACCENT_GEOMETRY,
  UNIT_PLANE,
  WALL_MATERIAL,
  WALLS_GEOMETRY,
} from './sceneMaterials'

/**
 * The hall itself: floor and four walls, **open to the sky** — and the two
 * pieces of architecture that carry the role accent.
 *
 * Every figure here is `HALL`'s: 30 × 42 at `y = 0`, walls at `x = ±15` and
 * `z = ±21`, ten metres tall, and nothing above them.
 *
 * **There is no ceiling** (amended 2026-09-22). A player walked the hall and
 * asked for it: *"take the ceiling away and replace it with a cyan sky."* The
 * room was the *inside* of one `BoxGeometry` at `BackSide`, which is one mesh
 * for floor, walls and roof and no way to drop a single face, so the walls are
 * now four inward-facing planes merged into one geometry and the floor's
 * textured quad carries the floor by itself. Same three draw calls, same
 * `SHELL_DRAW_COST`, one surface fewer.
 *
 * There is no drei `<Sky>`. The hall is open to the sky, but the player asked
 * for uniform light, and a flat `<color attach="background">` is uniform by
 * construction, cheaper, and the cyan they asked for. `WarehouseScene` sets it,
 * from `model.background`.
 *
 * **Three draw calls**, and `SHELL_DRAW_COST` is that number: the four merged
 * walls, one quad for the floor grid, and one merged geometry carrying both
 * painted accents. The stripe and the band drawn apart would have spent one
 * more — they wear the same accent material and neither moves, so they are one
 * mesh.
 */

/**
 * The floor's material, built on first mount because its texture needs a
 * `<canvas>` (see `floorGridTexture`). Cached at module scope all the same:
 * the board can remount — a toggle to 2D and back — and a second identical
 * texture on the GPU is a leak, not a cost.
 */
let floorMaterial: THREE.MeshStandardMaterial | null = null

function sharedFloorMaterial(): THREE.MeshStandardMaterial {
  if (!floorMaterial) {
    floorMaterial = new THREE.MeshStandardMaterial({
      map: floorGridTexture(),
      roughness: 0.96,
      metalness: 0,
    })
  }
  return floorMaterial
}

export interface SceneShellProps {
  /** `SceneModel.roleSet.accent` — architecture only, never a crate. */
  readonly accent: string
}

export function SceneShell({ accent }: SceneShellProps): ReactElement {
  const paint = accentMaterial(accent)

  return (
    <group>
      {/* The four walls, merged and already in world coordinates — there is
          nothing above them. */}
      <mesh geometry={WALLS_GEOMETRY} material={WALL_MATERIAL} />

      <mesh
        geometry={UNIT_PLANE}
        material={sharedFloorMaterial()}
        position={[0, 0.001, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[HALL.width, HALL.depth, 1]}
      />

      {/* The two painted accents, merged (`SHELL_ACCENT_GEOMETRY`): the spine
          stripe down the order axis — the hall's whole bet is that orders go
          north and beer comes south along one line, and this is that line on
          the floor under the player's feet — and the band along the far wall,
          the accent a player sees from spawn without turning round. Two of
          the four role-identity levers, one draw call. */}
      <mesh geometry={SHELL_ACCENT_GEOMETRY} material={paint} />
    </group>
  )
}

export default SceneShell
