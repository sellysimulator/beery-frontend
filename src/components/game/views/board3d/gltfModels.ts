import { useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * The four glTF assets of `24 §6.1`, loaded once and normalised once.
 *
 * **No decoder configuration, deliberately (`24 §7.3`).** All four files are
 * single-file binary glTF 2.0 with everything embedded, and `extensionsUsed`
 * and `extensionsRequired` are absent from every one of them: no Draco, no
 * Meshopt, no KTX2, zero animations, zero skins — verified against the files
 * in `public/3dmodels/`, not assumed. So:
 *
 * - `useGLTF(url)` with no second argument is correct. Do **not** wire up a
 *   `DRACOLoader` or `MeshoptDecoder`, and do **not** ship `public/draco/`:
 *   it would be ~2 MB of decoder served to every player who opens the 3D
 *   board, to decode compression that is not there.
 * - Do **not** reach for `useAnimations`. There are no animation clips.
 * - `Object3D.clone()` is sufficient wherever a second copy of a model is
 *   needed. `SkeletonUtils.clone` exists for skinned meshes sharing a
 *   skeleton; with zero skins it buys nothing and costs a dependency.
 *
 * If a fifth model is ever added, re-verify those three claims against the
 * new file before trusting this comment for it.
 *
 * `road.glb` is absent on purpose (`24 §6.1`): 8.1 MB for 30 triangles. The
 * roads here are painted quads.
 */

/** Where the assets sit under `public/` (`24 §6.1`). Vite's base is `/`. */
export const MODEL_URL = {
  box: '/3dmodels/box.glb',
  truck: '/3dmodels/truck.glb',
  person: '/3dmodels/person.glb',
  money: '/3dmodels/money.glb',
} as const

/**
 * Target heights in world metres (`24 §7.3`).
 *
 * The sanity check that produced them is the eye height: the camera sits at
 * 1.7, so a `person` at 1.9 is someone the player looks slightly up at, and a
 * `truck` at 3.8 is twice that. A person the player can see over is wrong.
 */
export const MODEL_TARGET_HEIGHT = {
  person: 1.9,
  truck: 3.8,
  box: 1.1,
  money: 0.7,
} as const

/**
 * `box.glb` carries two meshes. This is the one with 96 triangles; the other,
 * `Cube_Mat.3_0`, has 12 and is not used (`24 §7.2`).
 *
 * This is the name **in the file**, which is not the name the loader hands
 * back — see {@link CRATE_MESH_NAME_AS_LOADED}.
 */
const CRATE_MESH_NAME = 'Cube_10_Mat.3_0'

/**
 * `[HARD-WON]` The same mesh, under the name it actually arrives with.
 *
 * `GLTFLoader` runs every node name through
 * `THREE.PropertyBinding.sanitizeNodeName`, which strips the characters the
 * animation-binding path syntax reserves — `. [ ] : /` — so the mesh declared
 * as `Cube_10_Mat.3_0` reaches the scene graph as `Cube_10_Mat3_0`. Both
 * loaders in this stack do it: three's own, and the `three-stdlib` copy that
 * `@react-three/drei`'s `useGLTF` actually calls.
 *
 * Matching on the file's spelling alone therefore found nothing and threw —
 * and because `CratePile` is the first thing every pool mounts, that threw on
 * the **first frame of every 3D board**, in all four seats, straight into
 * `Board3D`'s error boundary and back to 2D (`24 §7.6.3`). jsdom has no WebGL
 * and `24 §8.1` keeps the suite on the `SceneModel`, so nothing in the tests
 * ever loaded a `.glb` and nothing said so. The sanitiser is the authority on
 * the runtime name, so it is what the comparison below goes through rather
 * than a second hardcoded spelling that would drift from the file's.
 */
const CRATE_MESH_NAME_AS_LOADED = THREE.PropertyBinding.sanitizeNodeName(CRATE_MESH_NAME)

/** The result of measuring a model against a target height. */
export interface ModelNormalization {
  /**
   * Subtract this from the model's own position, in the model's own units,
   * before the scale is applied. It is `(centre.x, min.y, centre.z)`: centred
   * on the two horizontal axes and **grounded** on the vertical one, so a
   * normalised model placed at `y = 0` stands on the floor rather than
   * hovering at or sinking through it.
   */
  readonly offset: THREE.Vector3
  /** Uniform scale factor: `target / max(size.x, size.y, size.z)`. */
  readonly scale: number
  /** The model's height in world units once scaled — what a stack steps by. */
  readonly stackHeight: number
}

/**
 * `[HARD-WON]` The pure half of the normalisation of `24 §7.3`.
 *
 * The four models come from four authors. Their pivots are variously centred,
 * cornered and floor-planted and their units are unrelated — dropped in
 * untouched, the truck is the size of the hall. This is Samby's `Box3` block
 * (`samby-frontend/src/features/analysis/warehouse/warehouse-renderer.ts`
 * lines 128-139), which solved the same problem against the same four files,
 * lifted out as a function of a bounding box alone.
 *
 * It is separated from {@link normalizeModel} because a function over a
 * `Box3` can be asserted against synthetic numbers with no renderer, no
 * canvas and no asset fetch, which is what `24 §8.1` asks of everything it
 * can get away with asking it of.
 *
 * The `0.001` floor on the divisor is not defensive noise: a degenerate axis
 * (a flat plane, an empty group) gives `max === 0`, and an `Infinity` scale
 * turns every subsequent matrix into `NaN` silently.
 */
export function normalizeTransform(bounds: THREE.Box3, targetHeight: number): ModelNormalization {
  const size = bounds.getSize(new THREE.Vector3())
  const center = bounds.getCenter(new THREE.Vector3())
  const scale = targetHeight / Math.max(size.x, size.y, size.z, 0.001)

  return {
    offset: new THREE.Vector3(center.x, bounds.min.y, center.z),
    scale,
    stackHeight: size.y * scale,
  }
}

/**
 * `[HARD-WON]` The applied half: measure `object`, recentre and ground it,
 * then wrap it in a `Group` carrying the uniform scale (`24 §7.3`).
 *
 * The wrapper matters. Scaling `object` itself would fight whatever transform
 * the exporter baked into its own root — and all four of these files have one
 * — whereas a parent `Group` composes with it. The caller then positions the
 * `Group` in world coordinates and never thinks about the model's units again.
 *
 * `userData.stackHeight` is the scaled height, which is what anything piling
 * these models needs and cannot recover afterwards without re-measuring.
 */
export function normalizeModel(object: THREE.Object3D, targetHeight: number): THREE.Group {
  // Without this the box is computed from stale matrices and the first frame
  // is scaled by whatever the previous layout happened to leave behind.
  object.updateMatrixWorld(true)

  const bounds = new THREE.Box3().setFromObject(object)
  const { offset, scale, stackHeight } = normalizeTransform(bounds, targetHeight)

  object.position.sub(offset)

  const normalized = new THREE.Group()
  normalized.add(object)
  normalized.scale.setScalar(scale)
  normalized.userData.stackHeight = stackHeight

  return normalized
}

/**
 * Caches keyed on the loaded scene rather than on the URL.
 *
 * `useGLTF` caches per URL and hands every caller the same `Group`, so the key
 * is stable for as long as the asset is alive — and if `useGLTF.clear()` ever
 * drops it, the next load produces a new `Group` and a new entry instead of a
 * stale one pointing at disposed GPU resources.
 */
const crateGeometryCache = new WeakMap<THREE.Object3D, THREE.BufferGeometry>()
const truckCache = new WeakMap<THREE.Object3D, THREE.Group>()
const personCache = new WeakMap<THREE.Object3D, THREE.Group>()
const moneyCache = new WeakMap<THREE.Object3D, THREE.Group>()

function cached<T>(store: WeakMap<THREE.Object3D, T>, key: THREE.Object3D, build: () => T): T {
  const hit = store.get(key)
  if (hit) return hit
  const built = build()
  store.set(key, built)
  return built
}

/** Every mesh under `root`, in traversal order. */
function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = []
  root.traverse((child) => {
    if (child instanceof THREE.Mesh) meshes.push(child)
  })
  return meshes
}

