/* eslint-disable react-hooks/immutability --
   A first-person controller *is* a camera mutation: `camera.position` and
   `camera.rotation` are the three.js scene graph, an external system this
   component drives every frame, and react-hooks/immutability reads the camera
   `useThree` hands back as React-owned state. Writing to it from an effect and
   from `useFrame` is r3f's documented way to move a camera; the alternative —
   reading the same object off `useFrame`'s state argument — is the identical
   mutation spelled so the rule cannot see it, which is worse than saying so
   here. Nothing else in this file is exempted. */
import { useEffect, useRef, type ReactElement, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  clampPitch,
  isTypingTarget,
  mergeHeldKeys,
  MOVEMENT_KEYS,
  nearestTargetId,
  shouldReportNearest,
  stepPlayer,
  stepYaw,
  type PadControl,
} from './playerMotion'
import { HALL, SPAWN } from './sceneLayout'
import type { InteractTarget, InteractTargetId } from './sceneModel'

/**
 * The first-person controller — a near-verbatim port of Tequila's,
 * with both of its defects fixed by name.
 *
 * WASD and the arrow keys at 7 u/s, `delta`-scaled. Mouse-**drag** look, yaw
 * unclamped, pitch clamped `[−π/3, +π/3.2]`, eye height pinned to 1.7 and the
 * walk clamped to `MOVEMENT_BOUNDS` — tighter than the walls, because a camera
 * pressed flat against a wall renders the inside of it.
 *
 * **Not `PointerLockControls`.** drei ships one and Tequila uses it; pointer
 * lock takes the cursor away from the DOM panels and from the 2D/3D toggle,
 * and a first-time player has no way back that they will find. Dragging costs
 * the player nothing and keeps every control on the page clickable.
 *
 * ## The two `[HARD-WON]` fixes
 *
 * **The typing guard**. The order panel contains a real
 * `<input type="number">`. Without a guard, typing `8` then `W` into it walks
 * the player across the hall mid-decision — Tequila hit this — so every key
 * handler leaves immediately when the event came from an `INPUT`, `TEXTAREA`
 * or `SELECT`. The guard itself is `playerMotion.ts`'s `isTypingTarget`, in
 * one copy shared with `Board3D.tsx`: this file once held a private copy and
 * that file held another, and two copies of a guard are two guards that
 * drift.
 *
 * **Change-detected proximity** (Tequila defect 8).
 * `onNearObject` fires **only when the nearest id changes**. A `useRef` holds
 * the last reported value and `useFrame` compares before calling. Tequila's
 * version called `setState` sixty times a second, bridging the render loop
 * into React's scheduler on every frame: React bails on an identical value, so
 * it looks free right up until the day the value is an object. **Never call
 * `setState` unconditionally from `useFrame`.**
 *
 * ## What this file does not decide
 *
 * The walk, the clamp, the pitch limit, the proximity search and the
 * comparison above all live in `playerMotion.ts`, which imports no renderer
 * and can therefore be tested (*assert the object, not the
 * renderer*). What is left here is the part that genuinely is the renderer:
 * the listeners, the refs, and the four lines that write to `camera`.
 *
 * ## Touch
 *
 * A finger gets the same controller, not a second one. Drag-look is pointer
 * events, so it already answers a touch; the canvas wrapper carries
 * `touch-none` so the browser does not claim the drag as a scroll or a pinch.
 * Walking and turning come from `MovePad`, whose held buttons live in a set of
 * their own (`pad`, owned by `Board3D`) and are read here beside the
 * keyboard's every frame — merged for the walk, so `stepPlayer` stays the one
 * walk authority, and through `stepYaw` for the turn. Only the pointer that
 * started a drag steers it, so a thumb holding a pad button while a finger
 * looks around does not make the view jump between the two.
 *
 * `paused || gameOver` freezes movement but **not** look, so a player who
 * cannot act can still read the room. The pad's turn buttons are look. There is no idle animation and no
 * head-bob, under `prefers-reduced-motion` or otherwise — the rule is never
 * to introduce one at all, which is a cheaper promise to keep than to break.
 */

