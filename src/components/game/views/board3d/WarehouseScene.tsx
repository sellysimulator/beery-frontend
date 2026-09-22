import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import FixtureMesh from './FixtureMesh'
import { REDUCED_MOTION_QUERY, shouldAnimateIdle } from './playerMotion'
import SceneShell from './SceneShell'
import SignPlates from './SignPlates'
import type { SceneModel } from './sceneModel'
import { toTriple } from './sceneMaterials'

/**
 * The whole hall, from the `SceneModel` and from nothing else.
 *
 * **This component adds nothing the model does not carry** (24 §8.1). jsdom
 * has no WebGL, so nothing inside the canvas renders in a test; the answer
 * this board takes — the one `chartSetup.ts` already established for Chart.js
 * — is that `buildSceneModel` returns exactly what this file draws, which is
 * what lets 24 §9's acceptance criteria be checked against a plain object
 * instead of a mocked renderer. The consequence is strict and it is the rule
 * to hold anyone editing this file to: *a geometry decision made here rather
 * than in `buildSceneModel` is untestable, and is a defect.* Every position,
 * count, string, hex, prompt and light below arrives on `model`.
 *
 * ## What this file does decide
 *
 * Four things, none of which is a figure a player reads:
 *
 * 1. **The shell** — floor, four walls, and the accent stripe and band
 *    (`SceneShell`, on `HALL`'s frozen dimensions). No ceiling: the hall is
 *    open to the sky (24 §3.1, amended 2026-09-22).
 * 1a. **Where the sign plates are pooled, and where the billboarding runs.**
 *    Every sign in the hall reads against a white rectangle, and every
 *    free-standing one turns to face the player. Both are one `InstancedMesh`
 *    and one `useFrame` in `SignPlates.tsx` rather than a mesh and a callback
 *    per sign, because there are thirty-odd signs, eleven draw calls of
 *    headroom, and exactly one camera to face (24 §6.1, §7.1, AC 19). The
 *    *sizes* and the *flags* are the model's, measured by `signPlateSize` in
 *    `buildSceneModel`; what is decided here is only that they are pooled.
 * 1b. **Where the placard posts are pooled.** Every placard in the hall is the
 *    same post in a different place, so they are drawn as one `InstancedMesh`
 *    (`PlacardPosts`) instead of one mesh apiece — ten draw calls saved in a
 *    maximal view (24 §7.1, AC 19). The *positions* are still the model's, read
 *    straight off its `placard` fixtures; what is decided here is only that
 *    they are gathered rather than drawn one at a time, which is the same
 *    decision 24 §7.2 already took for crates.
 * 2. **The sky** — `<color attach="background">` in `model.background`, which
 *    is now `scenePalette.ts`'s `skyCyan`, with **no `<fog>` and no `<Sky>`**.
 *    A player asked for an open cyan sky and uniform light; a flat background
 *    colour is uniform by construction and a procedural sky is not, which is
 *    24 §7.4's no-`<Sky>` line standing on a new reason. The fog went with the
 *    ceiling: tuned to the old bone hue it would read as haze across the tops
 *    of the walls, and tuned to cyan it would wash the far signs a player has
 *    just asked for *more* contrast on.
 * 3. **One light, exactly** — a `hemisphereLight`, emitted from `model.lights`
 *    and capped there by `MAX_LIGHTS`, which is 1. It has no position and no
 *    falloff, so the far corner of the hall is lit exactly as the desk is:
 *    that is what "uniform across the whole board" means, and it is why the
 *    two point lights are gone. Tequila ships ~18 point lights against
 *    `meshStandardMaterial`, a per-fragment cost on every pixel of every
 *    frame, and that is the single largest reason its scene is slow; this
 *    board now pays for one light that cannot hotspot at all.
 * 4. **No shadows, anywhere.** `shadows` is off on the `<Canvas>` (§7.5) and
 *    `castShadow` is written nowhere in this directory — Tequila sets it on
 *    meshes while never enabling shadows, which is dead code that reads like
 *    a feature. Contact is a dark procedural quad under each pile.
 *
 * Everything static is hoisted to module scope in `sceneMaterials.ts`; what is
 * left is memoised on the `SceneModel`, so a week that closes rebuilds the
 * fixture elements once and a re-render that changes nothing rebuilds nothing.
 */

