/**
 * Every geometry, material, texture and dressing dimension the scene draws
 * with, created **once** at module scope (24 §7.4).
 *
 * Tequila's scene recreates materials and geometries inside render, which is
 * the defect 24 §7.4 names: a `new THREE.MeshStandardMaterial()` in a
 * component body is a fresh shader program compiled on the frame a week
 * closes. Everything below is built once per page load and shared by every
 * fixture that wears it, so a re-render of the whole board allocates nothing.
 *
 * ## Why dimensions live here and coordinates do not
 *
 * 24 §8.1 is strict: *a geometry decision made inside `WarehouseScene.tsx`
 * rather than in `buildSceneModel` is untestable, and is a defect.* Every
 * **position**, **count**, **string** and **hex** the scene draws therefore
 * comes from the `SceneModel`, and none of them are in this file.
 *
 * What is here is the other half — how wide a pen's rail is, how thick a desk
 * slab is, how tall a roller door stands. The model carries a fixture's
 * centre and kind; it does not carry its dressing, and a pen that is 7 m wide
 * rather than 6 m is not something 24 §9 asserts. Keeping those numbers in one
 * named record rather than scattered through six components is what makes the
 * distinction auditable: if a dimension ever *does* become load-bearing — the
 * way lane spacing and racking height already are — it moves to
 * `sceneLayout.ts` and the renderer reads it from there, as it already does
 * for `SUPPLY_LANE_X`, `DOCK_DOOR_X`, `RACKING_BAYS` and `CHECKOUT_Z`.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {
  CRATE_PITCH,
  DOCK_DOOR_X,
  HALL,
  ZONES,
  RACKING_BAYS,
  RACKING_HEIGHT,
  SIGN_HEIGHT,
  SUPPLY_LANE_X,
  type Vec3,
} from './sceneLayout'
import { ARCHITECTURE_HEX } from './scenePalette'

/**
 * A readonly `Vec3` as the mutable triple react-three-fiber's `position` and
 * `args` props take. The model's tuples are `readonly` because they are shared
 * constants; copying is a three-element allocation, and the alternative is a
 * cast that lies about ownership of a frozen array.
 */
export function toTriple(v: Vec3): [number, number, number] {
  return [v[0], v[1], v[2]]
}

/* ─── Shared geometry ─── */

/** A 1 m cube, scaled by whatever wears it. Every wall, rail, slab, post and
 *  shelf in the hall is this one buffer. */
export const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1)

/** A 1 m quad on the XY plane. Painted floor, glass, contact patches and
 *  signage backers are all this one, rotated and scaled. */
export const UNIT_PLANE = new THREE.PlaneGeometry(1, 1)

/**
 * A unit cylinder, 20 radial segments. The FACTORY's four brewing tanks are
 * four instances of this (24 §3.7): ~800 triangles for the whole brewhouse,
 * zero bytes of download, where a tank model would have been a fifth GLB.
 */
export const UNIT_CYLINDER = new THREE.CylinderGeometry(1, 1, 1, 20)

/**
 * The backlog pen's warning triangle, flat-extruded.
 *
 * The same glyph the 2D `BacklogIcon` draws, because `19 §3.4` and `19` AC 8
 * are explicit that **colour is never the only signal**: the pen carries the
 * fence, this mark and the word OWED, and a player who cannot separate
 * `#a8420a` from `#1f6f9c` still reads all three.
 */
const WARNING_SHAPE = new THREE.Shape()
WARNING_SHAPE.moveTo(0, 0.58)
WARNING_SHAPE.lineTo(-0.5, -0.34)
WARNING_SHAPE.lineTo(0.5, -0.34)
WARNING_SHAPE.closePath()

export const WARNING_GLYPH = new THREE.ExtrudeGeometry(WARNING_SHAPE, {
  depth: 0.08,
  bevelEnabled: false,
})

/* ─── The floor grid ─── */

/**
 * The floor's grid, as **one tiled texture** on one quad.
 *
 * 24 §7.4 names Tequila's 50 drei `<Line>` components for exactly this — 50
 * draw calls and 50 objects in the scene graph to draw something a 128 px
 * canvas repeated 30 × 21 times draws for one. Built on first use rather than
 * at module evaluation because it needs a `<canvas>`, and this module is
 * imported by files a test may load without a DOM.
 */
let gridTexture: THREE.Texture | null = null