/** Radians of turn per pixel of drag. Tuned so a full turn is roughly a
 *  screen-width sweep at 1440 px — fast enough to look behind you without
 *  overshooting the order desk. */
const LOOK_SENSITIVITY = 0.0026

export interface PlayerControllerProps {
  /** `SceneModel.interactTargets` — each with its own centre, radius and
   *  prompt. The controller compares against the model rather than reaching
   *  for `INTERACT_DISTANCE` itself. */
  readonly targets: readonly InteractTarget[]
  /**
   * Called with the nearest target in range, or `null` when there is none —
   * **only when that answer changes**. Safe to route straight into `setState`;
   * that is the whole point of the ref below.
   */
  onNearObject(id: InteractTargetId | null): void
  /** Movement freezes; look does not. */
  readonly paused: boolean
  readonly gameOver: boolean
  /**
   * Opt-in: `E` at whatever is in range, guarded by the same typing check as
   * the movement keys. Pass it only when `Board3D` is not binding `E` itself —
   * two handlers for one key open and shut the panel in the same tick.
   */
  onInteract?(id: InteractTargetId): void
  /**
   * The on-screen pad's held buttons, owned by `Board3D` and written
   * by `MovePad`. A ref rather than a prop value because a press must reach
   * the next frame without a React render in between. Optional, so the
   * controller still stands on its own with only a keyboard.
   */
  readonly pad?: RefObject<Set<PadControl>>
  /** Multiplies how far a drag turns the view; 1 everywhere but on a phone. */
  readonly lookScale?: number
}

/** Read when no pad is wired, so the frame loop has one shape either way. */
const NO_PAD: ReadonlySet<PadControl> = new Set()