/**
 * Whether the player asked the platform for less movement (24 §7.6.2).
 *
 * The 3D board is still offered under `prefers-reduced-motion` — what changes
 * is that the week-change lane lift is dropped and the colour flash carries
 * §5.5 alone. There is no idle animation and no head-bob to disable, because
 * 24 §5.1 says never to introduce one at all.
 *
 * The query string and the rule it feeds both live in `playerMotion.ts`: this
 * component cannot be imported by a test (jsdom has no WebGL, 24 §8.1), and
 * FM 10 asks for the rule *"idle animation is disabled under reduced motion"*
 * to be asserted rather than the toggle's warning copy, which is a different
 * sentence in a different file. What is left here is the subscription, which
 * is a browser API and not a decision.
 */

/** Guarded, because this module is reachable from a test runner that has
 *  stubbed `matchMedia` and from one that has not. */
function reducedMotionNow(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

function usePrefersReducedMotion(): boolean {
  // Read once at mount rather than set from an effect: a `setState` in an
  // effect that runs on every mount is a second render of the whole scene for
  // an answer the browser could give before the first one.
  const [reduced, setReduced] = useState(reducedMotionNow)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(REDUCED_MOTION_QUERY)
    const onChange = (event: MediaQueryListEvent): void => setReduced(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return reduced
}

export interface WarehouseSceneProps {
  /** Everything the canvas shows, built by `buildSceneModel`. */
  readonly model: SceneModel
  /** So `Board3D` may mount the controller inside the scene rather than
   *  beside it. The scene itself neither reads nor positions them. */
  readonly children?: ReactNode
}

export function WarehouseScene({ model, children }: WarehouseSceneProps): ReactElement {
  const reducedMotion = usePrefersReducedMotion()
  // The week-change lane lift is the only animation this board has, so it is
  // the only thing `shouldAnimateIdle` currently gates (24 §7.6.2, FM 10).
  const laneLift = model.weekChanged && shouldAnimateIdle(reducedMotion)

  /**
   * The hall's lighting, which is one `hemisphereLight` and has no other
   * branch to take (24 §7.1, amended 2026-09-22).
   *
   * `SceneLight.kind` is the literal `'hemisphere'` — the directional and
   * point branches this loop used to carry are not dead code that was left
   * behind, they are **unrepresentable**. A future edit that wants a point
   * light back has to widen the model's type, change `MAX_LIGHTS`, and fail
   * `Board3D.test.tsx`'s light assertion on the way, which is exactly the
   * amount of friction a change the player has already rejected deserves.
   */
  const lights = useMemo(
    () =>
      model.lights.map((light) => (
        <hemisphereLight
          key={light.id}
          position={toTriple(light.position)}
          args={[light.color, light.groundColor ?? light.color, light.intensity]}
        />
      )),
    [model.lights],
  )

  const fixtures = useMemo(
    () =>
      model.fixtures.map((fixture) => (
        <FixtureMesh
          key={fixture.id}
          fixture={fixture}
          clipboardVisible={model.desk.clipboard !== 'absent'}
          doorClosed={model.dispatchDoorClosed}
          laneLift={laneLift}
        />
      )),
    [model.fixtures, model.desk.clipboard, model.dispatchDoorClosed, laneLift],
  )

  return (
    <>
      {/* The hall is open above the walls, so the background is the sky and
          nothing else: one flat cyan, the same everywhere the player looks
          (24 §3.1, §7.4, amended 2026-09-22). */}
      <color attach="background" args={[model.background]} />

      {lights}

      <SceneShell accent={model.roleSet.accent} />
      {/* Every sign's backing plate, pooled into one mesh, and the single
          `useFrame` that turns every sign and every plate to face the player
          (24 §6.1, amended 2026-09-22). It is mounted *before* the fixtures
          that carry the words so the pool exists by the time their signs
          register themselves with it. */}
      <SignPlates signs={model.signs} />
      {fixtures}

      {children}
    </>
  )
}

export default WarehouseScene
