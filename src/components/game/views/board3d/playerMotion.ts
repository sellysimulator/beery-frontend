import { MOVEMENT_BOUNDS } from './sceneLayout'
import type { InteractTarget, InteractTargetId } from './sceneModel'

/**
 * The first-person controller's decisions, with the renderer taken out of them
 * (24 §5.1, §8.1).
 *
 * `PlayerController.tsx` drives a three.js camera and `WarehouseScene.tsx`
 * drives a lane lift; neither can be imported by a test, because jsdom has no
 * WebGL and 24 §8.1 draws the line there — *assert the object, not the
 * renderer*. Everything those two files decided **before** touching the camera
 * lives here instead, so 24 §10's failure modes 6, 9 and 10 are assertable
 * against plain values:
 *
 * - **FM 6** — `isTypingTarget`, in **one** copy. It had two, one private to
 *   `PlayerController.tsx` and one private to `Board3D.tsx`, each guarding the
 *   keys its own file bound. Two copies of a guard are two guards that drift,
 *   and the cost of this one drifting is the `[HARD-WON]` bug 24 §5.1 names by
 *   name: typing `8` then `W` into the order input walks the player across the
 *   hall mid-decision. One copy, imported twice.
 * - **FM 9** — `shouldReportNearest`, the comparison behind the controller's
 *   `reported` ref. The ref stays in the component, because a ref is state and
 *   state belongs to the thing that renders; the *decision* is here, so a test
 *   can prove an unchanged id produces no call. **Never call `setState`
 *   unconditionally from `useFrame`** (Tequila defect 8).
 * - **FM 10** — `shouldAnimateIdle`, so the rule itself is assertable rather
 *   than the toggle's warning copy, which is a different sentence in a
 *   different file.
 *
 * And `stepPlayer`, the movement integration: position, heading, key state and
 * a frame delta in, the next position — already clamped to `MOVEMENT_BOUNDS` —
 * out. A clamp that only ever runs inside `useFrame` is a clamp no test has
 * ever seen hold.
 *
 * The touch controls of 24 §5.7 add three more decisions here and no second
 * walk: `mergeHeldKeys` folds the on-screen pad's walking buttons into the
 * keyboard's set so `stepPlayer` stays the one walk authority, and
 * `turnAxis` / `stepYaw` turn the camera while a turn button is held.
 *
 * Nothing in this module imports three.js, `@react-three/fiber` or React. The
 * one import that reaches `sceneModel.ts` is `import type`, erased at compile
 * time under `verbatimModuleSyntax`, so this file costs a test run nothing but
 * its own bytes. Samby's `warehouse/player-motion.ts` is the precedent for the
 * shape.
 */

/** 24 §5.1. Metres per second, scaled by `delta` so the walk is the same on a
 *  144 Hz panel as on a throttled tab. */
export const MOVE_SPEED = 7

/** 24 §5.1: yaw is unclamped, pitch is not. Looking further up than this in a
 *  room with a ceiling shows the player nothing and loses them the floor. */
export const PITCH_MIN = -Math.PI / 3
export const PITCH_MAX = Math.PI / 3.2

/** The keys that move. Arrows included, because a player who has just typed an
 *  order reaches for them before they reach for `WASD`. */
export const FORWARD_KEYS: ReadonlySet<string> = new Set(['w', 'arrowup'])
export const BACKWARD_KEYS: ReadonlySet<string> = new Set(['s', 'arrowdown'])
export const LEFT_KEYS: ReadonlySet<string> = new Set(['a', 'arrowleft'])
export const RIGHT_KEYS: ReadonlySet<string> = new Set(['d', 'arrowright'])

/** Every key the controller swallows on `keydown`: the arrows scroll the page
 *  otherwise, and the page behind the canvas is the game. */
export const MOVEMENT_KEYS: ReadonlySet<string> = new Set([
  ...FORWARD_KEYS,
  ...BACKWARD_KEYS,
  ...LEFT_KEYS,
  ...RIGHT_KEYS,
])

/**
 * The media query 24 §7.6.2 names, exported so the test asserting FM 10 can
 * match on the same string the scene subscribes to rather than on a second
 * copy of it.
 */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/**
 * The media query that puts the on-screen movement pad on screen (24 §5.7).
 *
 * `any-pointer`, not `pointer`: `pointer` reports only the *primary* input, so
 * a tablet with a keyboard cover or a touch laptop with a trackpad would be
 * asked which one it is and answer with the wrong one. Any coarse pointer at
 * all means a finger may be the thing holding the device, and a pad that is
 * there and unused costs a corner of the screen; a pad that is missing costs
 * the game.
 */
export const COARSE_POINTER_QUERY = '(any-pointer: coarse)'