export function PlayerController({
  targets,
  onNearObject,
  paused,
  gameOver,
  onInteract,
  pad,
  lookScale = 1,
}: PlayerControllerProps): ReactElement | null {
  const camera = useThree((state) => state.camera)
  const domElement = useThree((state) => state.gl.domElement)

  const held = useRef(new Set<string>())
  const yaw = useRef(0)
  const pitch = useRef(0)
  /** The pointer steering the look, or null. An id rather than a flag: on a
   *  touch screen a second finger is a second pointer, and only the first
   *  one's movement may turn the camera. */
  const dragging = useRef<number | null>(null)
  const lastPointer = useRef({ x: 0, y: 0 })

  /** The last id handed to `onNearObject`. The fix for Tequila defect 8 is
   *  this one line of state and the comparison in `useFrame` below. */
  const reported = useRef<InteractTargetId | null>(null)

  /** What the key handler needs at the moment a key is pressed. Held in a ref
   *  so the listeners are bound once for the life of the board: re-binding
   *  them every time a week closes would drop a keystroke in the gap. */
  const latest = useRef({ targets, onInteract })
  useEffect(() => {
    latest.current = { targets, onInteract }
  })

  // Spawn: `[0, 1.7, 9]` facing `−z`, straight down the order axis.
  // `YXZ` is the order a first-person camera composes in — yaw about the
  // world's up, then pitch about the camera's own right.
  useEffect(() => {
    camera.position.set(SPAWN[0], SPAWN[1], SPAWN[2])
    camera.rotation.order = 'YXZ'
    camera.rotation.set(0, 0, 0)
  }, [camera])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTypingTarget(event.target)) return

      const key = event.key.toLowerCase()
      if (MOVEMENT_KEYS.has(key)) {
        held.current.add(key)
        // The arrows scroll the page otherwise, and the page behind the canvas
        // is the game.
        event.preventDefault()
        return
      }

      if (key !== 'e') return
      const target = latest.current.targets.find((candidate) => candidate.id === reported.current)
      // `enabled` is false while paused: the prompt still reads and E is
      // inert.
      if (target && target.enabled) latest.current.onInteract?.(target.id)
    }

    const onKeyUp = (event: KeyboardEvent): void => {
      held.current.delete(event.key.toLowerCase())
    }

    // A tab switch mid-stride leaves the key down forever otherwise, and the
    // player comes back to a camera walking into a wall. The pad is cleared
    // with it: a phone that locks its screen with a thumb on "forward" never
    // delivers the `pointerup` that would have released it.
    const releaseAll = (): void => {
      held.current.clear()
      pad?.current.clear()
    }
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') releaseAll()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', releaseAll)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', releaseAll)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [pad])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 || dragging.current !== null) return
      dragging.current = event.pointerId
      lastPointer.current = { x: event.clientX, y: event.clientY }
      domElement.setPointerCapture(event.pointerId)
    }

    const onPointerMove = (event: PointerEvent): void => {
      if (dragging.current !== event.pointerId) return
      const dx = event.clientX - lastPointer.current.x
      const dy = event.clientY - lastPointer.current.y
      lastPointer.current = { x: event.clientX, y: event.clientY }
      // Yaw is unclamped — a warehouse is a room you turn round in. Pitch is
      // not.
      yaw.current -= dx * LOOK_SENSITIVITY * lookScale
      pitch.current = clampPitch(pitch.current - dy * LOOK_SENSITIVITY * lookScale)
    }

    const onPointerUp = (event: PointerEvent): void => {
      if (dragging.current !== event.pointerId) return
      dragging.current = null
      if (domElement.hasPointerCapture(event.pointerId)) {
        domElement.releasePointerCapture(event.pointerId)
      }
    }

    domElement.addEventListener('pointerdown', onPointerDown)
    domElement.addEventListener('pointermove', onPointerMove)
    domElement.addEventListener('pointerup', onPointerUp)
    domElement.addEventListener('pointercancel', onPointerUp)
    // A capture the browser takes away (a system gesture, an alert) ends the
    // drag as surely as a lifted finger does.
    domElement.addEventListener('lostpointercapture', onPointerUp)
    return () => {
      domElement.removeEventListener('pointerdown', onPointerDown)
      domElement.removeEventListener('pointermove', onPointerMove)
      domElement.removeEventListener('pointerup', onPointerUp)
      domElement.removeEventListener('pointercancel', onPointerUp)
      domElement.removeEventListener('lostpointercapture', onPointerUp)
    }
  }, [domElement, lookScale])

  // The leading `state` parameter is unused and `noUnusedParameters` is on, so
  // it is `_`, the shape every other
  // `useFrame` in this directory takes.
  useFrame((_, delta) => {
    const padHeld = pad?.current ?? NO_PAD
    // The pad's turn buttons are look, so they run before the pause check
    // below, exactly as a drag would.
    yaw.current = stepYaw(yaw.current, padHeld, delta)
    camera.rotation.set(pitch.current, yaw.current, 0)
    camera.position.y = HALL.eyeHeight

    // Paused or finished, the player may look but not walk. The room is
    // still readable, which is the point: a paused game is not a blank screen.
    if (!paused && !gameOver) {
      // Normalisation, `delta` scaling and the clamp to `MOVEMENT_BOUNDS` are
      // all `stepPlayer`'s, where a test can watch them. This is the
      // one line that is genuinely the renderer's: writing the answer onto the
      // camera.
      const next = stepPlayer(
        camera.position,
        yaw.current,
        mergeHeldKeys(held.current, padHeld),
        delta,
      )
      camera.position.x = next.x
      camera.position.z = next.z
    }

    // Proximity, on the model's own radii, and then **the whole of the proximity
    // fix**: one comparison, so React hears from the render loop only when the
    // answer actually changed. The ref stays here because it is state;
    // the decision is `playerMotion.ts`'s, so it is assertable.
    const nearestId = nearestTargetId(camera.position, targets)
    if (shouldReportNearest(reported.current, nearestId)) {
      reported.current = nearestId
      onNearObject(nearestId)
    }
  })

  // The controller drives the camera that is already in the scene; it has
  // nothing of its own to draw.
  return null
}

export default PlayerController
