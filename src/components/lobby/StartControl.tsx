import type { ReactElement } from 'react'

export interface StartControlProps {
  /** Why the game cannot start, or null when it can. */
  blockedReason: string | null
  onStart: () => void
}

/**
 * The Start button, and the sentence that says why it will not work.
 *
 * A disabled button with no explanation is the most common way a host gets
 * stuck: they have four people in the room, the button is grey, and nothing on
 * the screen connects that to the two empty seats. The reason is rendered
 * whether or not anyone hovers.
 */
export function StartControl({ blockedReason, onStart }: StartControlProps): ReactElement {
  const blocked = blockedReason !== null

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onStart}
        disabled={blocked}
        aria-describedby={blocked ? 'start-blocked-reason' : undefined}
        className="rounded-md bg-brand px-6 py-3 text-base font-semibold text-ink-inverse transition hover:bg-brand-strong disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-subtle"
      >
        Start game
      </button>

      {blocked ? (
        <p id="start-blocked-reason" className="text-sm text-warning">
          {blockedReason}
        </p>
      ) : (
        <p className="text-sm text-ink-muted">
          Settings lock when the game starts. They cannot be changed mid-game.
        </p>
      )}
    </div>
  )
}

export default StartControl
