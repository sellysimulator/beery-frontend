import { useEffect, useMemo, useRef, type ReactElement } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { useMoneyModel } from './gltfModels'
import type { InstancePool } from './sceneModel'

/**
 * The cost corner's bills, as one `InstancedMesh` — `CratePile` for
 * `money.glb` (24 §7.2).
 *
 * The pool budget of 24 §7.1 counts money as one of its six instanced pools,
 * and `PILE_SCALE.money` caps it at twenty bills. Twenty individually
 * placed groups would be twenty draw calls for 720 triangles, which is the
 * arithmetic 24 §7.4 says Tequila got wrong and this board does not.
 *
 * **Why this is not `CratePile`.** `CratePile` is hard-wired to
 * `useCrateGeometry()` — every pool it draws is `box.glb`, which is right for
 * five of the six pools and wrong for this one. The stacking maths below is
 * therefore a second copy of that file's `crateOffset`, and the honest name
 * for that is duplication: the better shape is one pile component that takes
 * its geometry as a prop, and moving `CratePile` there is a Core change this
 * file does not make on its own.
 */


/** The air between bills, as a fraction of one. Flush, a stack of twenty
 *  reads as one green slab; this much and the eye counts notes. */
const BILL_GAP = 0.08

const SCRATCH_MATRIX = new THREE.Matrix4()
const SCRATCH_POSITION = new THREE.Vector3()
const SCRATCH_QUATERNION = new THREE.Quaternion()
const SCRATCH_SCALE = new THREE.Vector3(1, 1, 1)

/**
 * One geometry out of the normalised money prototype.
 *
 * `useMoneyModel` returns a `Group` — the de-textured, height-normalised stack
 * — and an `InstancedMesh` needs a single buffer, so the node transforms are
 * baked and the parts merged, exactly as `gltfModels.ts` bakes the truck's.
 * Merging can fail when attributes differ between primitives, and a bill that
 * cannot be merged is a missing prop, never a thrown render: the fallback is
 * the first part on its own.
 */
function billGeometry(prototype: THREE.Group): THREE.BufferGeometry | null {
  prototype.updateMatrixWorld(true)

  const parts: THREE.BufferGeometry[] = []
  prototype.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      const baked = node.geometry.clone()
      baked.applyMatrix4(node.matrixWorld)
      parts.push(baked)
    }
  })

  if (parts.length === 0) return null
  if (parts.length === 1) return parts[0]

  const merged = mergeGeometries(parts)
  if (!merged) return parts[0]
  // The clones existed only as merge input; two copies of the same buffer on
  // the GPU is the leak `gltfModels.ts` calls out in its own merge.
  for (const part of parts) part.dispose()
  merged.computeBoundingBox()
  return merged
}

export interface MoneyPileProps {
  readonly pool: InstancePool
}

export function MoneyPile({ pool }: MoneyPileProps): ReactElement | null {
  const prototype = useMoneyModel()
  const meshRef = useRef<THREE.InstancedMesh>(null)

  const geometry = useMemo(() => billGeometry(prototype), [prototype])

  /** The material `money.glb` shipped, taken off the normalised prototype. */
  const material = useMemo(() => {
    let found: THREE.Material | null = null
    prototype.traverse((node) => {
      if (found === null && node instanceof THREE.Mesh && !Array.isArray(node.material)) {
        found = node.material
      }
    })
    return found
  }, [prototype])

  /** A bill's own footprint, read off the geometry rather than re-declared,
   *  the way `CratePile` reads the crate's. */
  const step = useMemo(() => {
    const bounds = geometry?.boundingBox
    const size = bounds ? bounds.getSize(new THREE.Vector3()) : new THREE.Vector3(0.35, 0.35, 0.35)
    return size.multiplyScalar(1 + BILL_GAP)
  }, [geometry])

  const total = pool.stacks.reduce((sum, stack) => sum + Math.max(0, Math.floor(stack.count)), 0)

  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh || total === 0) return

    const perTier = Math.max(1, pool.gridWidth * pool.gridDepth)

    let instance = 0
    for (const stack of pool.stacks) {
      const bills = Math.max(0, Math.floor(stack.count))
      for (let index = 0; index < bills; index += 1) {
        const withinTier = index % perTier
        const column = withinTier % pool.gridWidth
        const row = Math.floor(withinTier / pool.gridWidth)
        const tier = Math.floor(index / perTier)

        SCRATCH_POSITION.set(
          stack.position[0] + (column - (pool.gridWidth - 1) / 2) * step.x,
          stack.position[1] + tier * step.y,
          stack.position[2] + (row - (pool.gridDepth - 1) / 2) * step.z,
        )
        SCRATCH_MATRIX.compose(SCRATCH_POSITION, SCRATCH_QUATERNION, SCRATCH_SCALE)
        mesh.setMatrixAt(instance, SCRATCH_MATRIX)
        instance += 1
      }
    }

    mesh.instanceMatrix.needsUpdate = true
    // Instanced bounds are not derived from the geometry; without this the
    // whole stack is culled the moment the camera looks away from the origin.
    mesh.computeBoundingSphere()
  }, [pool, step, total])

  if (!geometry || !material || total === 0) return null

  // The bills keep `money.glb`'s own textured material: an instance tint
  // multiplies, so any colour here would wash the note artwork out — which is
  // what made a stack of bills read as a plain white box (2026-09-22).
  return <instancedMesh ref={meshRef} args={[geometry, material, total]} />
}

export default MoneyPile
