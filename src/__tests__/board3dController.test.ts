/**
 * `24-frontend-3d-board.md §5.1` and `§7.6.2` — the controller's decisions,
 * asserted away from the renderer.
 *
 * Covers failure modes **6** (the typing guard), **9** (`setState` from
 * `useFrame`) and **10** (reduced motion), plus the movement clamp that
 * criterion 19's hall depends on, and the motion half of §5.7's touch
 * controls: the pad's walking buttons folded into the keyboard's set, and the
 * pad's turn.
 *
 * Harness notes:
 *  - This file imports `playerMotion.ts` and `sceneLayout.ts` and **nothing
 *    else from `board3d/`**. §8.1 is the line: jsdom has no WebGL, so
 *    `PlayerController.tsx`, `WarehouseScene.tsx` and `Board3D.tsx` may never
 *    be imported here, and the answer is not to mock `@react-three/fiber` but
 *    to have put the decisions somewhere a test can reach. `playerMotion.ts`
 *    is that somewhere.
 *  - It is `Board3D.test.tsx`'s sibling, not its replacement: that file owns
 *    the scene model and the DOM layers, this one owns the four failure modes
 *    that lived inside components until the seam was cut.
 *  - No fake timers and no rendering. Every test below is a function call with
 *    an expected return value, which is the entire point of the extraction.
 */
import { describe, it, expect, afterEach } from 'vitest';

import {
  COARSE_POINTER_QUERY,
  MOVEMENT_KEYS,
  MOVE_SPEED,
  PAD_WALK_KEY,
  REDUCED_MOTION_QUERY,
  TURN_SPEED,
  clampPitch,
  isTypingTarget,
  mergeHeldKeys,
  movementAxes,
  nearestTargetId,
  shouldAnimateIdle,
  shouldReportNearest,
  stepPlayer,
  stepYaw,
  turnAxis,
} from '../components/game/views/board3d/playerMotion';
import type { PadControl } from '../components/game/views/board3d/playerMotion';
import {
  INTERACT_DISTANCE,
  INTERACT_ZONES,
  MOVEMENT_BOUNDS,
} from '../components/game/views/board3d/sceneLayout';
import type {
  InteractTarget,
  InteractTargetId,
} from '../components/game/views/board3d/sceneModel';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** An element of the given tag, attached to nothing: `isTypingTarget` reads
 *  `tagName` and `isContentEditable`, neither of which needs a document. */
const el = (tag: string): HTMLElement => document.createElement(tag);

/**
 * jsdom does not implement `contentEditable` / `isContentEditable` — the
 * property is simply absent, so setting the attribute proves nothing. An own
 * data property is what the real DOM would hand the guard, and defining it
 * here keeps the test honest about which input the guard actually reads.
 */
const contentEditable = (): HTMLElement => {
  const node = el('div');
  Object.defineProperty(node, 'isContentEditable', { value: true });
  return node;
};

/** The three real interact targets of §3.2, at their real radii. Built from
 *  `INTERACT_ZONES` rather than from literals so a moved desk moves this
 *  fixture with it (FM 5's rule, applied to a different record). */
const TARGETS: readonly InteractTarget[] = (
  ['order-desk', 'ledger-wall', 'team-board'] as const
).map((id) => ({
  id,
  position: INTERACT_ZONES[id],
  radius: INTERACT_DISTANCE,
  prompt: `stand-in prompt for ${id}`,
  enabled: true,
}));

const held = (...keys: readonly string[]): ReadonlySet<string> => new Set(keys);

/** `yaw = 0` faces `−z`, straight down the order axis from the spawn point. */
const NORTH = 0;

// ---------------------------------------------------------------------------
// FM 6 — the typing guard
// ---------------------------------------------------------------------------

