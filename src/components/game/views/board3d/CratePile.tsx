import { useEffect, useMemo, useRef } from 'react'
import type { ReactElement } from 'react'
import * as THREE from 'three'
import { useCrateGeometry } from './gltfModels'
import { CRATE_CLEARANCE, CRATE_SIZE } from './sceneLayout'

/**
 * One `InstancedMesh` per pile, so a pile of any size is **one draw call**
 * (`24 §7.2`).
 *
 * This is the component `24 §7.4` names Tequila's failure against: it draws 90
 * pile boxes, 50 grid lines and 19 conveyor crates as individual meshes, and
 * pays a draw call for each. Here the largest pile the caps of `24 §4.2`
 * allow — 40 crates on the stock floor — costs exactly what an empty one does.
 *
 * The crates are the quantity, never the figure. `24 §4.1` is the rule: a
 * count may decide how many meshes are drawn and may never be read back off
 * them, which is why this component takes a `count` that `sceneModel.ts` has
 * already clamped and knows nothing about the field it came from.
 */

/**
 * The material every crate in every pool wears.
 *
 * Module scope, created once, never per render (`24 §7.4`). It stays **white**
 * on purpose: `instanceColor` multiplies the material colour, so any tint here
 * would darken every per-instance colour set below by that factor.
 */
const CRATE_MATERIAL = new THREE.MeshStandardMaterial({
  color: '#ffffff',
  roughness: 0.82,
  metalness: 0,
})

/**
 * The air between crates: `CRATE_CLEARANCE`, in **metres**, from
 * `sceneLayout.ts` and shared with everything sized around a pile.
 *
 * It was `size × 1.06` here — a percentage, which is a different gap on every
 * axis of a crate that is not a perfect cube, and which no other module
 * agreed with: `padSize` assumed `× 1.18`, and the pile signs assumed a stack
 * short enough to hang a sign over. A player walked the hall and reported the
 * piles clipping. One constant, added rather than multiplied, is the fix:
 * 12 cm of dark air on every axis, whatever `box.glb` is re-exported as.
 *
 * Stacked flush the crates read as one extruded slab; this much gap and the
 * eye counts boxes, which is the entire point of drawing them (`24 §1.1`).
 */

/**
 * How far each crate's tint is allowed to drift from the pile's colour.
 *
 * Forty crates in one hex is a wall of flat colour that hides its own
 * geometry under ambient light this soft. A deterministic ±6% on value —
 * deterministic so the pile does not shimmer when React re-renders it — keeps
 * every crate recognisably the pile's colour while giving the stack edges.
 * This is the reason the tint goes through `setColorAt` at all rather than
 * sitting on the material.
 */
const CRATE_SHADE_VARIANCE = 0.06

/** Scratch objects, reused across every write. Allocating per crate in a
 *  40-crate pile is 40 throwaway matrices per data change, for nothing. */
const SCRATCH_MATRIX = new THREE.Matrix4()
const SCRATCH_POSITION = new THREE.Vector3()
const SCRATCH_QUATERNION = new THREE.Quaternion()
const SCRATCH_SCALE = new THREE.Vector3()
const SCRATCH_COLOR = new THREE.Color()

/** A stack of crates standing on the floor at one spot. */
export interface CrateStack {
  /** Floor centre of the stack, in world metres. */
  readonly position: readonly [number, number, number]
  /** How many crates to draw — already divided and capped by `sceneModel.ts`. */
  readonly count: number
  /**
   * Per-stack size multiplier. `24 §4.2` renders the front supply-line lane at
   * `1.15` so the beer arriving next week is the biggest thing in the room.
   */
  readonly scale?: number
}

export interface CratePileProps {
  /** The pile's quantity hex from `scenePalette.ts` — never an accent
   *  (`24 §3.8`: accents are architecture, quantities are crates). */
  readonly color: string
  /** Crates per row, from the layout constants in `sceneLayout.ts`. */
  readonly gridWidth: number
  /** Rows before the stack starts a new tier, likewise from `sceneLayout.ts`. */
  readonly gridDepth: number
  /** Single-stack form: the count at {@link position}. */
  readonly count?: number
  /** Single-stack form: floor centre. Defaults to the parent's origin. */
  readonly position?: readonly [number, number, number]
  /**
   * Multi-stack form: several stacks sharing **one** pool.
   *
   * `24 §7.2` budgets the four supply-line lanes as a single pool with four
   * lane offsets, not four pools — the ceiling is eight pools and the scene
   * already wants six. When this is given it supersedes `count`/`position`.
   */
  readonly stacks?: readonly CrateStack[]
}

/** The floor centre a single-stack pile defaults to. */
const ORIGIN: readonly [number, number, number] = [0, 0, 0]

/**
 * Where crate `index` sits inside its stack: `gridWidth` across, `gridDepth`
 * back, then up a tier. Pure, and the only place the pile's shape is decided.
 */