export function floorGridTexture(): THREE.Texture {
  if (gridTexture) return gridTexture

  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')

  if (context) {
    context.fillStyle = ARCHITECTURE_HEX.border
    context.fillRect(0, 0, size, size)
    context.strokeStyle = ARCHITECTURE_HEX.borderStrong
    context.lineWidth = 3
    context.strokeRect(0, 0, size, size)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  // One cell every two metres, across the whole 60 × 42 floor — a grid the
  // player can pace out, which is what makes the hall readable as a space.
  texture.repeat.set(HALL.width / 2, HALL.depth / 2)
  texture.anisotropy = 4

  gridTexture = texture
  return texture
}

/* ─── Shared materials ─── */

/** Flat-shaded, unlit-looking architecture: the room is polygons under one
 *  hemisphere light, and a glossy warehouse reads as plastic. */
function matte(color: string, roughness = 0.9): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 })
}

/**
 * The four walls (24 §3.1, amended 2026-09-22).
 *
 * This was `ROOM_MATERIAL`, on the **inside** of one box: `BackSide` gave
 * floor, walls and ceiling in one mesh. There is no ceiling any more — the
 * hall is open to `skyCyan` — so the room is four inward-facing planes merged
 * into one geometry (`WALLS_GEOMETRY`) with the floor's own textured quad
 * under them, which is the same one draw call for the same four walls.
 *
 * `FrontSide`, the default, because every plane in that merge is already
 * turned to face into the hall; there is no camera position outside them.
 */
export const WALL_MATERIAL = new THREE.MeshStandardMaterial({
  color: ARCHITECTURE_HEX.border,
  roughness: 0.95,
  metalness: 0,
})

/** Uprights, rails, frames, door leaves, kerbs. */
export const STRUCTURE_MATERIAL = matte(ARCHITECTURE_HEX.borderStrong, 0.85)

/** Desk tops, plinths, boards — the lighter of the two neutrals, so a fixture
 *  reads against the wall behind it. */
export const SURFACE_MATERIAL = matte(ARCHITECTURE_HEX.surfaceRaised, 0.8)

/** The RETAILER's south wall, and the only glass in the game (24 §3.4). */
export const GLASS_MATERIAL = new THREE.MeshStandardMaterial({
  color: ARCHITECTURE_HEX.surfaceRaised,
  roughness: 0.12,
  metalness: 0,
  transparent: true,
  opacity: 0.22,
})

/**
 * Contact grounding: a dark quad under every pile and every vehicle.
 *
 * 24 §7.4 turns shadows off entirely — Tequila sets `castShadow` on meshes
 * while never enabling `shadows` on its `<Canvas>`, which is dead code that
 * costs nothing and buys nothing. Objects still need to sit *on* the floor
 * rather than hover above it, so the grounding is painted: no shadow map, no
 * second render pass, one transparent quad.
 */
export const CONTACT_MATERIAL = new THREE.MeshBasicMaterial({
  color: '#000000',
  transparent: true,
  opacity: 0.16,
  depthWrite: false,
})

/** The empty-pallet ghost of 24 §4.2: where the stock goes, when there is
 *  none. An outline is not nothing, and a bare patch of floor is. */
export const GHOST_MATERIAL = new THREE.MeshBasicMaterial({
  color: ARCHITECTURE_HEX.borderStrong,
  transparent: true,
  opacity: 0.55,
})

/**
 * The prototype every wall-board frame is cloned from (24 §5.5).
 *
 * The ledger wall's frame swaps to `--color-order` for the 400 ms of a week
 * change. That swap is a `.color.set()` on a **clone** taken once per board,
 * never a new material per render: a material is a compiled shader program,
 * and recompiling one on the frame a week closes is the most expensive
 * possible moment to do it.
 */
export const FRAME_MATERIAL = matte(ARCHITECTURE_HEX.borderStrong, 0.8)

/**
 * One matte material per hex, made once and shared.
 *
 * Memoised because the whole scene uses at most a dozen tints — four accents,
 * four soft accents and six quantity hexes — so the cache holds a dozen
 * materials for the life of the tab rather than one per fixture per render,
 * which is the allocation 24 §7.4 names.
 */
const tinted = new Map<string, THREE.MeshStandardMaterial>()

function tintedMaterial(hex: string): THREE.MeshStandardMaterial {
  const existing = tinted.get(hex)
  if (existing) return existing
  const material = matte(hex, 0.88)
  tinted.set(hex, material)
  return material
}

/**
 * The role accent, for **architecture**: floor stripe, wall band, desk canopy,
 * sign frame, door leaf, tank band.
 *
 * 24 §3.8's rule is absolute — *an accent hex is only ever applied to
 * architecture; a quantity hex is only ever applied to crates* — and the
 * reason this and `quantityMaterial` are two names over one cache is that the
 * rule should be visible at the call site. `--color-inventory` is the *same*
 * hex as `--color-role-retailer`, so a Retailer's walls and stock would be one
 * indistinguishable blue if a fixture ever reached for the wrong one; a
 * mis-named call is something a diff can catch, and a shared `tint()` is not.
 */