/**
 * The 96-triangle crate geometry, baked flat and normalised to 1.1 m.
 *
 * `CratePile` needs a `BufferGeometry`, not an `Object3D`, because an
 * `InstancedMesh` takes one geometry and draws it N times. So the model's node
 * transforms and the normalisation of `24 §7.3` are baked into the vertices
 * here, once per asset load, rather than carried on a parent that instancing
 * has no way to honour.
 *
 * The origin ends up centred in x/z and sitting on y = 0, so a crate placed at
 * `y = k * height` stacks cleanly.
 */
function extractCrateGeometry(scene: THREE.Object3D): THREE.BufferGeometry {
  scene.updateMatrixWorld(true)

  const mesh = meshesOf(scene).find(
    (candidate) =>
      candidate.name === CRATE_MESH_NAME_AS_LOADED || candidate.name === CRATE_MESH_NAME,
  )
  if (!mesh) {
    // A silent fallback here would ship a pile of the wrong box, which reads
    // as "the crates look odd" months later rather than as a failed export.
    throw new Error(
      `box.glb no longer contains a mesh named ${CRATE_MESH_NAME} — the loader ` +
        `spells it ${CRATE_MESH_NAME_AS_LOADED} (24 §7.2). If the asset was ` +
        're-exported, re-check the mesh names before changing this.',
    )
  }

  const geometry = mesh.geometry.clone()
  geometry.applyMatrix4(mesh.matrixWorld)
  geometry.computeBoundingBox()

  // `computeBoundingBox` always assigns, but the field is typed nullable.
  const bounds = geometry.boundingBox ?? new THREE.Box3()
  const { offset, scale } = normalizeTransform(bounds, MODEL_TARGET_HEIGHT.box)

  geometry.translate(-offset.x, -offset.y, -offset.z)
  geometry.scale(scale, scale, scale)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

  return geometry
}

