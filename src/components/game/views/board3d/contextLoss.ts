/**
 * The lost-context path of 24 §7.6.3 (AC 21), with the renderer taken out of
 * it.
 *
 * An `ErrorBoundary` catches a **render** throw — WebGL missing when the canvas
 * first mounts. It never hears about a context the GPU takes away twenty
 * minutes later, on a driver reset or a laptop switching graphics adapters,
 * because nothing throws: the canvas simply stops painting and the player is
 * left staring at a frozen warehouse with a week to submit. §7.6.3 is explicit
 * that **a lost WebGL context must not cost a player their week**, so the loss
 * has to be heard as an event and routed into the same fallback the boundary
 * already uses.
 *
 * That subscription lived inline in `Board3D.tsx`, which is the one file 24
 * §8.1 forbids a test to import — jsdom has no WebGL — so the whole of AC 21
 * was code nothing had ever run. It lives here instead, for the same reason
 * `playerMotion.ts` exists: *assert the object, not the renderer*. Nothing in
 * this module imports three.js, `@react-three/fiber` or React, so a jsdom test
 * can dispatch the real event at a real element and watch the real listener
 * answer.
 *
 * What stays in `Board3D.tsx` is the state and the branch — a `useState` is
 * state and state belongs to the thing that renders — and that branch returns
 * the identical `WebGLFallback` element the boundary is given. One fallback,
 * two ways in.
 */

/**
 * The event a canvas fires when its drawing buffer is taken away.
 *
 * Exported rather than written twice so the subscription below and the test
 * that fires it match on one string. A listener bound to a misspelt event name
 * is a listener that never runs, and the symptom is indistinguishable from the
 * bug this whole module exists to fix.
 */
export const CONTEXT_LOST_EVENT = 'webglcontextlost'

/**
 * Listens for the loss of the WebGL context under `host` and calls `onLost`.
 *
 * `preventDefault()` comes first, per the WebGL specification: it is what tells
 * the browser the page intends to handle the loss rather than leaving the
 * canvas dead. We handle it by leaving — `onLost` is what swaps the 3D board
 * for the 2D one.
 *
 * The listener is bound on the wrapper in the **capture** phase rather than on
 * the `<canvas>` itself. The event is dispatched at the canvas either way;
 * capture reaches an ancestor whether or not the event bubbles, which spares
 * the caller both a `querySelector` for an element `@react-three/fiber` owns
 * and a guess about an implementation detail. `webglcontextlost` does not
 * bubble in a real browser, so the phase is the whole reason this works.
 *
 * Returns the unsubscribe, shaped to be returned straight out of a `useEffect`:
 * the wrapper unmounts with the canvas it wraps, so there is exactly one
 * listener for exactly as long as there is a context to lose.
 */
export function observeContextLoss(host: HTMLElement, onLost: () => void): () => void {
  const handleContextLost = (event: Event): void => {
    event.preventDefault()
    onLost()
  }

  host.addEventListener(CONTEXT_LOST_EVENT, handleContextLost, true)
  return () => host.removeEventListener(CONTEXT_LOST_EVENT, handleContextLost, true)
}