export function accentMaterial(hex: string): THREE.MeshStandardMaterial {
  return tintedMaterial(hex)
}

/** A quantity hex, for the marks that stand for a number — a pool's crates,
 *  and the warning glyph beside the pile it belongs to (24 §3.8). */
export function quantityMaterial(hex: string): THREE.MeshStandardMaterial {
  return tintedMaterial(hex)
}

/* ─── Fog: removed (24 §3.1, amended 2026-09-22) ─── */

/**
 * There is no fog any more, and this comment is the reason rather than a
 * deleted constant.
 *
 * The hall had `<fog>` in `--color-surface-sunken`, matching a background in
 * the same bone hue, so the far wall softened into the room instead of into a
 * seam. Both halves of that are gone: the background is `skyCyan` and there is
 * no ceiling, so fog in the old hue would sit as a bone haze across the tops
 * of the walls where the sky is, and fog retuned to the sky's cyan would wash
 * the far signs — and a player has just asked for *more* contrast on the
 * signs, not less. An open yard 60 × 42 does not need a depth cue at 26 m.
 */

/* ─── Dressing dimensions ─── */

/** How far a painted quad floats above the floor, so it does not z-fight the
 *  grid it is painted on. Layered: paint, then pads, then ghosts. */
export const PAINT_Y = 0.012
export const PAD_Y = 0.02
export const GHOST_Y = 0.03

/**
 * The dressing of each fixture kind. See this file's header for why these are
 * here and the coordinates are not.
 */
export const FIXTURE_SIZE = {
  /** The receiving and dispatch bays' painted floor, spanning the four lanes
   *  at `x = ±9` with the front lane's 1.15× stack inside it. */
  bayPaint: { width: HALL.width, depth: 10 },
  /** The order road's painted surface, running west from the bay to the wall. */
  roadPaint: { width: 17, depth: 3.2 },
  /**
   * The upstream gate, as a **painted threshold** on the road (amended
   * 2026-09-22).
   *
   * It was `{ width: 6.4, height: 4.4, post: 0.34 }` — two posts and a lintel
   * the courier drove under — and a player asked for the arches to go. The
   * place survives the arch: the threshold is where the road leaves the hall,
   * the courier stands on it, and the signs it carried hang over it unchanged.
   * It is laid at `GHOST_Y`, above both the road paint under it and the
   * truck's contact quad at `PAD_Y`, so the three do not z-fight.
   */
  gateThreshold: { width: 4.4, depth: 3.2 },
  /** A placard's post. Its sign height comes from `SIGN_HEIGHT.placard`. */
  placardPost: { width: 0.12, depth: 0.12 },
  /** The stock floor's pallet pad, and the ghost outline of an empty one.
   *  Sized by `padSize` arithmetic to hold 8 × 3 crates at `CRATE_PITCH`
   *  (9.76 × 3.66) with a margin, rather than by a guess. */
  pallet: { width: 11, depth: 4.8 },
  /** The backlog pen: four rails and a gate-less corner, waist high. Wide
   *  enough that a capped 8 × 3 pile stands clear of every rail. */
  pen: { width: 11.6, depth: 5.2, rail: 0.13, height: 1.1 },
  /** The order desk, its canopy, and the clipboard lying on it (24 §4.3). */
  desk: { width: 4.4, depth: 1.5, height: 1.05, canopyY: 3.1, canopyThickness: 0.22 },
  /** A wall board — the ledger, the team board, the leaderboard on its back. */
  board: { width: 5, height: 4.2, frame: 0.16, thickness: 0.14 },
  /** A plinth: the cost corner's money table and the chain model table. */
  plinth: { width: 2.6, depth: 1.8, height: 0.9 },
  /** The neighbour hatch, recessed into the east wall. */
  hatch: { width: 3.6, height: 3.4 },
  /** Racking: uprights, shelf slabs and the footprint of one bay. */
  racking: { width: 5, depth: 1.6, upright: 0.16, shelf: 0.12 },
  /** A brewing tank (24 §3.7 gives both figures). */
  tank: { radius: 1.4, height: 4 },
  /** One of the WHOLESALER's three roller doors (24 §3.5). */
  dockDoor: { width: 5.4, height: 5 },
  /** The RETAILER's glass south wall, `y` 0 → 3.5, and its checkout counter. */
  shopfront: { glassHeight: 3.5, counter: { width: 11, depth: 0.9, height: 1.05 } },
  /** The FACTORY's single dispatch door, which `gameOver` shuts (24 §4.3). */
  dispatchDoor: { width: 8, height: 5.4 },
  /** The accent spine stripe down the order axis, and the band along the far
   *  wall — two of the four levers 24 §3.0 gives the role accent. */
  spine: { width: 1.6 },
  /**
   * The band rides one metre below the top of the wall, wherever that is.
   *
   * It was a hardcoded `y: 6`, which was the wall height at the time — so it
   * sat at the top by coincidence rather than by rule, and stayed at 6 when
   * the walls went to 10, stranded halfway up (2026-09-22).
   */
  wallBand: { height: 1, y: HALL.wallHeight - 1 },
  /**
   * The DISTRIBUTOR's through-aisle, which is now the whole of its south face
   * (24 §3.6, amended 2026-09-22).
   *
   * Two piers and a lintel made the third of the overhead structures a player
   * asked to have removed. §3.6's identity — *"the only room you can see all
   * the way through"* — is carried by what is left: a painted aisle the full
   * length of the hall, edged in the accent and arrowed down the middle, and
   * two waist-high kerbs where it leaves the building. A kerb is not a portal:
   * there is nothing over the player's head.
   */
  crossDock: { aisleHalfWidth: 3.5, edge: 0.25, kerb: { width: 1.4, height: 0.9, span: 5.6 } },
} as const

