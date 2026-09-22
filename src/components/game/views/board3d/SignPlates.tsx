import { useEffect, useRef, type ReactElement } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { SIGN_PLATE_OFFSET } from './sceneLayout'
import { ARCHITECTURE_HEX } from './scenePalette'
import { BILLBOARD_GROUPS, BILLBOARD_YAW } from './signBillboard'
import type { SceneSign } from './sceneModel'

/**
 * The white rectangle behind every sign in the hall, as **one**
 * `InstancedMesh` — and the one `useFrame` that turns every sign and every
 * plate to face the player (24 §6.1, §7.1, AC 19; amended 2026-09-22).
 *
 * ## Why the plates exist
 *
 * A player who walked the hall reported that *"the contrast on the floating
 * text and the background is not correct"* and asked for *"a white rectangle
 * as a background"*. They were right, and the cause is on record: an earlier
 * round removed troika's `outlineWidth` because it renders as a second pass
 * over a second mesh, which doubled the largest line item in §7.1's budget.
 * That left `#23201a` ink floating over whatever happened to be behind it — a
 * crate pile, a truck, and since the roof came off, open cyan sky.
 *
 * ## Why they are one mesh
 *
 * A maximal view carries 33 signs. One plate mesh apiece is +33 draw calls
 * against `MAX_DRAW_CALLS` 90, on a scene whose worst view already stands at
 * 79 — it would fail AC 19 outright. Pooled, the whole hall's plates are a
 * single call, which is the same answer 24 §7.2 gives for crates and
 * `PlacardPosts.tsx` gives for posts, and here it is not an optimisation but
 * the difference between the plates existing and not.
 *
 * ## Why the billboarding lives here too
 *
 * The same player asked to *"make the text always face the player"*, and every
 * sign in the hall faces the **same** camera: there is exactly one billboard
 * yaw in the scene per frame. Computing it per sign would be thirty-odd
 * identical `atan2`s and thirty-odd `useFrame` callbacks. So this component
 * owns the only per-frame callback the board has: it reads the camera once,
 * writes `BILLBOARD_YAW`, turns every registered `SceneSign` group, and
 * composes the plate matrices from that same angle in the same pass.
 *
 * **Yaw only, never a full `lookAt`** (24 §5.1). A sign that also pitched
 * would tip as the player looked up and down, which in a walkable room reads
 * as broken geometry rather than as a label; upright is what a sign is. The
 * plates and the words share the angle exactly, so the plate can never slip
 * out from behind its own text.
 *
 * **Nothing here calls `setState`.** 24 §5.1's `[HARD-WON]` note is explicit
 * about it: this callback runs sixty times a second and mutates matrices and
 * an `Object3D.rotation` in place. The only React state in the whole path is
 * the `SceneModel` itself.
 *
 * This component decides nothing a test cannot see (24 §8.1): every plate's
 * size and every sign's `billboard` flag arrive on the model, measured by
 * `signPlateSize` in `buildSceneModel`.
 */

/**
 * The plate itself: a unit quad, scaled per instance to the sign it backs.
 *
 * Defined here rather than in `sceneMaterials.ts` because it has exactly one
 * consumer and its size means nothing without the per-instance scale below —
 * a `1 × 1` plane in the shared materials file would read as a fixture.
 */
const PLATE_GEOMETRY = new THREE.PlaneGeometry(1, 1)

/**
 * **Unlit, deliberately**, and this is the whole reason the plate reads as
 * white at all.
 *
 * The hall is now lit by a single `hemisphereLight` (24 §7.1, amended
 * 2026-09-22), which multiplies a lit surface by a blend of its sky and
 * ground colours that depends on which way the surface points. A
 * `meshStandardMaterial` plate would therefore be a *slightly different*
 * off-white on every sign, and a sign that billboards would change colour as
 * the player walked around it. `meshBasicMaterial` takes no light at all, so
 * every plate in the hall is exactly `--color-surface-raised` from every
 * angle — the same bone white as the walls and the boards, which is what
 * makes a plate look like a sign rather than like a lamp.
 *
 * `DoubleSide` because a wall-mounted plate does not billboard: it faces the
 * way its board faces, and a player who walks behind the ledger wall's rows
 * should see the back of a plate rather than the text hanging on nothing.
 */
const PLATE_MATERIAL = new THREE.MeshBasicMaterial({
  color: ARCHITECTURE_HEX.surfaceRaised,
  side: THREE.DoubleSide,
  // Half-opaque: enough to lift the ink off whatever is behind it, little
  // enough that the plate reads as a label on the hall rather than a card
  // pasted over it. `depthWrite` off so a plate never occludes the sign
  // behind it in the pool's single draw call.
  transparent: true,
  opacity: 0.7,
  depthWrite: false,
})

/** Scratch for the matrix writes. One hall is mounted at a time, exactly as
 *  `PlacardPosts.tsx` assumes for its own pool. */
