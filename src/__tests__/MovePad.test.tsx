/**
 * `24-frontend-3d-board.md §5.7` — the on-screen movement pad, as a DOM
 * component.
 *
 * Covers §9 acceptance criterion 24's pad half: six named buttons in a named
 * group, each **held** rather than clicked, and every way a finger's lift can
 * fail to arrive releasing the press anyway. A press that is never released is
 * a player walking into a wall until they find the button again, so the four
 * release paths are each asserted on their own.
 *
 * Harness notes:
 *  - `MovePad` imports nothing from three.js; it reports presses through two
 *    callbacks, so the assertions are on the callbacks, never on a camera.
 *    What the presses *do* — the merged walk and the turn — is
 *    `playerMotion.ts`'s, asserted in `board3dController.test.ts`.
 *  - `fireEvent`, not `userEvent`, for pointer events: user-event drives
 *    pointers as a full click sequence, and a pad button is the one control
 *    whose meaning lives *between* the down and the up. jsdom has no pointer
 *    capture, which is why the component guards `setPointerCapture`.
 */
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import MovePad from '../components/game/views/board3d/MovePad'
import type { PadControl } from '../components/game/views/board3d/playerMotion'

function renderPad() {
  const onPress = vi.fn<(control: PadControl) => void>()
  const onRelease = vi.fn<(control: PadControl) => void>()
  render(<MovePad onPress={onPress} onRelease={onRelease} />)
  return { onPress, onRelease }
}

const BUTTONS: ReadonlyArray<[name: string, control: PadControl]> = [
  ['Turn left', 'turn-left'],
  ['Move forward', 'forward'],
  ['Turn right', 'turn-right'],
  ['Move left', 'strafe-left'],
  ['Move backward', 'backward'],
  ['Move right', 'strafe-right'],
]

describe('MovePad §5.7: six named buttons in one named group', () => {
  it('is a group named "Movement controls" holding the six buttons, in grid order', () => {
    renderPad()
    const group = screen.getByRole('group', { name: 'Movement controls' })
    const buttons = Array.from(group.querySelectorAll('button'))
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(
      BUTTONS.map(([name]) => name),
    )
    for (const button of buttons) expect(button).toHaveAttribute('type', 'button')
  })

  it('every button is a 44 px target that the browser may not claim as a scroll', () => {
    renderPad()
    for (const [name] of BUTTONS) {
      const className = screen.getByRole('button', { name }).className
      expect(className).toContain('h-11')
      expect(className).toContain('w-11')
      expect(className).toContain('touch-none')
      expect(className).toContain('select-none')
    }
  })

  it('the glyphs are hidden from the reader — the label is the name', () => {
    renderPad()
    const forward = screen.getByRole('button', { name: 'Move forward' })
    expect(forward.querySelector('[aria-hidden="true"]')?.textContent).toBe('↑')
  })
})

describe('MovePad §5.7: held, not clicked', () => {
  it.each(BUTTONS)('pointerdown on "%s" presses %s, pointerup releases it', (name, control) => {
    const { onPress, onRelease } = renderPad()
    const button = screen.getByRole('button', { name })

    fireEvent.pointerDown(button)
    expect(onPress).toHaveBeenCalledTimes(1)
    expect(onPress).toHaveBeenCalledWith(control)
    expect(onRelease).not.toHaveBeenCalled()
    expect(button).toHaveAttribute('data-held', 'true')

    fireEvent.pointerUp(button)
    expect(onRelease).toHaveBeenCalledWith(control)
    expect(button).not.toHaveAttribute('data-held')
  })

  it('pointercancel releases — a system gesture took the touch', () => {
    const { onRelease } = renderPad()
    const button = screen.getByRole('button', { name: 'Move forward' })
    fireEvent.pointerDown(button)
    fireEvent.pointerCancel(button)
    expect(onRelease).toHaveBeenCalledWith('forward')
  })

  it('lostpointercapture releases — the capture was taken away', () => {
    const { onRelease } = renderPad()
    const button = screen.getByRole('button', { name: 'Turn left' })
    fireEvent.pointerDown(button)
    fireEvent.lostPointerCapture(button)
    expect(onRelease).toHaveBeenCalledWith('turn-left')
  })

  it('blur releases — focus left a button that will never hear its pointerup', () => {
    const { onRelease } = renderPad()
    const button = screen.getByRole('button', { name: 'Move right' })
    fireEvent.pointerDown(button)
    fireEvent.blur(button)
    expect(onRelease).toHaveBeenCalledWith('strafe-right')
  })

  it('pointerdown cancels the default, so no focus jump or synthetic mouse follows', () => {
    renderPad()
    const button = screen.getByRole('button', { name: 'Move forward' })
    // `fireEvent` returns false when a handler called preventDefault.
    expect(fireEvent.pointerDown(button)).toBe(false)
  })

  it('two buttons held at once are two presses — walk forward while turning', () => {
    const { onPress, onRelease } = renderPad()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Move forward' }))
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Turn right' }))
    expect(onPress.mock.calls.map(([control]) => control)).toEqual(['forward', 'turn-right'])

    fireEvent.pointerUp(screen.getByRole('button', { name: 'Turn right' }))
    expect(onRelease.mock.calls.map(([control]) => control)).toEqual(['turn-right'])
    expect(screen.getByRole('button', { name: 'Move forward' })).toHaveAttribute('data-held', 'true')
  })
})

describe('MovePad §5.7: Space and Enter hold a focused button', () => {
  it.each([' ', 'Enter'])('keydown %j presses, keyup releases', (key) => {
    const { onPress, onRelease } = renderPad()
    const button = screen.getByRole('button', { name: 'Move backward' })

    // false: the default (scroll for Space, click for Enter) is cancelled.
    expect(fireEvent.keyDown(button, { key })).toBe(false)
    expect(onPress).toHaveBeenCalledWith('backward')

    fireEvent.keyUp(button, { key })
    expect(onRelease).toHaveBeenCalledWith('backward')
  })

  it('a key auto-repeat is still one hold', () => {
    const { onPress } = renderPad()
    const button = screen.getByRole('button', { name: 'Move backward' })
    fireEvent.keyDown(button, { key: ' ' })
    fireEvent.keyDown(button, { key: ' ', repeat: true })
    fireEvent.keyDown(button, { key: ' ', repeat: true })
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('other keys do nothing — W A S D are the keyboard s, not the pad s', () => {
    const { onPress, onRelease } = renderPad()
    const button = screen.getByRole('button', { name: 'Move forward' })
    fireEvent.keyDown(button, { key: 'w' })
    fireEvent.keyUp(button, { key: 'w' })
    expect(onPress).not.toHaveBeenCalled()
    expect(onRelease).not.toHaveBeenCalled()
  })
})