/**
 * The floor patch a pile of `gridWidth × gridDepth` crates stands on.
 *
 * **`CRATE_PITCH`, the same figure `CratePile.tsx` steps by**, and that is the
 * whole point of the amendment of 2026-09-22: this function used to guess
 * `1.1 × 1.18` while the pile was laid out at `size × 1.06`, so the pad and
 * the pile it was under were built from two different numbers. One constant,
 * one pitch, and a pad is exactly the pile's footprint.
 */
export function padSize(gridWidth: number, gridDepth: number): [number, number] {
  return [Math.max(1, gridWidth) * CRATE_PITCH, Math.max(1, gridDepth) * CRATE_PITCH]
}

/* ─── Merged fixture geometry (24 §7.1, AC 19) ─── */

/**
 * One piece of a fixture, as a unit geometry plus the transform that places
 * it inside the fixture's own local frame.
 *
 * The fields are the three a `<mesh>` takes, on purpose: a merged fixture is
 * written here exactly as it used to be written in the component, and the
 * diff between the two is a `mergeParts([...])` wrapper and nothing else.
 */
interface MergePart {
  readonly geometry: THREE.BufferGeometry
  readonly position?: Vec3
  readonly rotation?: Vec3
  readonly scale?: Vec3
}

/** Scratch for {@link mergeParts}. Module scope because merging happens once
 *  per geometry at module evaluation and never again. */
const MERGE_MATRIX = new THREE.Matrix4()
const MERGE_POSITION = new THREE.Vector3()
const MERGE_EULER = new THREE.Euler()
const MERGE_QUATERNION = new THREE.Quaternion()
const MERGE_SCALE = new THREE.Vector3()

/**
 * `[HARD-WON]` Several static parts, baked into **one** geometry and therefore
 * one draw call (24 §7.1, AC 19).
 *
 * three.js issues one draw call per mesh whatever geometry and material that
 * mesh shares with its neighbours, so a pen drawn as four rails costs four
 * calls and a hall of nineteen such fixtures costs far more than §7.1's
 * *"fixtures ~14"* ever budgeted. This is the same move `gltfModels.ts` makes
 * on `truck.glb`'s 33 primitives, applied to the architecture: every part that
 * shares a **material** and never moves is merged, and what is left as a
 * separate mesh is what genuinely differs — a leaf that rolls up, a frame that
 * is recoloured per board, a glyph that takes its hex from a pool.
 *
 * The merge is legal only between geometries with the same attribute set and
 * the same indexed-ness, and `mergeGeometries` answers `null` when they
 * differ. Every caller below merges unit boxes, planes, cylinders or extrusions
 * that were chosen to agree, so a `null` here is a mistake in this file and
 * not a runtime condition: it throws at module evaluation, where the suite and
 * the first dev-server load both see it, rather than silently dropping a
 * fixture out of the hall.
 *
 * **What this may not do.** Only the *dressing* is merged — the shapes named
 * in `FIXTURE_SIZE` above. A position the `SceneModel` carries stays on the
 * mesh that wears the merged geometry, because baking it here would be exactly
 * the geometry-decision-in-the-renderer 24 §8.1 forbids.
 */