/**
 * `[HARD-WON]` The truck's colours, baked into the mesh: **33 primitives
 * across 13 materials become two draw calls** (24 §7.1, AC 19).
 *
 * The previous form of this function merged per material, 33 calls down to 13,
 * and 13 × 2 trucks was 26 of a budget whose whole ceiling is 90 — the largest
 * single item in the scene by a wide margin. The reason it could not go lower
 * was the material count, and the reason the material count did not have to
 * matter is in the asset: all 13 are **flat colours**. Not one carries a
 * `baseColorTexture`, every `metallicFactor` that is written is 0, and the
 * roughnesses are 0.4, 0.408 and 0.5 — differences invisible on flat-shaded
 * polygons under this board's four lights. A material that is only a colour
 * does not need to be a material: the colour folds into a per-vertex `color`
 * attribute, every primitive merges into one geometry, and one material with
 * `vertexColors: true` draws the lot.
 *
 * **Why two meshes and not one.** Two of the 13 are lamps — `Material.003`,
 * the headlights, and `Material.006`, the tail light, three quads and twelve
 * triangles between them. They carry no `pbrMetallicRoughness` at all and an
 * `emissiveFactor` instead: white and red. Emission is a material uniform and
 * there is no per-vertex form of it, so folding them in with the rest would
 * put out the truck's lights, and 24 §7.1 is a budget, not a reason to change
 * what the player sees. They become a second merged mesh in a
 * `MeshBasicMaterial` — unlit flat colour, which is what a fully emissive
 * surface already looked like — for one extra call per truck.
 *
 * `side` is `DoubleSide` on both because all 13 source materials are
 * `doubleSided`, and `person.glb` gets no treatment at all: it is one mesh
 * with one untextured material and is already one draw call. Verified against
 * the files in `public/3dmodels/`, not assumed — as with this module's header,
 * re-verify before trusting either claim for a re-exported asset.
 */