function crateOffset(
  index: number,
  gridWidth: number,
  gridDepth: number,
  step: THREE.Vector3,
  target: THREE.Vector3,
): THREE.Vector3 {
  const perTier = Math.max(1, gridWidth * gridDepth)
  const withinTier = index % perTier
  const column = withinTier % gridWidth
  const row = Math.floor(withinTier / gridWidth)
  const tier = Math.floor(index / perTier)

  // Centred on the stack's own footprint, so `position` is the middle of the
  // pile and not its near-left corner — the zone centres of `24 §3.2` are
  // centres.
  return target.set(
    (column - (gridWidth - 1) / 2) * step.x,
    tier * step.y,
    (row - (gridDepth - 1) / 2) * step.z,
  )
}

export function CratePile({
  color,
  gridWidth,
  gridDepth,
  count,
  position,
  stacks,
}: CratePileProps): ReactElement | null {
  const geometry = useCrateGeometry()
  const meshRef = useRef<THREE.InstancedMesh>(null)

  const resolved = useMemo<readonly CrateStack[]>(
    () => stacks ?? [{ position: position ?? ORIGIN, count: count ?? 0 }],
    [stacks, position, count],
  )

  const total = resolved.reduce((sum, stack) => sum + Math.max(0, Math.floor(stack.count)), 0)

  /**
   * Centre-to-centre spacing, per axis: **the crate's own measured size plus
   * `CRATE_CLEARANCE`**.
   *
   * The size is read off the geometry rather than re-declared — `gltfModels.ts`
   * normalised `box.glb` to `CRATE_SIZE` on its longest axis, centred it in
   * `x`/`z` and grounded it at `y = 0`, and asking the geometry keeps the
   * spacing honest if that normalisation ever moves. The clearance is added,
   * not multiplied, so the gap is the same on the crate's short axes as on its
   * long one; `box.glb`'s crate measures 1.093 × 1.1 × 1.093 after
   * normalisation, and a percentage gap was 6.6 cm on one axis and 6.5 on the
   * others while every fixture around the pile had been sized from a third
   * number again.
   *
   * `CRATE_SIZE` is the fallback for a geometry with no bounding box, which
   * `extractCrateGeometry` always computes; it is here so the pile is never
   * laid out at zero pitch.
   */
  const step = useMemo(() => {
    const bounds = geometry.boundingBox
    const size = bounds
      ? bounds.getSize(new THREE.Vector3())
      : new THREE.Vector3(CRATE_SIZE, CRATE_SIZE, CRATE_SIZE)
    return size.addScalar(CRATE_CLEARANCE)
  }, [geometry])

  /**
   * Matrices and colours, written **once per data change and never per frame**
   * (`24 §7.2`) — at worst once per render of the board, which happens when a
   * week closes or a notice arrives, and never inside `useFrame`. Tequila's
   * `onNearObject` writing state every frame is the defect `24 §7.4` names; a
   * pile that re-uploaded 40 matrices every frame would be the same mistake
   * wearing different clothes.
   */
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh || total === 0) return

    const base = SCRATCH_COLOR.set(color)
    const { r, g, b } = base

    let instance = 0
    for (const stack of resolved) {
      const crates = Math.max(0, Math.floor(stack.count))
      const scale = stack.scale ?? 1
      SCRATCH_SCALE.setScalar(scale)

      for (let index = 0; index < crates; index += 1) {
        crateOffset(index, gridWidth, gridDepth, step, SCRATCH_POSITION)
        SCRATCH_POSITION.multiplyScalar(scale)
        SCRATCH_POSITION.x += stack.position[0]
        SCRATCH_POSITION.y += stack.position[1]
        SCRATCH_POSITION.z += stack.position[2]

        SCRATCH_MATRIX.compose(SCRATCH_POSITION, SCRATCH_QUATERNION, SCRATCH_SCALE)
        mesh.setMatrixAt(instance, SCRATCH_MATRIX)

        // Deterministic in the instance index: the same pile always shades the
        // same way, so nothing flickers across a re-render.
        const shade = 1 + ((instance % 3) - 1) * CRATE_SHADE_VARIANCE
        SCRATCH_COLOR.setRGB(r * shade, g * shade, b * shade)
        mesh.setColorAt(instance, SCRATCH_COLOR)

        instance += 1
      }
    }

    mesh.instanceMatrix.needsUpdate = true
    // `setColorAt` creates `instanceColor` on first use, so it is only
    // non-null after the loop above has run at least once.
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    // Instanced bounds are not derived from the geometry; without this the
    // whole pile is culled the moment the camera looks away from the origin.
    mesh.computeBoundingSphere()
  }, [resolved, color, gridWidth, gridDepth, step, total])

  // An empty pile draws nothing at all. `24 §4.2`'s empty states are
  // architecture — the pallet ghost, the fenced empty square — not a pool of
  // zero instances, and a zero-capacity `InstancedMesh` is not valid anyway.
  if (total === 0) return null

  return (
    <instancedMesh
      ref={meshRef}
      // `args` are constructor arguments: React Three Fiber rebuilds the mesh
      // when they change, which is exactly right when the capacity changes and
      // wasteful if anything stable were passed here. Geometry and material
      // are both shared singletons, so only `total` ever moves.
      args={[geometry, CRATE_MATERIAL, total]}
    />
  )
}

export default CratePile
