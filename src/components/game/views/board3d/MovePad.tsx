import {
  useCallback,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
} from 'react'
import type { PadControl } from './playerMotion'

/**
 * The on-screen movement pad — what makes the warehouse walkable
 * with a thumb. A port of Samby's `.warehouse-movement` pad, button for button.
 *
 * Six buttons in two rows of three:
 *
 *     ↶ turn left    ↑ forward    ↷ turn right
 *     ← move left    ↓ back       → move right
 *
 * Turning is on the pad and not only on the drag because a phone held in two
 * hands has no free finger to drag with while a thumb walks; the top row is
 * what lets one thumb walk *and* steer.
 *
 * A button is **held**, not clicked: it presses on `pointerdown` and releases
 * on whichever of `pointerup`, `pointercancel`, `lostpointercapture` or `blur`
 * comes first. All four, because each one is a way the finger's lift can fail
 * to arrive — a system gesture cancels, an alert steals the capture, a focus
 * move leaves a button that will never hear its `pointerup`. A press that is
 * never released walks the player into a wall until they find the button
 * again. `setPointerCapture` keeps a thumb that slides off the button still
 * holding it, which is what a thumb does.
 *
 * Space and Enter hold it too, so a keyboard or switch user who tabs onto the
 * pad gets the same behaviour; the keyboard's own `W A S D` is unchanged and
 * does not come through here.
 *
 * The pad owns no movement. It reports presses to `Board3D`, which keeps them
 * in a set of their own that `PlayerController` reads beside the keyboard's —
 * this component's only state is which buttons to draw pressed.
 */

interface PadButton {
  readonly control: PadControl
  readonly label: string
  readonly symbol: string
}

/** The order is the grid's: three across, top row first. */
const PAD_BUTTONS: readonly PadButton[] = [
  { control: 'turn-left', label: 'Turn left', symbol: '↶' },
  { control: 'forward', label: 'Move forward', symbol: '↑' },
  { control: 'turn-right', label: 'Turn right', symbol: '↷' },
  { control: 'strafe-left', label: 'Move left', symbol: '←' },
  { control: 'backward', label: 'Move backward', symbol: '↓' },
  { control: 'strafe-right', label: 'Move right', symbol: '→' },
]

export interface MovePadProps {
  /** A button went down. Called once per press, never per frame. */
  onPress(control: PadControl): void
  /** That button came up — or was cancelled, lost its capture, or lost focus. */
  onRelease(control: PadControl): void
}

/**
 * The pad itself. `role="group"` with a name, so a screen reader announces six
 * named buttons as one control rather than six strays; each button's name is
 * its `aria-label`, because an arrow glyph read aloud is "upwards arrow".
 *
 * Every button is 44 × 44 px — the minimum touch target — and `touch-none` so
 * a held thumb is never taken for a scroll, a double-tap zoom or a long-press
 * menu. `select-none` and the touch-callout rule stop iOS from offering to
 * copy an arrow after a long hold.
 */
export function MovePad({ onPress, onRelease }: MovePadProps): ReactElement {
  const [held, setHeld] = useState<ReadonlySet<PadControl>>(() => new Set())

  const press = useCallback(
    (control: PadControl): void => {
      setHeld((current) => (current.has(control) ? current : new Set(current).add(control)))
      onPress(control)
    },
    [onPress],
  )

  const release = useCallback(
    (control: PadControl): void => {
      setHeld((current) => {
        if (!current.has(control)) return current
        const next = new Set(current)
        next.delete(control)
        return next
      })
      onRelease(control)
    },
    [onRelease],
  )

  const handlers = (control: PadControl) => ({
    onPointerDown: (event: PointerEvent<HTMLButtonElement>): void => {
      // No focus ring jump, no text selection, no synthetic mouse events
      // behind the touch.
      event.preventDefault()
      // Guarded: jsdom does not implement pointer capture, and a pad whose
      // press throws in a test is a pad nobody can assert anything about.
      if (typeof event.currentTarget.setPointerCapture === 'function') {
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          // A pointer that is already gone cannot be captured; the press
          // still counts, and its `pointerup` or `blur` still releases it.
        }
      }
      press(control)
    },
    onPointerUp: (): void => release(control),
    onPointerCancel: (): void => release(control),
    onLostPointerCapture: (): void => release(control),
    onBlur: (): void => release(control),
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>): void => {
      if (event.key !== ' ' && event.key !== 'Enter') return
      // Space would scroll the page and Enter would click; holding is the
      // whole meaning of these buttons. A key's auto-repeat is still one hold.
      event.preventDefault()
      if (!event.repeat) press(control)
    },
    onKeyUp: (event: KeyboardEvent<HTMLButtonElement>): void => {
      if (event.key !== ' ' && event.key !== 'Enter') return
      release(control)
    },
    onContextMenu: (event: { preventDefault(): void }): void => event.preventDefault(),
  })

  return (
    <div
      role="group"
      aria-label="Movement controls"
      className="grid grid-cols-3 gap-1.5 rounded-lg border border-border bg-surface-raised/80 p-1.5 shadow-sm"
    >
      {PAD_BUTTONS.map(({ control, label, symbol }) => (
        <button
          key={control}
          type="button"
          aria-label={label}
          title={label}
          data-control={control}
          data-held={held.has(control) ? 'true' : undefined}
          className="flex h-11 w-11 touch-none select-none items-center justify-center rounded-md border border-border-strong bg-surface text-xl leading-none text-ink [-webkit-touch-callout:none] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand data-[held=true]:border-brand data-[held=true]:bg-brand-soft"
          {...handlers(control)}
        >
          <span aria-hidden="true">{symbol}</span>
        </button>
      ))}
    </div>
  )
}

export default MovePad
