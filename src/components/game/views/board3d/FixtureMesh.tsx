import { useEffect, useMemo, useRef, type ReactElement, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import Brewhouse from './Brewhouse'
import CratePile from './CratePile'
import MoneyPile from './MoneyPile'
import PlacedModel from './PlacedModel'
import SceneSign from './SceneSign'
import SouthFace from './SouthFace'
import type { InstancePool, SceneFixture } from './sceneModel'
import { WEEK_CHANGE_LIFT } from './sceneLayout'
import { ARCHITECTURE_HEX } from './scenePalette'
import {
  accentMaterial,
  CONTACT_MATERIAL,
  DESK_SURFACE_GEOMETRY,
  DESK_SURFACE_WITH_CLIPBOARD_GEOMETRY,
  FIXTURE_SIZE,
  FRAME_MATERIAL,
  GHOST_MATERIAL,
  GHOST_Y,
  PAD_Y,
  PAINT_Y,
  padSize,
  PALLET_GHOST_GEOMETRY,
  PEN_RAILS_GEOMETRY,
  quantityMaterial,
  STRUCTURE_MATERIAL,
  SURFACE_MATERIAL,
  toTriple,
  UNIT_BOX,
  UNIT_PLANE,
  WARNING_GLYPH,
} from './sceneMaterials'

/**
 * One fixture of the `SceneModel`, as meshes.
 *
 * The rule this file is written against is 24 §8.1, and it is the only rule
 * that matters here: **it adds nothing the model does not carry.** Every
 * position, rotation, count, hex and string below arrives on the `fixture`
 * prop, and a coordinate typed into a `<mesh position>` would be a geometry
 * decision made in the renderer — untestable, and by that section's own words
 * a defect. What this file chooses is the *shape* of a pen, a desk or a gate;
 * those dimensions are named in `sceneMaterials.ts`, which says why.
 *
 * Three things are rendered for every fixture whatever its kind, because the
 * model attaches them to fixtures and not to the scene: its signs, its GLB
 * placements and its instanced pool. **All three carry world coordinates**
 * (`sceneModel.ts` builds them with `at(base, …)`), so they are emitted
 * un-parented and never inside the fixture's own transform — nesting them
 * would add the fixture's centre twice.
 */

/**
 * How fast the week-change lift converges, per second.
 *
 * 24 §5.5 gives one lerp and `19 §3.2` gives it 400 ms — *"a class of four is
 * waiting"*. At this rate the lane is within a millimetre of the top in about
 * 220 ms and back on the floor the same distance after `weekChanged` flips,
 * so the whole gesture lives inside the window `GameRoomPlaying`'s
 * `WEEK_HIGHLIGHT_MS` already owns. The timer is not re-implemented here: this
 * component only watches the prop.
 */
const LIFT_RATE = 14

/**
 * The front receiving lane's 0.15 u lift (24 §5.5) — **one** `useFrame` on
 * **one** group, never one per crate.
 *
 * It wraps the supply-lane pool, which is one `InstancedMesh` holding all four
 * lanes (24 §7.2 budgets the lanes as a single pool with four offsets). A lift
 * confined to lane 0's crates alone is therefore not expressible without
 * splitting that pool into four, and splitting it would cost three draw calls
 * to animate 0.15 of a metre. The lanes rise together; the front one is 1.15×
 * the others and nearest the camera, so it is what the player sees move.
 */
function LaneLift({ active, children }: { active: boolean; children: ReactNode }): ReactElement {
  const ref = useRef<THREE.Group>(null)

  useFrame((_, delta) => {
    const group = ref.current
    if (!group) return
    const target = active ? WEEK_CHANGE_LIFT : 0
    const step = Math.min(1, delta * LIFT_RATE)
    const next = group.position.y + (target - group.position.y) * step
    // Snap the last millimetre: a lerp is asymptotic, and a group parked at
    // 0.0004 keeps the render loop honest about nothing.
    group.position.y = Math.abs(target - next) < 0.001 ? target : next
  })

  return <group ref={ref}>{children}</group>
}

/**
 * The dark quad that grounds a pile (24 §7.4: shadows are off, so contact is
 * painted). One per stack, sized to the pool's own grid.
 *
 * Only the pools that stand on bare floor get one — the stock floor, the
 * backlog pen, the production queue. The receiving lanes and the order-road
 * markers already stand on painted bay and road, which grounds them for free
 * and saves seven draw calls out of a budget 24 §7.1 caps at 90.
 */
function PoolContact({ pool }: { pool: InstancePool }): ReactElement {
  const [width, depth] = padSize(pool.gridWidth, pool.gridDepth)
  return (
    <group>
      {pool.stacks.map((stack) => {
        const scale = stack.scale ?? 1
        return (
          <mesh
            key={`${stack.position[0]},${stack.position[2]}`}
            geometry={UNIT_PLANE}
            material={CONTACT_MATERIAL}
            position={[stack.position[0], PAD_Y, stack.position[2]]}
            rotation={[-Math.PI / 2, 0, 0]}
            scale={[width * scale, depth * scale, 1]}
          />
        )
      })}
    </group>
  )
}

/**
 * A board on a wall: the ledger, the team board, the leaderboard on its back.
 *
 * Its frame is a **clone** of the hoisted prototype, taken once and recoloured
 * in place (24 §5.5). The ledger's frame swaps to `--color-order` for the
 * 400 ms of a week change, and the swap arrives as `fixture.accent` — the
 * model already decided it, which is what makes it testable. Building a new
 * `MeshStandardMaterial` for that would compile a shader on the one frame of
 * the week where the player is looking hardest.
 */
function WallBoard({ fixture }: { fixture: SceneFixture }): ReactElement {
  const frame = useMemo(() => FRAME_MATERIAL.clone(), [])
  const accent = fixture.accent ?? ARCHITECTURE_HEX.borderStrong
  const { width, height, frame: frameWidth, thickness } = FIXTURE_SIZE.board

  useEffect(() => {
    frame.color.set(accent)
  }, [frame, accent])

  // The clone is this component's own; nothing else can be holding it.
  useEffect(() => () => frame.dispose(), [frame])

  // The board sits *behind* its own text. Every row the model built is at the
  // fixture's centre, so the panel is pushed back along the way it faces, and
  // the signs stand clear of it instead of inside it.
  const normal = new THREE.Vector3(Math.sin(fixture.rotationY), 0, Math.cos(fixture.rotationY))
  const centre = new THREE.Vector3(...toTriple(fixture.position)).addScaledVector(normal, -0.22)

  return (
    <group position={[centre.x, 0, centre.z]} rotation={[0, fixture.rotationY, 0]}>
      <mesh
        geometry={UNIT_BOX}
        material={frame}
        position={[0, height / 2 + 0.2, 0]}
        scale={[width + frameWidth * 2, height + frameWidth * 2, thickness]}
      />
      <mesh
        geometry={UNIT_BOX}
        material={SURFACE_MATERIAL}
        position={[0, height / 2 + 0.2, thickness * 0.5]}
        scale={[width, height, thickness]}
      />
    </group>
  )
}

/**
 * The order desk, its canopy and the clipboard on it (24 §3.2, §4.3).
 *
 * Three meshes whatever the state of the game: the slab and the clipboard are
 * one merged surface geometry, the two canopy posts are another, and the
 * canopy is its own because it is one of the four things 24 §3.0 lets wear the
 * role accent. `clipboard: 'absent'` — the game being over — swaps the surface
 * geometry for the one without a clipboard on it rather than dropping a mesh.
 */
function OrderDesk({ fixture, clipboardVisible }: { fixture: SceneFixture; clipboardVisible: boolean }): ReactElement {
  return (
    <group position={toTriple(fixture.position)} rotation={[0, fixture.rotationY, 0]}>
      <mesh
        geometry={clipboardVisible ? DESK_SURFACE_WITH_CLIPBOARD_GEOMETRY : DESK_SURFACE_GEOMETRY}
        material={SURFACE_MATERIAL}
      />
    </group>
  )
}

/** The backlog pen and the production queue: a fenced square, and the warning
 *  glyph that says what it is without asking the player to read a colour. */
function Pen({ fixture }: { fixture: SceneFixture }): ReactElement {
  const { depth, height } = FIXTURE_SIZE.pen
  // 24 §3.8 puts the glyph in the same hex as the crates it stands over —
  // `--color-backlog` for the pen, `--color-warning` for the production queue.
  // The pool carries that hex, so the glyph takes it from there rather than
  // from a second copy of the palette; an empty pen has no pool and no
  // quantity to be coloured for, and keeps the structural grey.
  const glyphMaterial = fixture.pool ? quantityMaterial(fixture.pool.color) : STRUCTURE_MATERIAL

  return (
    <group position={toTriple(fixture.position)} rotation={[0, fixture.rotationY, 0]}>
      {/* Four rails, one mesh: they share the structural grey and none of them
          ever moves (24 §7.1). The glyph cannot join them — it takes its hex
          from the pool standing inside the pen. */}
      <mesh geometry={PEN_RAILS_GEOMETRY} material={STRUCTURE_MATERIAL} />
      {fixture.glyph === 'warning' ? (
        <mesh
          geometry={WARNING_GLYPH}
          material={glyphMaterial}
          position={[0, height + 1, depth / 2]}
        />
      ) : null}
    </group>
  )
}

/** What each fixture kind is made of. No hooks: every branch that needs one is
 *  a component of its own above, so the switch cannot make a conditional call. */
function Dressing({
  fixture,
  clipboardVisible,
  doorClosed,
}: {
  fixture: SceneFixture
  clipboardVisible: boolean
  doorClosed: boolean
}): ReactElement | null {
  const accent = fixture.accent ?? ARCHITECTURE_HEX.borderStrong
  const paint = accentMaterial(accent)
  const [x, , z] = fixture.position

  switch (fixture.kind) {
    // Paint, and nothing overhead. The receiving bay carried a gantry — a beam
    // on two posts — and the bay's two totals hung from it; the beam is one of
    // the three overhead structures a player asked to have removed, and the
    // signs it carried are still here, at `SIGN_HEIGHT.bayTotal`, because they
    // are `PlayerView` figures and the beam was scenery (amended 2026-09-22).
    case 'bay-paint':
      return (
        <mesh
          geometry={UNIT_PLANE}
          material={paint}
          position={[x, PAINT_Y, z]}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={[FIXTURE_SIZE.bayPaint.width, FIXTURE_SIZE.bayPaint.depth, 1]}
        />
      )

    // What is left of the upstream gate: a painted threshold across the road
    // where it leaves the hall, in the role accent. The posts and the lintel
    // "the courier drives under" are gone with the other two arches. It is
    // laid at `GHOST_Y` so it sits above both the road paint beneath it and
    // the courier's contact quad at `PAD_Y` rather than z-fighting either.
    case 'gate-threshold':
      return (
        <mesh
          geometry={UNIT_PLANE}
          material={paint}
          position={[x, GHOST_Y, z]}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={[FIXTURE_SIZE.gateThreshold.width, FIXTURE_SIZE.gateThreshold.depth, 1]}
        />
      )

    case 'road':
      return (
        <mesh
          geometry={UNIT_PLANE}
          material={paint}
          position={[x, PAINT_Y, z]}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={[FIXTURE_SIZE.roadPaint.width, FIXTURE_SIZE.roadPaint.depth, 1]}
        />
      )

    // A placard's post is drawn by `PlacardPosts`, one `InstancedMesh` for
    // every placard in the hall — ten identical posts is one draw call, not
    // ten (24 §7.1, AC 19). Its sign is still this fixture's, below.
    case 'placard':
      return null

    case 'pile-floor':
      // Two fixtures share this kind. The pile's own pad carries no accent;
      // the empty-pallet ghost of 24 §4.2 carries `--color-border` and is a
      // separate fixture, which is how "there is none" gets said out loud.
      // The stock floor draws no pad: a grey slab under grey crates reads as
      // a second, larger box rather than as ground. The pen and the empty
      // pallet ghost keep theirs — the pen's marks out an area the player must
      // not read as stock, and the ghost is the "there is none" statement.
      return fixture.id === 'stock-floor' ? null : fixture.accent === undefined ? (
        <mesh
          geometry={UNIT_PLANE}
          material={SURFACE_MATERIAL}
          position={[x, PAD_Y, z]}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={[FIXTURE_SIZE.pallet.width, FIXTURE_SIZE.pallet.depth, 1]}
        />
      ) : (
        <mesh
          geometry={PALLET_GHOST_GEOMETRY}
          material={GHOST_MATERIAL}
          position={[x, GHOST_Y, z]}
          rotation={[-Math.PI / 2, 0, 0]}
        />
      )

    case 'pen':
      return <Pen fixture={fixture} />

    case 'desk':
      return <OrderDesk fixture={fixture} clipboardVisible={clipboardVisible} />

    case 'wall-board':
      return <WallBoard fixture={fixture} />

    case 'plinth':
      return (
        <mesh
          geometry={UNIT_BOX}
          material={fixture.accent === undefined ? SURFACE_MATERIAL : paint}
          position={[x, FIXTURE_SIZE.plinth.height / 2, z]}
          scale={[FIXTURE_SIZE.plinth.width, FIXTURE_SIZE.plinth.height, FIXTURE_SIZE.plinth.depth]}
        />
      )

    // The neighbour hatch, **flat against the wall it is recessed into**. Its
    // scale used to be `[0.2, height, width]`, and three.js applies scale
    // before rotation, so at the fixture's `−π/2` the 0.2 landed on `z` and
    // the 3.6 on `x`: a fin standing out into the room off the east wall
    // rather than a panel in it. Width on the local `x`, thickness on the
    // local `z`, and the rotation lays it on the wall (amended 2026-09-22).
    case 'hatch':
      return (
        <mesh
          geometry={UNIT_BOX}
          material={STRUCTURE_MATERIAL}
          position={[x, FIXTURE_SIZE.hatch.height / 2, z]}
          rotation={[0, fixture.rotationY, 0]}
          scale={[FIXTURE_SIZE.hatch.width, FIXTURE_SIZE.hatch.height, 0.2]}
        />
      )

    case 'racking':
      return null

    case 'brewhouse':
      return <Brewhouse position={fixture.position} accent={accent} />

    case 'shopfront':
    case 'dock-doors':
    case 'cross-dock':
    case 'dispatch-yard':
      return (
        <SouthFace
          variant={fixture.kind}
          position={fixture.position}
          accent={accent}
          doorClosed={doorClosed}
        />
      )

    // A vehicle and a figure group *are* their models, which the caller emits
    // for every fixture. There is nothing else to build.
    case 'figures':
    case 'vehicle':
      return null
  }
}

export interface FixtureMeshProps {
  readonly fixture: SceneFixture
  /** `SceneModel.desk.clipboard !== 'absent'` — the desk's state is the
   *  game's, and the model already read it off the props (24 §4.3). */
  readonly clipboardVisible: boolean
  /** `SceneModel.dispatchDoorClosed`. */
  readonly doorClosed: boolean
  /** True while the front lane should be lifted: `weekChanged`, unless the
   *  player asked for reduced motion (24 §5.5, §7.6). */
  readonly laneLift: boolean
}

export function FixtureMesh({
  fixture,
  clipboardVisible,
  doorClosed,
  laneLift,
}: FixtureMeshProps): ReactElement {
  const pool = fixture.pool
  // See `PoolContact`: a pile on paint is already grounded by the paint.
  const grounded = fixture.kind === 'pile-floor' || fixture.kind === 'pen'

  return (
    <group>
      <Dressing fixture={fixture} clipboardVisible={clipboardVisible} doorClosed={doorClosed} />

      {fixture.signs.map((item) => (
        <SceneSign
          key={item.id}
          text={item.text}
          position={item.position}
          size={item.size}
          color={item.color}
          rotationY={item.rotationY}
          // The wrap width the model measured this sign's plate with. Without
          // it the sign falls back to `SIGN_MAX_WIDTH` (the ledger board's
          // 5.8) while its plate was sized at `SIGN_WIDE_MAX_WIDTH`, so a wide
          // sign wraps to two lines inside a plate built for one and the text
          // runs off it.  [HARD-WON]
          maxWidth={item.maxWidth}
          billboard={item.billboard}
        />
      ))}

      {fixture.models.map((placement) => (
        <PlacedModel key={placement.id} placement={placement} />
      ))}

      {pool === undefined ? null : pool.asset === 'money' ? (
        <MoneyPile pool={pool} />
      ) : pool.id === 'supply-lanes' ? (
        <LaneLift active={laneLift}>
          <CratePile
            color={pool.color}
            gridWidth={pool.gridWidth}
            gridDepth={pool.gridDepth}
            stacks={pool.stacks}
          />
        </LaneLift>
      ) : (
        <group>
          {grounded ? <PoolContact pool={pool} /> : null}
          <CratePile
            color={pool.color}
            gridWidth={pool.gridWidth}
            gridDepth={pool.gridDepth}
            stacks={pool.stacks}
          />
        </group>
      )}
    </group>
  )
}

export default FixtureMesh
