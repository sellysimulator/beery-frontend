/**
 * The 3D board's joystick on a phone (spec §9.7), as a DOM component, with the
 * pure `stickControls` it answers with. What the controls *do* is
 * `playerMotion.ts`'s, asserted in `board3dController.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import Joystick from '../components/game/views/board3d/Joystick'
import {
  STICK_DEAD_ZONE,
  stickControls,
  type PadControl,
} from '../components/game/views/board3d/playerMotion'

describe('stickControls', () => {
  const R = 56

  it('answers nothing inside the dead zone', () => {
    expect(stickControls(0, 0, R)).toEqual([])
    expect(stickControls(0, -R * (STICK_DEAD_ZONE - 0.01), R)).toEqual([])
  })

  it.each<[string, number, number, PadControl[]]>([
    ['up', 0, -40, ['forward']],
    ['up-right', 30, -30, ['forward', 'strafe-right']],
    ['right', 40, 0, ['strafe-right']],
    ['down-right', 30, 30, ['backward', 'strafe-right']],
    ['down', 0, 40, ['backward']],
    ['down-left', -30, 30, ['backward', 'strafe-left']],
    ['left', -40, 0, ['strafe-left']],
    ['up-left', -30, -30, ['forward', 'strafe-left']],
  ])('a push %s', (_, dx, dy, controls) => {
    expect([...stickControls(dx, dy, R)].sort()).toEqual([...controls].sort())
  })
})

describe('Joystick', () => {
  /** jsdom lays nothing out: a 112 px base at the origin, centre (56, 56). */
  function setup() {
    const held = new Set<PadControl>()
    const view = render(
      <Joystick
        onPress={(control) => void held.add(control)}
        onRelease={(control) => void held.delete(control)}
      />,
    )
    const stick = screen.getByRole('group', { name: 'Movement joystick' })
    stick.getBoundingClientRect = () => ({ left: 0, top: 0, width: 112, height: 112 }) as DOMRect
    const fire = (
      type: 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel',
      x: number,
      y: number,
      pointerId = 1,
    ) => fireEvent[type](stick, { pointerId, clientX: x, clientY: y })
    return { held, fire, ...view }
  }

  it('holds where the thumb points, swaps as it moves and lets go on a lift or a cancel', () => {
    const { held, fire } = setup()
    fire('pointerDown', 56, 10)
    expect([...held]).toEqual(['forward'])
    fire('pointerMove', 100, 56)
    expect([...held]).toEqual(['strafe-right'])
    fire('pointerMove', 57, 57)
    expect(held.size).toBe(0)
    fire('pointerMove', 56, 100)
    expect([...held]).toEqual(['backward'])
    fire('pointerUp', 56, 100)
    expect(held.size).toBe(0)
    fire('pointerDown', 10, 56)
    fire('pointerCancel', 10, 56)
    expect(held.size).toBe(0)
  })

  it('follows only the finger that pushed it', () => {
    const { held, fire } = setup()
    fire('pointerDown', 56, 10, 1)
    fire('pointerDown', 100, 56, 2)
    fire('pointerMove', 100, 56, 2)
    fire('pointerUp', 100, 56, 2)
    expect([...held]).toEqual(['forward'])
  })

  it('lets go when it unmounts: a panel opening must not leave the player walking', () => {
    const { held, fire, unmount } = setup()
    fire('pointerDown', 100, 100)
    expect(held.size).toBe(2)
    unmount()
    expect(held.size).toBe(0)
  })
})
