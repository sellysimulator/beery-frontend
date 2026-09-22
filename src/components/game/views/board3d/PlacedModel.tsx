import { useMemo, type ReactElement } from 'react'
import { usePersonModel, useTruckModel } from './gltfModels'
import type { ModelPlacement } from './sceneModel'
import { CONTACT_MATERIAL, PAD_Y, toTriple, UNIT_PLANE } from './sceneMaterials'

/**
 * One whole GLB standing where the model put it.
 *
 * The placement — asset, position, rotation — is entirely the `SceneModel`'s
 * (24 §8.1). This component decides nothing except which prototype to clone
 * and that the thing needs grounding underneath it.
 *
 * **Why the clone.** `gltfModels.ts` returns shared, normalised prototypes,
 * and an `Object3D` cannot be added to two parents: the Wholesaler's dock
 * truck and its upstream courier are the same `truck.glb` and would fight over
 * the one node. Cloning is cheap here because the merge in `gltfModels.ts`
 * already collapsed the truck to one mesh per material and there are no skins
 * to rebind.
 *
 * **Why only two assets.** `buildSceneModel` emits `ModelPlacement`s for
 * `truck` and `person` only — crates and bills are instanced pools, never
 * individual placements, because 24 §7.2 budgets a pile of any size at one
 * draw call. The two remaining cases return `null` rather than throw: a model
 * that grows a third asset should render nothing until this file is taught
 * about it, not take the canvas down mid-week.
 */

/** The dark quad that keeps a 3.8 m truck from hovering (24 §7.4: shadows are
 *  off, so contact is painted). Sized to the asset, not to the pile grid. */
function ContactPatch({ radius }: { radius: number }): ReactElement {
  return (
    <mesh
      geometry={UNIT_PLANE}
      material={CONTACT_MATERIAL}
      position={[0, PAD_Y, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      scale={[radius * 2, radius * 2, 1]}
    />
  )
}

function TruckModel(): ReactElement {
  const prototype = useTruckModel()
  const model = useMemo(() => prototype.clone(), [prototype])
  return <primitive object={model} />
}

function PersonModel(): ReactElement {
  const prototype = usePersonModel()
  const model = useMemo(() => prototype.clone(), [prototype])
  return <primitive object={model} />
}

export interface PlacedModelProps {
  readonly placement: ModelPlacement
}

export function PlacedModel({ placement }: PlacedModelProps): ReactElement | null {
  if (placement.asset !== 'truck' && placement.asset !== 'person') return null

  return (
    <group position={toTriple(placement.position)} rotation={[0, placement.rotationY, 0]}>
      {placement.asset === 'truck' ? <TruckModel /> : <PersonModel />}
      <ContactPatch radius={placement.asset === 'truck' ? 2.4 : 0.5} />
    </group>
  )
}

export default PlacedModel