const SCRATCH_MATRIX = new THREE.Matrix4()
const SCRATCH_POSITION = new THREE.Vector3()
const SCRATCH_QUATERNION = new THREE.Quaternion()
const SCRATCH_SCALE = new THREE.Vector3(1, 1, 1)
const SCRATCH_EULER = new THREE.Euler(0, 0, 0, 'YXZ')
const SCRATCH_DIRECTION = new THREE.Vector3()

/** A yaw no camera produces, so the first frame always writes the pool. */
const NEVER_DRAWN = Number.NaN

export interface SignPlatesProps {
  /** `SceneModel.signs`, in the model's own order — the instance index of a
   *  plate is its sign's index in this array. */
  readonly signs: readonly SceneSign[]
}

export function SignPlates({ signs }: SignPlatesProps): ReactElement | null {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const lastYaw = useRef(NEVER_DRAWN)
  const total = signs.length

  /**
   * Write every plate's matrix at one yaw.
   *
   * Not a hook and not memoised: it is called from an effect and from the one
   * `useFrame`, and both call it with the mesh already in hand.
   */
  function writePool(mesh: THREE.InstancedMesh, yaw: number): void {
    for (let index = 0; index < total; index += 1) {
      const item = signs[index]
      const facing = item.billboard ? yaw : item.rotationY
      SCRATCH_EULER.set(0, facing, 0)
      SCRATCH_QUATERNION.setFromEuler(SCRATCH_EULER)
      // Behind the words along the sign's own facing, never along world `z`:
      // a billboarded plate that stepped back along a fixed axis would swing
      // in front of its own text as the player walked round to the far side.
      SCRATCH_POSITION.set(
        item.position[0] - Math.sin(facing) * SIGN_PLATE_OFFSET,
        item.position[1],
        item.position[2] - Math.cos(facing) * SIGN_PLATE_OFFSET,
      )
      SCRATCH_SCALE.set(item.plateWidth, item.plateHeight, 1)
      SCRATCH_MATRIX.compose(SCRATCH_POSITION, SCRATCH_QUATERNION, SCRATCH_SCALE)
      mesh.setMatrixAt(index, SCRATCH_MATRIX)
    }

    mesh.instanceMatrix.needsUpdate = true
    // Instanced bounds are not derived from the geometry. Without this the
    // whole pool is culled the moment the camera looks away from the origin —
    // the same trap `PlacardPosts.tsx` documents. The centres never move, so
    // one sphere per pool rewrite is enough; it is the *rotation* that changes
    // per frame, and a plane's bounding sphere already covers every yaw of it.
    mesh.computeBoundingSphere()
  }

  /**
   * A new `SceneModel` — a week closed, an order was submitted — is a new set
   * of plates at new sizes, so the pool is rewritten on the spot rather than
   * left until the next frame. **On the spot matters**: a fresh
   * `InstancedMesh` starts with every instance at the identity, which is
   * thirty-odd unit quads stacked on the floor at the origin, and with
   * `frameloop="demand"` (a panel is open, the game is paused) there may be no
   * next frame at all. The yaw used is the last one the camera reported, which
   * is where the player is still looking.
   */
  useEffect(() => {
    lastYaw.current = NEVER_DRAWN
    const mesh = meshRef.current
    if (mesh && total > 0) writePool(mesh, BILLBOARD_YAW.value)
    // `writePool` closes over this render's `signs` and `total`, which is
    // exactly the pair this effect is keyed on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signs, total])

  useFrame(({ camera }) => {
    // One camera, one yaw, once. The sign's local `+Z` has to point back down
    // the view direction, and for a rotation of `θ` about `Y` that axis is
    // `(sin θ, 0, cos θ)` — so `θ = atan2(−dir.x, −dir.z)`. Taken from the
    // view *direction* rather than from the camera's position so that every
    // sign gets the same angle: signs parallel to the view plane stay
    // parallel to each other, which is what stops a row of lane placards
    // fanning out as the player walks past it.
    camera.getWorldDirection(SCRATCH_DIRECTION)
    const yaw = Math.atan2(-SCRATCH_DIRECTION.x, -SCRATCH_DIRECTION.z)

    // The player has not turned and the model has not changed: there is
    // nothing to write. Standing still is the common case in a board a player
    // reads, and this is what keeps that case free.
    if (yaw === lastYaw.current) return
    lastYaw.current = yaw
    BILLBOARD_YAW.value = yaw

    // Every free-standing sign in the hall, turned from the one angle.
    for (const group of BILLBOARD_GROUPS) group.rotation.y = yaw

    const mesh = meshRef.current
    if (mesh && total > 0) writePool(mesh, yaw)
  })

  // A hall with no signs is not a state this board reaches, but a
  // zero-capacity `InstancedMesh` is not valid, so it is guarded like the
  // placard pool's empty case.
  if (total === 0) return null

  return (
    <instancedMesh
      ref={meshRef}
      // Constructor arguments: R3F rebuilds the mesh when the capacity moves,
      // which is the only one of the three that is not a shared singleton.
      args={[PLATE_GEOMETRY, PLATE_MATERIAL, total]}
    />
  )
}

export default SignPlates