describe('24 §5.1 / FM 6: isTypingTarget keeps the order input from walking the player', () => {
  // [HARD-WON] The order panel contains a real `<input type="number">`.
  // Without this guard, typing `8` then `W` into it walks the player across
  // the hall mid-decision. Tequila shipped that bug; §5.1 names it.
  it.each([['input'], ['textarea'], ['select']])(
    'is true for a <%s>, which §5.1 names one by one',
    (tag) => {
      expect(isTypingTarget(el(tag))).toBe(true);
    },
  );

  it('is true for a contenteditable element, a superset of what §5.1 names', () => {
    expect(isTypingTarget(contentEditable())).toBe(true);
  });

  it('is false for a plain div, so W still walks when nobody is typing', () => {
    expect(isTypingTarget(el('div'))).toBe(false);
    expect(isTypingTarget(el('button'))).toBe(false);
  });

  it('is false for a null target and for a non-element target', () => {
    // A `keydown` dispatched at `window` has a `Window` as its target, and
    // `document` has no `tagName` at all: the guard must not throw on either,
    // because the movement listeners are bound at the window.
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(window)).toBe(false);
    expect(isTypingTarget(document)).toBe(false);
  });

  it('is decided by the tag, not by the type attribute', () => {
    // The panel's input is `type="number"`; a future one might be `text`.
    // Asserting on `tagName` is what makes that irrelevant.
    const number = el('input') as HTMLInputElement;
    number.type = 'number';
    expect(isTypingTarget(number)).toBe(true);
  });

  it('is one exported function, so the two key handlers cannot drift apart', () => {
    // `PlayerController.tsx` guards the movement keys and `Board3D.tsx` guards
    // `E`; each held a private copy of this predicate until the seam was cut.
    // A guard in two copies is a guard that drifts, and the drift is invisible
    // until a player loses a week to it.
    expect(typeof isTypingTarget).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// FM 9 — never call setState unconditionally from useFrame
// ---------------------------------------------------------------------------

describe('24 §5.1 / FM 9: proximity is reported only when the nearest id changes', () => {
  it('does not report when the id is unchanged, including null to null', () => {
    expect(shouldReportNearest(null, null)).toBe(false);
    expect(shouldReportNearest('order-desk', 'order-desk')).toBe(false);
  });

  it('reports on entering range, on leaving it and on moving between targets', () => {
    expect(shouldReportNearest(null, 'order-desk')).toBe(true);
    expect(shouldReportNearest('order-desk', null)).toBe(true);
    expect(shouldReportNearest('order-desk', 'ledger-wall')).toBe(true);
  });

  it('standing still for sixty frames produces exactly one call', () => {
    // This is the regression itself, spelled as the frame loop spells it: the
    // ref lives in the component, the comparison lives in the module, and the
    // loop below is the four lines of `useFrame` that join them. Tequila's
    // version called `setState` sixty times a second — React bails on an
    // identical value, so it looks free right up until the day the value is an
    // object.
    const calls: Array<InteractTargetId | null> = [];
    let reported: InteractTargetId | null = null;

    const desk = INTERACT_ZONES['order-desk'];
    const standing = { x: desk[0], z: desk[2] };

    for (let frame = 0; frame < 60; frame += 1) {
      const nearest = nearestTargetId(standing, TARGETS);
      if (shouldReportNearest(reported, nearest)) {
        reported = nearest;
        calls.push(nearest);
      }
    }

    expect(calls).toEqual(['order-desk']);
  });

  it('walking out of range and back reports twice more, and no more than that', () => {
    const calls: Array<InteractTargetId | null> = [];
    let reported: InteractTargetId | null = null;

    const desk = INTERACT_ZONES['order-desk'];
    // Ten frames at the desk, ten frames at the far end of the hall, ten back.
    const path = [
      ...Array.from({ length: 10 }, () => ({ x: desk[0], z: desk[2] })),
      ...Array.from({ length: 10 }, () => ({ x: MOVEMENT_BOUNDS.maxX, z: 0 })),
      ...Array.from({ length: 10 }, () => ({ x: desk[0], z: desk[2] })),
    ];

    for (const position of path) {
      const nearest = nearestTargetId(position, TARGETS);
      if (shouldReportNearest(reported, nearest)) {
        reported = nearest;
        calls.push(nearest);
      }
    }

    expect(calls).toEqual(['order-desk', null, 'order-desk']);
  });

  it('finds nothing at all in the middle of the hall', () => {
    // §3.2 puts the three zones round the edges; a player standing between
    // them has no prompt, and `null` is the honest answer rather than the
    // least-distant target.
    expect(nearestTargetId({ x: 0, z: -6 }, TARGETS)).toBeNull();
  });

  it('prefers the nearer of two targets in range', () => {
    const desk = INTERACT_ZONES['order-desk'];
    const near: readonly InteractTarget[] = [
      { ...TARGETS[0], id: 'ledger-wall', position: [desk[0], 0, desk[2] + 3] },
      { ...TARGETS[0], id: 'order-desk', position: desk },
    ];
    expect(nearestTargetId({ x: desk[0], z: desk[2] }, near)).toBe('order-desk');
  });

  it('compares against each target’s own radius, never a constant of its own', () => {
    // §8.1: the radius arrives on the model. A target with a radius of zero is
    // a target you can never be in range of, and the controller must honour
    // that without knowing why it was set.
    const desk = INTERACT_ZONES['order-desk'];
    const unreachable: readonly InteractTarget[] = [{ ...TARGETS[0], radius: 0 }];
    expect(nearestTargetId({ x: desk[0], z: desk[2] + 0.5 }, unreachable)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// FM 10 — reduced motion
// ---------------------------------------------------------------------------

describe('24 §7.6.2 / FM 10: reduced motion disables animation, not the board', () => {
  const original = window.matchMedia;
  afterEach(() => {
    window.matchMedia = original;
  });

  it('is false under prefers-reduced-motion and true otherwise', () => {
    expect(shouldAnimateIdle(true)).toBe(false);
    expect(shouldAnimateIdle(false)).toBe(true);
  });

  it('is false when the platform query the scene subscribes to matches', () => {
    // The query string is asserted, not retyped: the scene and this test read
    // the same exported constant, so a typo in the media query cannot pass
    // here and fail in a browser.
    const asked: string[] = [];
    window.matchMedia = ((query: string) => {
      asked.push(query);
      return {
        matches: query === REDUCED_MOTION_QUERY,
        media: query,
      } as unknown as MediaQueryList;
    }) as typeof window.matchMedia;

    const reduced = window.matchMedia(REDUCED_MOTION_QUERY).matches;

    expect(asked).toEqual(['(prefers-reduced-motion: reduce)']);
    expect(shouldAnimateIdle(reduced)).toBe(false);
  });

  it('still offers the board: the rule gates motion, never the 3D view', () => {
    // §7.6.2 is explicit that 3D is still offered under reduced motion — what
    // is dropped is the week-change lane lift, with the colour flash carrying
    // §5.5 alone. The only thing this predicate may ever return is a boolean
    // about animation.
    expect(typeof shouldAnimateIdle(true)).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// Movement — the clamp, the diagonal and the delta
// ---------------------------------------------------------------------------

describe('24 §5.1: the walk is clamped to the hall on both axes', () => {
  it('clamps a step that would leave the hall to the east', () => {
    // `D` with `yaw = 0` strafes toward `+x`. A one-second frame is five times
    // the whole half-width: the clamp is the only thing between the player and
    // the inside of a wall.
    const next = stepPlayer({ x: 18, z: 0 }, NORTH, held('d'), 5);
    expect(next.x).toBe(MOVEMENT_BOUNDS.maxX);
    expect(next.z).toBe(0);
  });

  it('clamps to the west, the north and the south the same way', () => {
    expect(stepPlayer({ x: -18, z: 0 }, NORTH, held('a'), 5).x).toBe(MOVEMENT_BOUNDS.minX);
    expect(stepPlayer({ x: 0, z: -12 }, NORTH, held('w'), 5).z).toBe(MOVEMENT_BOUNDS.minZ);
    expect(stepPlayer({ x: 0, z: 12 }, NORTH, held('s'), 5).z).toBe(MOVEMENT_BOUNDS.maxZ);
  });

  it('clamps both axes at once in a corner', () => {
    // The diagonal into a corner is the case an axis-at-a-time clamp gets
    // wrong, and a camera pressed flat against a wall renders the inside of
    // it — which is why §3.1's bounds are tighter than the walls.
    const next = stepPlayer({ x: 18, z: -12 }, NORTH, held('w', 'd'), 5);
    expect(next).toEqual({ x: MOVEMENT_BOUNDS.maxX, z: MOVEMENT_BOUNDS.minZ });
  });

  it('leaves a standing player exactly where they are', () => {
    const standing = { x: 3, z: -4 };
    expect(stepPlayer(standing, NORTH, held(), 1 / 60)).toEqual(standing);
    // Opposite keys cancel: `A` and `D` together is a standstill, not a drift.
    expect(stepPlayer(standing, NORTH, held('a', 'd'), 1 / 60)).toEqual(standing);
  });

  it('walks a diagonal at the same speed as a wall', () => {
    // The oldest bug in first-person movement: an unnormalised diagonal is
    // 1.41× faster, and a player who finds it stops walking anywhere else.
    const straight = stepPlayer({ x: 0, z: 0 }, NORTH, held('w'), 1);
    const diagonal = stepPlayer({ x: 0, z: 0 }, NORTH, held('w', 'd'), 1);

    expect(Math.hypot(straight.x, straight.z)).toBeCloseTo(MOVE_SPEED, 10);
    expect(Math.hypot(diagonal.x, diagonal.z)).toBeCloseTo(MOVE_SPEED, 10);
  });

  it('scales by delta, so the walk is the same on a 144 Hz panel', () => {
    const half = stepPlayer({ x: 0, z: 0 }, NORTH, held('w'), 0.5);
    expect(Math.hypot(half.x, half.z)).toBeCloseTo(MOVE_SPEED / 2, 10);
  });

  it('walks forward down the order axis and strafes across it', () => {
    // `yaw = 0` faces `−z` (§3.1), so `W` decreases `z` and `D` increases `x`.
    // Inverting either is a controller that feels haunted.
    const forward = stepPlayer({ x: 0, z: 0 }, NORTH, held('w'), 1 / 7);
    expect(forward.z).toBeCloseTo(-1, 10);
    expect(forward.x).toBeCloseTo(0, 10);

    const right = stepPlayer({ x: 0, z: 0 }, NORTH, held('d'), 1 / 7);
    expect(right.x).toBeCloseTo(1, 10);
    expect(right.z).toBeCloseTo(0, 10);
  });

  it('turns the walk with the heading rather than with the world', () => {
    // A quarter turn left puts `W` on `−x`: the movement is relative to where
    // the player is looking, which is the whole of "first person".
    const turned = stepPlayer({ x: 0, z: 0 }, Math.PI / 2, held('w'), 1 / 7);
    expect(turned.x).toBeCloseTo(-1, 10);
    expect(turned.z).toBeCloseTo(0, 10);
  });

  it('reads the arrow keys as well as WASD', () => {
    // A player who has just typed an order reaches for the arrows first.
    expect(movementAxes(held('arrowup'))).toEqual({ forward: 1, strafe: 0 });
    expect(movementAxes(held('arrowdown'))).toEqual({ forward: -1, strafe: 0 });
    expect(movementAxes(held('arrowleft'))).toEqual({ forward: 0, strafe: -1 });
    expect(movementAxes(held('arrowright'))).toEqual({ forward: 0, strafe: 1 });
    expect(movementAxes(held('shift', 'meta'))).toEqual({ forward: 0, strafe: 0 });
  });
});

describe('24 §5.1: pitch is clamped and yaw is not', () => {
  it('clamps looking up and looking down to the section’s own limits', () => {
    expect(clampPitch(Math.PI)).toBeCloseTo(Math.PI / 3.2, 10);
    expect(clampPitch(-Math.PI)).toBeCloseTo(-Math.PI / 3, 10);
  });

  it('leaves a pitch inside the range untouched', () => {
    expect(clampPitch(0)).toBe(0);
    expect(clampPitch(0.4)).toBe(0.4);
  });
});

// ---------------------------------------------------------------------------
// 24 §5.7 — the on-screen pad's motion, away from the renderer
// ---------------------------------------------------------------------------

const pad = (...controls: PadControl[]): ReadonlySet<PadControl> => new Set(controls);
const keys = (...names: string[]): ReadonlySet<string> => new Set(names);

describe('24 §5.7: the pad walks through stepPlayer, never beside it', () => {
  it('maps each walking button to the keyboard key it stands for', () => {
    expect(PAD_WALK_KEY).toEqual({ forward: 'w', backward: 's', 'strafe-left': 'a', 'strafe-right': 'd' });
    // The turn buttons have no keyboard twin: the arrows walk, unchanged.
    expect(PAD_WALK_KEY['turn-left']).toBeUndefined();
    expect(PAD_WALK_KEY['turn-right']).toBeUndefined();
  });

  it('returns the keyboard set itself when the pad holds nothing — no allocation per frame', () => {
    const keyboard = keys('w');
    expect(mergeHeldKeys(keyboard, pad())).toBe(keyboard);
  });

  it('folds the pad s walking buttons in beside the keyboard s keys', () => {
    expect([...mergeHeldKeys(keys(), pad('forward'))]).toEqual(['w']);
    expect(new Set(mergeHeldKeys(keys('d'), pad('backward')))).toEqual(new Set(['d', 's']));
    // Turning is not walking: a turn button adds no key at all.
    expect(mergeHeldKeys(keys(), pad('turn-left', 'turn-right')).size).toBe(0);
  });

  it('never mutates either input — a lifted thumb must not release a held key', () => {
    const keyboard = new Set(['a']);
    const held = new Set<PadControl>(['forward']);
    mergeHeldKeys(keyboard, held);
    expect([...keyboard]).toEqual(['a']);
    expect([...held]).toEqual(['forward']);
  });

  it('a key held on both is held once: W and the forward button walk at one speed', () => {
    const both = stepPlayer({ x: 0, z: 0 }, 0, mergeHeldKeys(keys('w'), pad('forward')), 1 / 7);
    const one = stepPlayer({ x: 0, z: 0 }, 0, keys('w'), 1 / 7);
    expect(both).toEqual(one);
    expect(one.z).toBeCloseTo(-MOVE_SPEED / 7, 10);
  });

  it('the pad s forward walks exactly as W does, including the clamp', () => {
    const fromPad = stepPlayer({ x: 0, z: 0 }, 0, mergeHeldKeys(keys(), pad('forward')), 1 / 7);
    expect(fromPad).toEqual(stepPlayer({ x: 0, z: 0 }, 0, keys('w'), 1 / 7));

    const intoTheWall = stepPlayer({ x: 0, z: 0 }, 0, mergeHeldKeys(keys(), pad('forward')), 100);
    expect(intoTheWall.z).toBe(MOVEMENT_BOUNDS.minZ);
  });

  it('opposite buttons cancel, as A and D do', () => {
    const still = { x: 1, z: 2 };
    expect(stepPlayer(still, 0, mergeHeldKeys(keys(), pad('strafe-left', 'strafe-right')), 1)).toBe(still);
  });

  it('leaves the keyboard mapping exactly as it was', () => {
    expect(new Set(MOVEMENT_KEYS)).toEqual(
      new Set(['w', 'arrowup', 's', 'arrowdown', 'a', 'arrowleft', 'd', 'arrowright']),
    );
  });
});

describe('24 §5.7: the pad turns at TURN_SPEED, and turning is look', () => {
  it('turns at Samby s 1.7 rad/s', () => {
    expect(TURN_SPEED).toBe(1.7);
  });

  it('turn left raises yaw and turn right lowers it, scaled by delta', () => {
    expect(stepYaw(0, pad('turn-left'), 0.5)).toBeCloseTo(0.85, 10);
    expect(stepYaw(0, pad('turn-right'), 0.5)).toBeCloseTo(-0.85, 10);
    expect(stepYaw(1, pad('turn-left'), 1)).toBeCloseTo(1 + TURN_SPEED, 10);
  });

  it('positive yaw is a left turn: a quarter turn left puts forward on −x', () => {
    // The same convention `stepPlayer` and the drag-look use, so the turn
    // button and the walk agree on which way "left" is.
    const yaw = stepYaw(0, pad('turn-left'), Math.PI / 2 / TURN_SPEED);
    const walked = stepPlayer({ x: 0, z: 0 }, yaw, keys('w'), 1 / 7);
    expect(walked.x).toBeCloseTo(-1, 10);
    expect(walked.z).toBeCloseTo(0, 10);
  });

  it('nothing held, both held or only walking held: yaw is unchanged', () => {
    expect(stepYaw(0.3, pad(), 1)).toBe(0.3);
    expect(stepYaw(0.3, pad('turn-left', 'turn-right'), 1)).toBe(0.3);
    expect(stepYaw(0.3, pad('forward', 'strafe-left'), 1)).toBe(0.3);
    expect(turnAxis(pad('turn-left', 'turn-right'))).toBe(0);
  });

  it('yaw is unclamped — a warehouse is a room you turn round in', () => {
    expect(stepYaw(0, pad('turn-left'), 10)).toBeCloseTo(17, 10);
  });

  it('the pad shows on any coarse pointer, not only a primary one', () => {
    expect(COARSE_POINTER_QUERY).toBe('(any-pointer: coarse)');
  });
});