export function mergeParts(name: string, parts: readonly MergePart[]): THREE.BufferGeometry {
  const baked = parts.map((part) => {
    const geometry = part.geometry.clone()
    MERGE_POSITION.set(...(part.position ?? [0, 0, 0]))
    MERGE_EULER.set(...(part.rotation ?? [0, 0, 0]))
    MERGE_QUATERNION.setFromEuler(MERGE_EULER)
    MERGE_SCALE.set(...(part.scale ?? [1, 1, 1]))
    geometry.applyMatrix4(MERGE_MATRIX.compose(MERGE_POSITION, MERGE_QUATERNION, MERGE_SCALE))
    return geometry
  })

  const merged: THREE.BufferGeometry | null = mergeGeometries(baked)
  // The clones exist only as merge input; a kept clone is a second copy of the
  // hall's architecture on the GPU for the life of the tab.
  for (const geometry of baked) geometry.dispose()

  if (!merged) {
    throw new Error(
      `${name}: mergeGeometries refused these parts (24 §7.1). They must share ` +
        'an attribute set and all be indexed or all not — mixing an ExtrudeGeometry ' +
        'with a BoxGeometry is the usual cause.',
    )
  }

  merged.computeBoundingSphere()
  return merged
}

/**
 * The hall's four walls, as one geometry (24 §3.1, amended 2026-09-22).
 *
 * The room used to be the inside of a single `BoxGeometry` at `BackSide`,
 * which was one mesh for floor, walls **and ceiling**. A player asked for the
 * ceiling to go, and a box has no way to drop one face, so the walls are four
 * planes turned to face into the hall and merged: the same one draw call, one
 * face fewer, and the sky where the roof was.
 *
 * In **world** coordinates — `SceneShell` places this at the origin, because
 * the hall itself is at the origin.
 */
export const WALLS_GEOMETRY = mergeParts('hall walls', [
  // North, at `z = −halfDepth`, facing `+z`. A plane's default normal.
  {
    geometry: UNIT_PLANE,
    position: [0, HALL.wallHeight / 2, -HALL.halfDepth],
    scale: [HALL.width, HALL.wallHeight, 1],
  },
  // South, facing `−z`.
  {
    geometry: UNIT_PLANE,
    position: [0, HALL.wallHeight / 2, HALL.halfDepth],
    rotation: [0, Math.PI, 0],
    scale: [HALL.width, HALL.wallHeight, 1],
  },
  // West, facing `+x`.
  {
    geometry: UNIT_PLANE,
    position: [-HALL.halfWidth, HALL.wallHeight / 2, 0],
    rotation: [0, Math.PI / 2, 0],
    scale: [HALL.depth, HALL.wallHeight, 1],
  },
  // East, facing `−x`.
  {
    geometry: UNIT_PLANE,
    position: [HALL.halfWidth, HALL.wallHeight / 2, 0],
    rotation: [0, -Math.PI / 2, 0],
    scale: [HALL.depth, HALL.wallHeight, 1],
  },
])

/**
 * The shell's two painted accents — the spine stripe down the order axis and
 * the band along the far wall — as one geometry (24 §3.0, §3.1).
 *
 * They wear the same accent material and neither ever moves, so they are one
 * mesh. `SceneShell` places it at the origin: both parts are already in world
 * coordinates, because the hall itself is.
 */
/** The spine starts where the bay's paint ends, so the two meet rather than
 *  stack at the same height. */
const BAY_PAINT_SOUTH_EDGE = ZONES.receivingBay[2] + FIXTURE_SIZE.bayPaint.depth / 2
const SPINE_SOUTH_END = HALL.halfDepth - 2
const SPINE_LENGTH = SPINE_SOUTH_END - BAY_PAINT_SOUTH_EDGE
const SPINE_Z = (SPINE_SOUTH_END + BAY_PAINT_SOUTH_EDGE) / 2

export const SHELL_ACCENT_GEOMETRY = mergeParts('shell accent', [
  {
    // From the south edge of the bay's paint down to the dispatch end. It used
    // to run the full depth of the hall straight through the bay, and two
    // accent quads at one `PAINT_Y` is the seam a player reads as a separate
    // blue patch under each lane (2026-09-22).
    geometry: UNIT_PLANE,
    position: [0, PAINT_Y, SPINE_Z],
    rotation: [-Math.PI / 2, 0, 0],
    scale: [FIXTURE_SIZE.spine.width, SPINE_LENGTH, 1],
  },
  {
    geometry: UNIT_PLANE,
    position: [0, FIXTURE_SIZE.wallBand.y, -HALL.halfDepth + 0.06],
    scale: [HALL.width - 1, FIXTURE_SIZE.wallBand.height, 1],
  },
])

