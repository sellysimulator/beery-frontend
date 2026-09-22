import { useEffect, useRef, type ReactElement } from 'react'
import * as THREE from 'three'
import { Text } from '@react-three/drei'
import type { Vec3 } from './sceneLayout'
import { SIGN_LINE_HEIGHT, SIGN_MAX_WIDTH, SIGN_SIZE } from './sceneLayout'
import { TEXT_HEX } from './scenePalette'
import { BILLBOARD_GROUPS, BILLBOARD_YAW } from './signBillboard'
import { toTriple } from './sceneMaterials'

/**
 * Every word painted inside the canvas goes through this component.
 *
 * Two rules it exists to keep. First, **in-scene text is drei `<Text>`, never
 * drei `<Html>`** (24 §7.1): an `<Html>` inside the canvas is a DOM node
 * positioned by a per-frame projection, which is a layout and a style
 * recalculation every frame, and it is unreachable behind the wrapper's
 * `aria-hidden` anyway. Second, one wrapper means one place where the font,
 * the wrap width, the line pitch and the backing plate are decided, so sixteen
 * signs cannot drift into sixteen typographies — nor into sixteen second
 * passes.
 *
 * The words themselves are never this component's business. Every string,
 * every position, every size and every colour arrives from the `SceneModel`,
 * which built it out of a `PlayerView` field — 24 §8.1 and `19 §3.1` between
 * them mean a figure a player reads must be the server's, rendered verbatim,
 * and a sign that formatted its own number would be exactly the defect §4.1
 * exists to prevent.
 *
 * **On the font.** 24 §6.1 ships four GLBs and no font file, so there is no
 * local `.woff` to point troika at and the default resolution stands. What is
 * shared here is everything else: size, wrap, anchors, line pitch and the
 * `--color-ink` default. The wrap width and the line pitch now live in
 * `sceneLayout.ts`, because the model has to measure the plate behind the
 * words and cannot do it without knowing how they wrap.
 */

/**
 * **No outline, deliberately** (24 §7.1) — and, since 2026-09-22, a plate
 * instead.
 *
 * troika renders `outlineWidth` as a *second pass over a second mesh*, so an
 * outline on every sign doubles the text half of the draw-call budget, and
 * text is the largest single line item in 24 §7.1's arithmetic. Dropping it
 * was right about the cost and wrong about the consequence: it left thirty-odd
 * `#23201a` strings with nothing behind them, and a player who walked the hall
 * reported exactly that — *"the contrast on the floating text and the
 * background is not correct"*. Opening the roof to a cyan sky made it worse,
 * because a sign above the wall line is now read against open air.
 *
 * The answer is `SignPlates.tsx`: an opaque `--color-surface-raised` rectangle
 * behind every sign, all of them in **one** `InstancedMesh`. That is one draw
 * call for the whole hall where an outline pass would have been one per sign,
 * so the contrast is bought at 1/33rd of what the outline cost — and unlike an
 * outline it also hides whatever crate, truck or sky was behind the words.
 */

export interface SceneSignProps {
  /** The model's string, rendered verbatim. */
  readonly text: string
  readonly position: Vec3
  /** A value from `SIGN_SIZE`; statement height when the model omits one. */
  readonly size?: number
  /** A hex from `TEXT_HEX`. Defaults to `--color-ink`. */
  readonly color?: string
  /** Which way the sign faces when it does not billboard. The model decides;
   *  a wall board's rows face out of the wall. */
  readonly rotationY?: number
  readonly maxWidth?: number
  /** `SceneSign.billboard` off the model: whether this sign turns to face the
   *  player. The turning itself is done by `SignPlates.tsx`, once a frame,
   *  for every registered sign at once. */
  readonly billboard?: boolean
}

export function SceneSign({
  text,
  position,
  size = SIGN_SIZE.statement,
  color = TEXT_HEX.ink,
  rotationY = 0,
  maxWidth = SIGN_MAX_WIDTH,
  billboard = true,
}: SceneSignProps): ReactElement {
  const groupRef = useRef<THREE.Group>(null)

  useEffect(() => {
    const group = groupRef.current
    if (!group || !billboard) return
    // Start at the frame's current yaw rather than at zero: a sign that mounts
    // mid-week — a SUBMITTED stamp, a new lane placard — must not be edge-on
    // for the one frame before the next `useFrame` reaches it.
    group.rotation.y = BILLBOARD_YAW.value
    BILLBOARD_GROUPS.add(group)
    return () => {
      BILLBOARD_GROUPS.delete(group)
    }
  }, [billboard])

  return (
    <group ref={groupRef} position={toTriple(position)} rotation={[0, rotationY, 0]}>
      <Text
        fontSize={size}
        color={color}
        maxWidth={maxWidth}
        anchorX="center"
        anchorY="middle"
        textAlign="center"
        lineHeight={SIGN_LINE_HEIGHT}
      >
        {text}
      </Text>
    </group>
  )
}

export default SceneSign