const TRUCK_LIT_MATERIAL = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.5,
  metalness: 0,
  side: THREE.DoubleSide,
})

/** The headlights and the tail light: unlit flat colour, which is what a
 *  fully emissive surface under four lights already looked like. */
const TRUCK_LAMP_MATERIAL = new THREE.MeshBasicMaterial({
  vertexColors: true,
  side: THREE.DoubleSide,
})

/** A material that is a lamp rather than a painted surface. */
function lampColor(material: THREE.Material): THREE.Color | null {
  if (!(material instanceof THREE.MeshStandardMaterial)) return null
  const { emissive } = material
  if (emissive.r === 0 && emissive.g === 0 && emissive.b === 0) return null
  return emissive
}

/**
 * Writes one flat colour into every vertex of `geometry`.
 *
 * The values go in unconverted. `THREE.Color` holds the renderer's working
 * colour space and three reads a `color` attribute in that same space, so a
 * material's own `.r/.g/.b` is exactly what the shader was multiplying by
 * before the bake — which is what makes this invisible to a player.
 */
function paintGeometry(geometry: THREE.BufferGeometry, color: THREE.Color): void {
  const count = geometry.getAttribute('position').count
  const colors = new Float32Array(count * 3)
  for (let index = 0; index < count; index += 1) {
    colors[index * 3] = color.r
    colors[index * 3 + 1] = color.g
    colors[index * 3 + 2] = color.b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}

/** Merge, or keep the parts if the attributes disagree. A slower truck is a
 *  truck; a missing one is a missing fixture. */
function addMerged(
  group: THREE.Group,
  geometries: THREE.BufferGeometry[],
  material: THREE.Material,
): void {
  if (geometries.length === 0) return
  if (geometries.length === 1) {
    group.add(new THREE.Mesh(geometries[0], material))
    return
  }

  // Typed non-null upstream, nullable in fact when the attributes disagree.
  const combined: THREE.BufferGeometry | null = mergeGeometries(geometries)
  if (!combined) {
    for (const geometry of geometries) group.add(new THREE.Mesh(geometry, material))
    return
  }

  combined.computeBoundingSphere()
  group.add(new THREE.Mesh(combined, material))
  // The clones exist only as merge input; keeping them leaks a second copy of
  // the truck into GPU memory for as long as the asset is cached.
  for (const geometry of geometries) geometry.dispose()
}

/** See {@link TRUCK_LIT_MATERIAL}: the whole truck as one lit mesh plus one
 *  lamp mesh, with every material's colour carried in the vertices. */
function bakeTruck(scene: THREE.Object3D): THREE.Group {
  scene.updateMatrixWorld(true)

  const lit: THREE.BufferGeometry[] = []
  const lamps: THREE.BufferGeometry[] = []

  for (const mesh of meshesOf(scene)) {
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
    const geometry = mesh.geometry.clone()
    // The node transforms have to be baked in: one merged geometry has one
    // matrix, and the 33 primitives do not share theirs.
    geometry.applyMatrix4(mesh.matrixWorld)

    const lamp = lampColor(material)
    if (lamp) {
      paintGeometry(geometry, lamp)
      lamps.push(geometry)
    } else {
      paintGeometry(
        geometry,
        material instanceof THREE.MeshStandardMaterial ? material.color : new THREE.Color(0xffffff),
      )
      lit.push(geometry)
    }
  }

  const baked = new THREE.Group()
  addMerged(baked, lit, TRUCK_LIT_MATERIAL)
  addMerged(baked, lamps, TRUCK_LAMP_MATERIAL)
  return baked
}

/**
 * The clients in the RETAILER's shop, in the same stone grey as the crates.
 *
 * `person.glb` ships its own material, and at 1.9 m by the checkout it read as
 * a different *kind* of object from everything else in the hall. Grey ties it
 * to the crates — it is a silhouette of a customer, not a character.
 */
const PERSON_MATERIAL = new THREE.MeshStandardMaterial({
  // The crate grey of `QUANTITY_HEX.inventory`, repeated rather than imported:
  // 24 §3.8 scopes a quantity hex to crates, and a client is not a quantity.
  color: '#8f8b84',
  roughness: 0.75,
  metalness: 0,
})

/** Repaints every mesh of a loaded model with one shared material. */
function repaint(root: THREE.Object3D, material: THREE.Material): void {
  for (const mesh of meshesOf(root)) mesh.material = material
}

/**
 * The crate geometry for `CratePile`'s `InstancedMesh`, shared by every pool.
 *
 * Suspends on first call, like every `useGLTF` consumer, so the caller must
 * sit inside the `<Suspense>` boundary `24 §7.4` puts around the scene.
 */
export function useCrateGeometry(): THREE.BufferGeometry {
  const { scene } = useGLTF(MODEL_URL.box)
  return useMemo(() => cached(crateGeometryCache, scene, () => extractCrateGeometry(scene)), [scene])
}

/**
 * The baked, normalised truck — two meshes, whatever the asset's material
 * count (see {@link bakeTruck}).
 *
 * This is a shared prototype, not a mountable node: two fixtures cannot add
 * the same `Object3D` to two parents. Callers render `model.clone()`, which is
 * sufficient here — there are no skins (see this module's header).
 */
export function useTruckModel(): THREE.Group {
  const { scene } = useGLTF(MODEL_URL.truck)
  return useMemo(
    () => cached(truckCache, scene, () => normalizeModel(bakeTruck(scene), MODEL_TARGET_HEIGHT.truck)),
    [scene],
  )
}

/**
 * The normalised person, 1.9 m. A shared prototype — clone it, as above.
 *
 * No bake and no merge: `person.glb` is a single mesh with a single untextured
 * material, so it is already the one draw call `MODEL_DRAW_COST` budgets for
 * it. If it is ever re-exported into several parts, {@link bakeTruck} is the
 * pattern to reach for.
 */
export function usePersonModel(): THREE.Group {
  const { scene } = useGLTF(MODEL_URL.person)
  return useMemo(
    () =>
      cached(personCache, scene, () => {
        const root = scene.clone()
        repaint(root, PERSON_MATERIAL)
        return normalizeModel(root, MODEL_TARGET_HEIGHT.person)
      }),
    [scene],
  )
}

/** The normalised, de-textured money stack, 0.35 m. A shared prototype. */
export function useMoneyModel(): THREE.Group {
  const { scene } = useGLTF(MODEL_URL.money)
  return useMemo(
    () =>
      cached(moneyCache, scene, () =>
        // `money.glb`'s texture is ~97% of the file and an earlier round
        // stripped it to save the GPU upload. That was wrong: the mesh is 36
        // triangles, so without its texture a stack of bills is a featureless
        // cuboid — which is the "white box" it renders as. The texture is the
        // model (2026-09-22).
        normalizeModel(scene.clone(), MODEL_TARGET_HEIGHT.money),
      ),
    [scene],
  )
}

/**
 * Starts all four fetches as soon as this module is evaluated (`24 §7.3`).
 *
 * This is safe to do eagerly *because* the module is reachable only through
 * the lazy `Board3D` import of `24 §2.1`: a player who never leaves the 2D
 * board never evaluates it and never fetches the 699 KB. For a player who
 * does, the fetches start with the chunk rather than with the first frame
 * that needs a mesh, which is the difference between one wait and four.
 */
export function preloadSceneModels(): void {
  for (const url of Object.values(MODEL_URL)) useGLTF.preload(url)
}

preloadSceneModels()