/**
 * **The three overhead structures are gone** (amended 2026-09-22).
 *
 * `GANTRY_GEOMETRY` (a beam on two posts over the receiving bay), the
 * upstream gate's posts-and-lintel, and `CROSS_DOCK_PIERS_GEOMETRY` with the
 * lintel above it were each three rectangles forming a portal, and a player
 * who walked the hall asked for all of them: *"remove the arches that you
 * added … remove all ceiling like structures that you made with three
 * rectangles, no need for these they just make less space."*
 *
 * What was structural about them was nothing; what was load-bearing was the
 * **signs they carried**, and those stayed — `gantry-total`, `gantry-receipt`
 * and `gantry-empty` over the bay at `SIGN_HEIGHT.bayTotal`, and the three
 * upstream signs over the gate threshold. They are `PlayerView` figures §4.2
 * requires, not decoration.
 */

/**
 * The empty-pallet ghost of 24 §4.2 — four edges of an outline where the stock
 * would be — in the flat-on-the-floor frame its group is rotated into.
 */
export const PALLET_GHOST_GEOMETRY = mergeParts('pallet ghost', [
  {
    geometry: UNIT_PLANE,
    position: [0, -FIXTURE_SIZE.pallet.depth / 2, 0],
    scale: [FIXTURE_SIZE.pallet.width, 0.14, 1],
  },
  {
    geometry: UNIT_PLANE,
    position: [0, FIXTURE_SIZE.pallet.depth / 2, 0],
    scale: [FIXTURE_SIZE.pallet.width, 0.14, 1],
  },
  {
    geometry: UNIT_PLANE,
    position: [-FIXTURE_SIZE.pallet.width / 2, 0, 0],
    scale: [0.14, FIXTURE_SIZE.pallet.depth, 1],
  },
  {
    geometry: UNIT_PLANE,
    position: [FIXTURE_SIZE.pallet.width / 2, 0, 0],
    scale: [0.14, FIXTURE_SIZE.pallet.depth, 1],
  },
])

/** The four rails of a pen. The warning glyph is **not** here: it takes its
 *  hex from the pool standing inside the pen (24 §3.8). */
export const PEN_RAILS_GEOMETRY = mergeParts('pen rails', [
  {
    geometry: UNIT_BOX,
    position: [0, FIXTURE_SIZE.pen.height, -FIXTURE_SIZE.pen.depth / 2],
    scale: [FIXTURE_SIZE.pen.width, FIXTURE_SIZE.pen.rail, FIXTURE_SIZE.pen.rail],
  },
  {
    geometry: UNIT_BOX,
    position: [0, FIXTURE_SIZE.pen.height, FIXTURE_SIZE.pen.depth / 2],
    scale: [FIXTURE_SIZE.pen.width, FIXTURE_SIZE.pen.rail, FIXTURE_SIZE.pen.rail],
  },
  {
    geometry: UNIT_BOX,
    position: [-FIXTURE_SIZE.pen.width / 2, FIXTURE_SIZE.pen.height, 0],
    scale: [FIXTURE_SIZE.pen.rail, FIXTURE_SIZE.pen.rail, FIXTURE_SIZE.pen.depth],
  },
  {
    geometry: UNIT_BOX,
    position: [FIXTURE_SIZE.pen.width / 2, FIXTURE_SIZE.pen.height, 0],
    scale: [FIXTURE_SIZE.pen.rail, FIXTURE_SIZE.pen.rail, FIXTURE_SIZE.pen.depth],
  },
])

/** The desk slab alone — the game-over desk, which has lost the thing you
 *  write an order on (24 §4.3). */
const DESK_SLAB: MergePart = {
  geometry: UNIT_BOX,
  position: [0, FIXTURE_SIZE.desk.height / 2, 0],
  scale: [FIXTURE_SIZE.desk.width, FIXTURE_SIZE.desk.height, FIXTURE_SIZE.desk.depth],
}

export const DESK_SURFACE_GEOMETRY = mergeParts('desk surface', [DESK_SLAB])

/**
 * The desk slab **and** the clipboard lying on it, merged — they wear the same
 * surface material, and the clipboard's presence is a two-way switch between
 * two static geometries rather than a mesh that comes and goes (24 §4.3).
 */
export const DESK_SURFACE_WITH_CLIPBOARD_GEOMETRY = mergeParts('desk surface with clipboard', [
  DESK_SLAB,
  {
    geometry: UNIT_BOX,
    position: [0, FIXTURE_SIZE.desk.height + 0.03, 0.3],
    rotation: [-Math.PI / 12, 0, 0],
    scale: [0.7, 0.04, 0.95],
  },
])

