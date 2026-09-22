import type * as THREE from 'three'

/**
 * The hall's one billboard angle, and the register of everything turned by it
 * (24 §6.1, §5.1; amended 2026-09-22).
 *
 * A player who walked the hall asked for the in-scene text to *"always face
 * the player"*. Every sign in the room faces the **same** camera, so there is
 * exactly one yaw in the scene per frame — not one per sign. This module is
 * where that single answer lives, so that `SignPlates.tsx` can compute it once
 * and apply it to thirty-odd signs and thirty-odd backing plates in one pass.
 *
 * It is a module, and not a React context, for two reasons. A context value
 * that changed every frame would be a re-render of the scene graph sixty times
 * a second, which is exactly what 24 §5.1's `[HARD-WON]` note forbids; and
 * these two values are mutated from inside `useFrame`, where React state may
 * not be touched at all. Module scope is the same assumption `PlacardPosts.tsx`
 * already makes for its scratch vectors: **one hall is mounted at a time.**
 *
 * It is a separate file, rather than two more exports on `SceneSign.tsx`,
 * because `eslint-plugin-react-refresh` is right about a module that exports a
 * component *and* mutable state: fast refresh cannot preserve the state across
 * an edit to the component, and a register of live `Object3D`s that silently
 * empties on save is a hall of edge-on signs with no error anywhere.
 */

/**
 * Every billboarded sign's group.
 *
 * `SceneSign` adds its group here on mount when its model sign says
 * `billboard`, and removes it on unmount; `SignPlates` walks the set once a
 * frame and writes `rotation.y` on each. A `Set` rather than an array so that
 * React 19's StrictMode double-mount — add, add, remove — cannot leave a
 * duplicate behind, and so that removal is not a linear scan.
 *
 * **Nothing in this set is ever read by a test.** It holds three.js objects,
 * and 24 §8.1 keeps every assertion on the `SceneModel` side of the WebGL
 * line; what a test checks is the `billboard` flag the model carries, which is
 * the decision. This is only the wiring that obeys it.
 */
export const BILLBOARD_GROUPS = new Set<THREE.Object3D>()

/**
 * The yaw itself, in radians, written once a frame by `SignPlates.tsx`.
 *
 * Boxed in an object so that both files hold the *same* mutable cell rather
 * than a copy of a number. A sign that mounts mid-week — a SUBMITTED stamp, a
 * lane placard the week just added — reads it so that it is never edge-on for
 * the frame before the next `useFrame` reaches it.
 */
export const BILLBOARD_YAW = { value: 0 }
