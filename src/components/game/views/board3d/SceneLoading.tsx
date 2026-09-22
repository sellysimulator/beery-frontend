import type { ReactElement } from 'react'

/**
 * The `<Suspense>` fallback while the scene's four `.glb` models load
 * (24 §6.2, §7.3).
 *
 * A bone-coloured card in the house style, not a spinner on black. The black
 * canvas is the thing a first-time player reads as "it broke"; the surface
 * colour and the border are the same ones every other waiting state in this app
 * uses, so the wait looks like part of the game rather than a gap in it. Like
 * `PausedOverlay`, it says what is being waited for instead of spinning
 * silently, and it names the 2D board as the way out — §2.4 keeps that toggle
 * one keyboard-reachable button away in every state, including this one.
 */
export function SceneLoading(): ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-screen items-center justify-center bg-surface px-6"
    >
      <div className="flex max-w-md flex-col gap-2 rounded-lg border border-border-strong bg-surface-raised px-6 py-6 text-center">
        <h2 className="text-xl font-semibold">Building your warehouse</h2>
        <p className="text-ink-muted">
          Loading the crates, the truck and the floor. This happens once — after that the
          models are cached.
        </p>
        <p className="text-sm text-ink-subtle">
          The 2D board has every one of these numbers, and it is one button away.
        </p>
      </div>
    </div>
  )
}

export default SceneLoading
