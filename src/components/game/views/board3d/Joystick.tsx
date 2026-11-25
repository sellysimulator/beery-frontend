import { useEffect, useRef, useState, type PointerEvent, type ReactElement } from 'react'
import type { MovePadProps } from './MovePad'
import { stickControls, type PadControl } from './playerMotion'

/** How far the knob travels, in px: its centre stops short of the base's edge. */
const TRAVEL = 34

export interface JoystickProps extends MovePadProps {
  /** Where it sits. */
  className?: string
}

/**
 * The walk control on a phone: push the knob and the player walks that way,
 * while another finger drags the scene to look.
 *
 * It presses and releases the pad's own controls, so `Board3D` hears a thumb
 * the way it hears a `MovePad` button. One pointer at a time; a lift, a
 * cancel, a lost capture and an unmount all let go, for the reason `MovePad`
 * gives: a push that is never released walks the player into a wall.
 */
export function Joystick({ onPress, onRelease, className = '' }: JoystickProps): ReactElement {
  const [knob, setKnob] = useState({ x: 0, y: 0 })
  const pointer = useRef<number | null>(null)
  const held = useRef<readonly PadControl[]>([])
  const latest = useRef({ onPress, onRelease })
  useEffect(() => {
    latest.current = { onPress, onRelease }
  }, [onPress, onRelease])

  const hold = (next: readonly PadControl[]): void => {
    for (const control of held.current) {
      if (!next.includes(control)) latest.current.onRelease(control)
    }
    for (const control of next) {
      if (!held.current.includes(control)) latest.current.onPress(control)
    }
    held.current = next
  }

  useEffect(
    () => () => {
      for (const control of held.current) latest.current.onRelease(control)
      held.current = []
    },
    [],
  )

  const push = (event: PointerEvent<HTMLDivElement>): void => {
    const box = event.currentTarget.getBoundingClientRect()
    const dx = event.clientX - (box.left + box.width / 2)
    const dy = event.clientY - (box.top + box.height / 2)
    const reach = Math.min(1, TRAVEL / Math.max(1, Math.hypot(dx, dy)))
    setKnob({ x: dx * reach, y: dy * reach })
    hold(stickControls(dx, dy, box.width / 2))
  }

  const release = (event: PointerEvent<HTMLDivElement>): void => {
    if (pointer.current !== event.pointerId) return
    pointer.current = null
    setKnob({ x: 0, y: 0 })
    hold([])
  }

  return (
    <div
      role="group"
      aria-label="Movement joystick"
      className={`pointer-events-auto absolute flex h-28 w-28 touch-none select-none items-center justify-center rounded-full border border-border-strong bg-surface-raised/40 [-webkit-touch-callout:none] ${className}`}
      onPointerDown={(event) => {
        if (pointer.current !== null) return
        event.preventDefault()
        pointer.current = event.pointerId
        // jsdom has no pointer capture; the push still counts without it.
        event.currentTarget.setPointerCapture?.(event.pointerId)
        push(event)
      }}
      onPointerMove={(event) => {
        if (pointer.current === event.pointerId) push(event)
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(event) => event.preventDefault()}
    >
      <span
        aria-hidden="true"
        className="h-12 w-12 rounded-full border border-border-strong bg-surface-raised shadow-md"
        style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }}
      />
    </div>
  )
}

export default Joystick