/** The two posts the desk canopy stands on. */
export const DESK_POSTS_GEOMETRY = mergeParts('desk posts', [
  {
    geometry: UNIT_BOX,
    position: [-(FIXTURE_SIZE.desk.width + 1) / 2, FIXTURE_SIZE.desk.canopyY / 2, 0],
    scale: [0.14, FIXTURE_SIZE.desk.canopyY, 0.14],
  },
  {
    geometry: UNIT_BOX,
    position: [(FIXTURE_SIZE.desk.width + 1) / 2, FIXTURE_SIZE.desk.canopyY / 2, 0],
    scale: [0.14, FIXTURE_SIZE.desk.canopyY, 0.14],
  },
])

/**
 * The racking, merged per material and per tier count: **both** bays' end
 * frames in one geometry, and all their shelf slabs in another.
 *
 * Keyed by tier count because that is what varies — the bay positions come
 * from `RACKING_BAYS` and the heights from `RACKING_HEIGHT`, both frozen in
 * `sceneLayout.ts`, so a tier count names one fixed pair of geometries. The
 * shelves are separate from the uprights because they wear the role's soft
 * accent and the uprights wear structural grey (24 §3.8).
 *
 * These are in **world** coordinates, as `Racking.tsx` has always been: the
 * bays are placed by the layout and not by the fixture's own centre.
 */
function rackingUprights(tiers: 1 | 2 | 3): THREE.BufferGeometry {
  const top = RACKING_HEIGHT[tiers]
  const { width, depth, upright } = FIXTURE_SIZE.racking
  const parts: MergePart[] = []
  for (const bay of RACKING_BAYS[tiers]) {
    for (const end of [-width / 2, width / 2]) {
      parts.push({
        geometry: UNIT_BOX,
        position: [bay[0] + end, top / 2, bay[2]],
        scale: [upright, top, depth],
      })
    }
  }
  return mergeParts(`racking uprights ${tiers}`, parts)
}

function rackingShelves(tiers: 1 | 2 | 3): THREE.BufferGeometry {
  const top = RACKING_HEIGHT[tiers]
  const { width, depth, shelf } = FIXTURE_SIZE.racking
  const parts: MergePart[] = []
  for (const bay of RACKING_BAYS[tiers]) {
    for (let index = 0; index < tiers; index += 1) {
      parts.push({
        geometry: UNIT_BOX,
        position: [bay[0], ((index + 1) / tiers) * top, bay[2]],
        scale: [width, shelf, depth],
      })
    }
  }
  return mergeParts(`racking shelves ${tiers}`, parts)
}

export const RACKING_UPRIGHTS_GEOMETRY: Record<1 | 2 | 3, THREE.BufferGeometry> = {
  1: rackingUprights(1),
  2: rackingUprights(2),
  3: rackingUprights(3),
}

export const RACKING_SHELVES_GEOMETRY: Record<1 | 2 | 3, THREE.BufferGeometry> = {
  1: rackingShelves(1),
  2: rackingShelves(2),
  3: rackingShelves(3),
}

/** The FACTORY's four tank bodies, over the four production lanes, in the
 *  brewhouse's local frame. */
export const BREWHOUSE_TANKS_GEOMETRY = mergeParts(
  'brewhouse tanks',
  SUPPLY_LANE_X.map((x: number) => ({
    geometry: UNIT_CYLINDER,
    position: [x, FIXTURE_SIZE.tank.height / 2, 0] as Vec3,
    scale: [FIXTURE_SIZE.tank.radius, FIXTURE_SIZE.tank.height, FIXTURE_SIZE.tank.radius] as Vec3,
  })),
)

/** The four accent bands, at eye height, so the row reads as this role's
 *  brewhouse and not as four grey drums (24 §3.7). */
export const BREWHOUSE_BANDS_GEOMETRY = mergeParts(
  'brewhouse bands',
  SUPPLY_LANE_X.map((x: number) => ({
    geometry: UNIT_CYLINDER,
    position: [x, HALL.eyeHeight, 0] as Vec3,
    scale: [FIXTURE_SIZE.tank.radius * 1.02, 0.45, FIXTURE_SIZE.tank.radius * 1.02] as Vec3,
  })),
)

/** The RETAILER's five shopfront mullions, in the glass wall's local frame.
 *  Five rather than three across a 60 m wall, and still one merged mesh. */
