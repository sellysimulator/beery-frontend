import { useId, useState, type FormEvent, type ReactElement } from 'react'
import { MAX_DISPLAY_NAME_LENGTH, getDisplayName } from '../../utils/storage'

export interface NameFormProps {
  /** Receives the field exactly as typed; the caller stores it and emits `join`. */
  onSubmit(name: string): void
  /** The server's refusal of the last `join`, shown under the field. */
  error?: string | null
}

/**
 * The name a player takes into a room, asked on the game screen right before
 * their first `join` of it (spec §4.1, `game_stack.md` "Display names").
 *
 * It is asked here rather than on the welcome or home screen because a name
 * belongs to a seat, and the seat is created by that `join`: once seated the
 * server keeps the name, so this is the one moment it can be chosen.
 *
 * Prefilled from the last name this browser used, and from nothing else: the
 * stored name is what the player typed last time, which is a better guess at
 * what they want to be called in class than an account name. Empty is a valid
 * answer — the server then calls the seat by its alias (`P1`, `P2`…).
 *
 * The field is capped at `MAX_DISPLAY_NAME_LENGTH`, the same 24 the server
 * clamps to, so what is typed is what the room sees.
 */
export function NameForm({ onSubmit, error = null }: NameFormProps): ReactElement {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const [name, setName] = useState(() => getDisplayName() ?? '')

  function handleSubmit(event: FormEvent): void {
    event.preventDefault()
    onSubmit(name)
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface-raised px-5 py-5"
    >
      <h2 className="text-xl font-semibold">Before you join</h2>

      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor={id}>Your name</label>
        <input
          id={id}
          type="text"
          value={name}
          maxLength={MAX_DISPLAY_NAME_LENGTH}
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
          placeholder="What the room should call you"
          aria-describedby={error ? `${hintId} ${errorId}` : hintId}
          aria-invalid={error ? true : undefined}
          className="rounded-md border border-border bg-surface px-3 py-2 text-ink"
        />
        <p id={hintId} className="text-ink-muted">
          Everyone in the room sees it, and it stays for the whole game. Leave it empty to be
          called by your seat number (P1, P2…).
        </p>
      </div>

      {error ? (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        className="rounded-md bg-brand px-4 py-3 font-semibold text-ink-inverse transition hover:bg-brand-strong"
      >
        Join the room
      </button>
    </form>
  )
}

export default NameForm