/** 24 §5.7. Radians per second while a turn button is held — Samby's 1.7, a
 *  full turn in under four seconds, slow enough to stop on a sign. */
export const TURN_SPEED = 1.7

/**
 * The six buttons of the on-screen pad (24 §5.7), in the order they render:
 * turn, walk, turn on the top row; strafe, walk back, strafe on the bottom.
 *
 * These are **not** keyboard keys and are kept in a set of their own, owned by
 * `Board3D` and read by `PlayerController` beside the keyboard's. Samby keeps
 * `touchKeys` apart from `keys` for the same reason: a finger lifting a pad
 * button must never release a key the keyboard is still holding, and a window
 * `blur` that clears the keyboard must be free to clear the pad too without
 * either knowing what the other holds.
 */
export type PadControl =
  | 'turn-left'
  | 'forward'
  | 'turn-right'
  | 'strafe-left'
  | 'backward'
  | 'strafe-right'

/**
 * Which keyboard key each walking button stands for, so `stepPlayer` stays the
 * one walk authority (24 §5.1). The pad does not get a second integration with
 * its own speed and its own diagonal; it presses `W` on the player's behalf.
 * The two turn buttons have no keyboard twin — the arrows walk, and that
 * mapping is unchanged — so they are `turnAxis`'s, not this table's.
 */
export const PAD_WALK_KEY: Readonly<Partial<Record<PadControl, string>>> = {
  forward: 'w',
  backward: 's',
  'strafe-left': 'a',
  'strafe-right': 'd',
}

/**
 * The keyboard's held keys with the pad's walking buttons folded in.
 *
 * Returns the keyboard set itself, unchanged, when the pad holds nothing — the
 * common case on a laptop, and a frame that allocates nothing for it. A key
 * held on both is held once: a set, so `W` and the forward button together
 * walk at the speed of either, never twice it.
 */
export function mergeHeldKeys(
  keyboard: ReadonlySet<string>,
  pad: ReadonlySet<PadControl>,
): ReadonlySet<string> {
  if (pad.size === 0) return keyboard
  const merged = new Set(keyboard)
  for (const control of pad) {
    const key = PAD_WALK_KEY[control]
    if (key !== undefined) merged.add(key)
  }
  return merged
}

/** `+1` turning left, `-1` turning right, `0` for neither or both — opposite
 *  buttons cancel, exactly as `A` and `D` do in `movementAxes`. */
export function turnAxis(pad: ReadonlySet<PadControl>): number {
  return (pad.has('turn-left') ? 1 : 0) - (pad.has('turn-right') ? 1 : 0)
}

/**
 * One frame of turning from the pad: the next yaw.
 *
 * Positive yaw turns left, matching the camera's `YXZ` composition and the
 * drag-look's own sign (dragging right lowers yaw and turns right). Yaw stays
 * unclamped, as 24 §5.1 has it. Turning is **look**, not movement, so the
 * controller applies it while paused or after the game ends too — the same
 * rule that keeps drag-look alive then.
 */
export function stepYaw(yaw: number, pad: ReadonlySet<PadControl>, delta: number): number {
  const axis = turnAxis(pad)
  return axis === 0 ? yaw : yaw + axis * TURN_SPEED * delta
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Is this event coming out of something the player is typing into?
 *
 * The `[HARD-WON]` guard of 24 §5.1 (FM 6), extended to `SELECT` as that
 * section requires and to `contentEditable` because the cost of being wrong is
 * a player walking away from a half-typed decision. A superset of what §5.1
 * names, and never less.
 *
 * The `instanceof` is the guard's own guard: a `keydown` dispatched at
 * `window` has a `Window` as its target, and `document` has no `tagName` at
 * all.
 *
 * The `=== true` on the last clause is not noise. `isContentEditable` is typed
 * `boolean` by the DOM lib, but it is an *optional* property of a host object:
 * jsdom does not implement it, so on a plain `<div>` the read is `undefined`
 * and a bare `||` chain would hand a caller `undefined` from a function that
 * promises a `boolean`. Every caller here happens to use the result as a
 * condition, where `undefined` and `false` behave alike — which is exactly why
 * the day one of them stores or compares it would be the day this bites.
 * Comparing against `true` makes the declared return type true of the value.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable === true
  )
}

/** 24 §5.1's pitch clamp, on its own so the numbers are readable from a test
 *  instead of inferred from a camera's rotation after a drag. */
export function clampPitch(pitch: number): number {
  return clamp(pitch, PITCH_MIN, PITCH_MAX)
}

/** A point on the floor. The controller's third axis is pinned to
 *  `HALL.eyeHeight` every frame and is never a movement question. */
export interface PlayerPosition {
  readonly x: number
  readonly z: number
}