export const SHOPFRONT_MULLIONS_GEOMETRY = mergeParts(
  'shopfront mullions',
  [-24, -12, 0, 12, 24].map((x) => ({
    geometry: UNIT_BOX,
    position: [x, FIXTURE_SIZE.shopfront.glassHeight / 2, 0] as Vec3,
    scale: [0.16, FIXTURE_SIZE.shopfront.glassHeight, 0.16] as Vec3,
  })),
)

/** The WHOLESALER's three roller-door frames (24 §3.5), in the wall's frame. */
export const DOCK_FRAMES_GEOMETRY = mergeParts(
  'dock frames',
  DOCK_DOOR_X.map((x) => ({
    geometry: UNIT_BOX,
    position: [x, FIXTURE_SIZE.dockDoor.height / 2, 0.12] as Vec3,
    scale: [FIXTURE_SIZE.dockDoor.width + 0.5, FIXTURE_SIZE.dockDoor.height + 0.4, 0.2] as Vec3,
  })),
)

/**
 * The three door leaves, merged around `y = 0`.
 *
 * All three roll up together — `doorClosed` is `gameOver`, which is one state
 * for the whole hall — so the thing that moves is the mesh's own `y`, and
 * three leaves that move as one are one mesh (24 §4.3).
 */
export const DOCK_LEAVES_GEOMETRY = mergeParts(
  'dock leaves',
  DOCK_DOOR_X.map((x) => ({
    geometry: UNIT_BOX,
    position: [x, 0, 0] as Vec3,
    scale: [FIXTURE_SIZE.dockDoor.width, FIXTURE_SIZE.dockDoor.height, 0.14] as Vec3,
  })),
)

/**
 * The DISTRIBUTOR's through-aisle: five arrows down `x = 0` and the two edge
 * stripes that make them a lane (24 §3.6, amended 2026-09-22).
 *
 * In **world** coordinates and not the south face's, because the aisle runs
 * the length of the hall from the receiving bay to the dispatch bay and
 * straight past the order desk. With the piers and their lintel removed this
 * is what carries §3.6's identity — *"the only room you can see all the way
 * through"* — together with the three-tier racking either side of it, which is
 * the other half of what AC 8 asks a player to recognise the seat by.
 *
 * Merged, so the whole aisle is one draw call. The stripes stand off the
 * spine stripe the shell already paints down `x = 0`: they sit at `±3.5`,
 * where the spine is 1.6 wide, so the two accents never share a plane.
 */
export const CROSS_DOCK_AISLE_GEOMETRY = mergeParts('cross-dock aisle', [
  ...[-15, -8, -1, 6, 13].map((z) => ({
    geometry: UNIT_PLANE,
    position: [0, PAINT_Y, z] as Vec3,
    rotation: [-Math.PI / 2, 0, 0] as Vec3,
    scale: [1.4, 3, 1] as Vec3,
  })),
  ...[-FIXTURE_SIZE.crossDock.aisleHalfWidth, FIXTURE_SIZE.crossDock.aisleHalfWidth].map((x) => ({
    geometry: UNIT_PLANE,
    position: [x, PAINT_Y, 0] as Vec3,
    rotation: [-Math.PI / 2, 0, 0] as Vec3,
    scale: [FIXTURE_SIZE.crossDock.edge, HALL.depth - 2, 1] as Vec3,
  })),
])

/**
 * The two kerbs flanking the mouth of the cross-dock, in the south face's own
 * frame.
 *
 * Waist-high and merged. They are what is left of the piers, and they are
 * deliberately below eye height: the thing a player objected to was the
 * structure over their head, and a kerb the aisle runs between says "drive
 * through here" without one.
 */
export const CROSS_DOCK_KERBS_GEOMETRY = mergeParts(
  'cross-dock kerbs',
  [-FIXTURE_SIZE.crossDock.kerb.span, FIXTURE_SIZE.crossDock.kerb.span].map((x) => ({
    geometry: UNIT_BOX,
    position: [x, FIXTURE_SIZE.crossDock.kerb.height / 2, 0] as Vec3,
    scale: [
      FIXTURE_SIZE.crossDock.kerb.width,
      FIXTURE_SIZE.crossDock.kerb.height,
      0.8,
    ] as Vec3,
  })),
)

/**
 * A placard's post, already standing on the floor rather than centred on the
 * origin, so the `InstancedMesh` that draws every placard in the hall writes
 * pure translations into its matrices (`PlacardPosts.tsx`).
 */
export const PLACARD_POST_GEOMETRY = new THREE.BoxGeometry(
  FIXTURE_SIZE.placardPost.width,
  SIGN_HEIGHT.placard,
  FIXTURE_SIZE.placardPost.depth,
)
PLACARD_POST_GEOMETRY.translate(0, SIGN_HEIGHT.placard / 2, 0)