/** The two signed axes a key state resolves to, before they are rotated by the
 *  heading. Both are in `[-1, +1]` for a keyboard; opposite keys held together
 *  cancel, which is what a player pressing `A` and `D` expects. */
export interface MovementAxes {
  readonly forward: number
  readonly strafe: number
}

/** Which way the held keys point, with no notion of where the player is
 *  looking. Split out from `stepPlayer` because "W and S held together is a
 *  standstill" is a rule worth reading on its own line. */
export function movementAxes(held: ReadonlySet<string>): MovementAxes {
  let forward = 0
  let strafe = 0
  for (const key of held) {
    if (FORWARD_KEYS.has(key)) forward += 1
    if (BACKWARD_KEYS.has(key)) forward -= 1
    if (RIGHT_KEYS.has(key)) strafe += 1
    if (LEFT_KEYS.has(key)) strafe -= 1
  }
  return { forward, strafe }
}

/**
 * One frame of walking: where the player ends up, clamped to the hall.
 *
 * `yaw` is the heading in radians about the world's up axis, matching the
 * camera's `YXZ` composition — `yaw = 0` faces `−z`, straight down the order
 * axis from the spawn point (24 §3.1).
 *
 * Two things this does that a naive integration does not:
 *
 * 1. **Normalises the diagonal**, so walking a diagonal is not 1.41× faster
 *    than walking a wall — the oldest bug in first-person movement.
 * 2. **Clamps to `MOVEMENT_BOUNDS`**, which is tighter than the walls on
 *    purpose: a camera pressed flat against a wall renders the inside of it.
 *    Both axes, independently, so sliding along a wall still slides.
 *
 * With no key held the position is returned unchanged rather than clamped: a
 * standing player is not moving, and a frame that moves nobody should decide
 * nothing.
 */
export function stepPlayer(
  position: PlayerPosition,
  yaw: number,
  held: ReadonlySet<string>,
  delta: number,
): PlayerPosition {
  const { forward, strafe } = movementAxes(held)
  if (forward === 0 && strafe === 0) return position

  const length = Math.hypot(forward, strafe)
  const step = (MOVE_SPEED * delta) / length
  const sin = Math.sin(yaw)
  const cos = Math.cos(yaw)

  return {
    x: clamp(
      position.x + (-sin * forward + cos * strafe) * step,
      MOVEMENT_BOUNDS.minX,
      MOVEMENT_BOUNDS.maxX,
    ),
    z: clamp(
      position.z + (-cos * forward - sin * strafe) * step,
      MOVEMENT_BOUNDS.minZ,
      MOVEMENT_BOUNDS.maxZ,
    ),
  }
}

/**
 * The nearest interact target the player is standing in range of, or `null`.
 *
 * Flat distance, on each target's own `radius`: a target's prompt should not
 * depend on the player's eye height, which is pinned anyway, and the radius
 * arrives on the model so the controller never reaches for `INTERACT_DISTANCE`
 * itself (24 §8.1).
 */
export function nearestTargetId(
  position: PlayerPosition,
  targets: readonly InteractTarget[],
): InteractTargetId | null {
  let nearestId: InteractTargetId | null = null
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const target of targets) {
    const dx = position.x - target.position[0]
    const dz = position.z - target.position[2]
    const distance = Math.hypot(dx, dz)
    if (distance <= target.radius && distance < nearestDistance) {
      nearestDistance = distance
      nearestId = target.id
    }
  }
  return nearestId
}

/**
 * **The whole of the FM 9 fix, in one comparison.**
 *
 * `PlayerController` keeps the last reported id in a `useRef` and calls
 * `onNearObject` only when this returns true, so React hears from the render
 * loop only when the answer actually changed. Tequila's version called
 * `setState` sixty times a second; React bails on an identical value, so it
 * looks free right up until the day the value is an object.
 *
 * It is a `!==` and it is exported anyway, because the thing worth protecting
 * is not the operator — it is that a call happens *at all* only on a change,
 * and a named predicate is something a test can hold a regression against.
 */
export function shouldReportNearest(
  reported: InteractTargetId | null,
  nearest: InteractTargetId | null,
): boolean {
  return nearest !== reported
}

/**
 * Whether any non-essential motion runs (24 §7.6.2, FM 10).
 *
 * This board has **no** idle animation and no head-bob, and 24 §5.1 says never
 * to introduce one at all — a cheaper promise to keep than to break. The only
 * motion the rule has to gate today is the week-change lane lift of §5.5,
 * which under `prefers-reduced-motion: reduce` is dropped and the colour flash
 * carries §5.5 alone. The predicate is named for the rule rather than for its
 * single caller so that the day someone adds a second animation, the place to
 * ask the question is already here.
 */
export function shouldAnimateIdle(prefersReducedMotion: boolean): boolean {
  return !prefersReducedMotion
}
