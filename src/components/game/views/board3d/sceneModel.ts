/**
 * The scene as a plain object: every fixture, pile count, sign string, model
 * placement, light and prompt the 3D board draws (24 §4, §5.2, §5.4).
 *
 * jsdom has no WebGL, so nothing inside the canvas renders in a test. The
 * answer is the one `chartSetup.ts` established for Chart.js:
 * **`buildSceneModel` returns exactly what `WarehouseScene` draws — the
 * component adds nothing to it — which is what lets 24's acceptance criteria
 * be checked against an object instead of against a mocked renderer**
 * (24 §8.1). The consequence for whoever edits the renderer is strict: a
 * geometry decision made in `WarehouseScene.tsx` rather than here is
 * untestable, and is a defect.
 *
 * Two rules run through the whole file.
 *
 * **Absent means absent.** A fixture gated on a visibility flag is not in the
 * returned `fixtures` array when its field is missing. Not hidden, not
 * `visible={false}` — absent. `19` AC 23 wants the six optional blocks
 * independently omitted, and a `visible` flag satisfies a screenshot while
 * violating it (24 §4.1 rule 3, §10 FM 3).
 *
 * **Every pile carries the server's true, uncapped figure.** `crateCount`
 * below is the only place in this board where a quantity becomes a mesh count,
 * and the sign beside a capped pile still reads the field verbatim. The crates
 * are a texture on the number, never a substitute for it (24 §4.1, AC 7,
 * FM 1). `SettlementRecap.tsx`'s `[HARD-WON]` note is the same boundary from
 * the other side: *a component that multiplied the two would be right until
 * the day the server rounded differently, and then wrong in a way nobody could
 * explain.*
 *
 * This module is pure and synchronous, and **imports no three.js and no
 * `@react-three/*`** — that is what keeps it loadable in a test file that
 * never touches a renderer (24 §8.2).
 */
import { ROLE_ORDER, type PlayerView, type Role } from '../../../../types/game'
import { ROLE_LABEL } from '../../../lobby/roleCopy'
import { DEMAND_SOURCE_LABEL, RECEIPT_LABEL } from '../../RoleBanner'
import { formatMoney } from '../../SettlementRecap'
import type { BoardViewProps } from '../Board2D'
import { ROLE_SETS, type RoleSet } from './roleSets'
import { ARCHITECTURE_HEX, QUANTITY_HEX, TEXT_HEX } from './scenePalette'
import {
  CHECKOUT_Z,
  CUSTOMER_FIGURE_POSITIONS,
  DOCK_DOOR_X,
  BAY_SIGN_HEIGHT,
  FIXTURE_DRAW_COST,
  FRONT_LANE_SCALE,
  INTERACT_DISTANCE,
  INTERACT_ZONES,
  LIGHT_POSITIONS,
  MAX_ORDER_SLOTS,
  MAX_SUPPLY_LANES,
  MODEL_DRAW_COST,
  ORDER_ROAD_Z,
  PILE_GRID,
  PLACARD_STAND_OFF,
  PILE_SCALE,
  SHELL_DRAW_COST,
  SKY_LIGHT_INTENSITY,
  SIGN_GATE_MAX_WIDTH,
  SIGN_HEIGHT,
  SIGN_LANE_MAX_WIDTH,
  SIGN_MARKER_MAX_WIDTH,
  SIGN_MAX_WIDTH,
  SIGN_PLATE_DRAW_COST,
  SIGN_SIZE,
  SIGN_STACK_GAP,
  SIGN_WIDE_MAX_WIDTH,
  signPlateSize,
  LANE_SPAN,
  ORDER_MARKER_SPAN,
  spreadX,
  TRUCK_POSITIONS,
  TRUCK_ROTATION,
  ZONES,
  type Vec3,
} from './sceneLayout'

/* ─── The display-scaling rule (24 §4.1, normative) ─── */

/**
 * How many crates stand for `quantity`.
 *
 * > A quantity may decide **how many meshes are drawn**. It may never be
 * > re-derived from them, and it may never become a number on screen by any
 * > route other than rendering the field itself.
 * >
 * > `crateCount(quantity, divisor, cap) = clamp(Math.floor(quantity /
 * > divisor), 0, cap)` lives in `sceneModel.ts`, is pure, and is the **only**
 * > place in the 3D view where a quantity becomes a count.
 * >
 * > **Every pile carries a sign showing the true figure**, rendered verbatim
 * > from the field. A capped pile therefore never misstates anything: the
 * > crates are a texture on the number, not a substitute for it.
 * >
 * > This is not a third permitted computation under `19 §3.1`. `19 §3.1`
 * > governs *figures a player reads*. A mesh count is not read; it is looked
 * > at.
 */
export function crateCount(quantity: number, divisor: number, cap: number): number {
  return Math.min(Math.max(Math.floor(quantity / divisor), 0), cap)
}

/* ─── The model's types ─── */

/**
 * Every fixture the hall can contain.
 *
 * The id is the contract 24 §8.2 asserts against — *"a Factory model contains
 * no `'upstream-gate'`, `'order-road'` or `'order-courier'` fixture, and does
 * contain `'brewhouse'`"* — so these strings are as load-bearing as the copy
 * on the signs.
 */
export type FixtureId =
  | 'receiving-bay'
  | 'supply-lane-0'
  | 'supply-lane-1'
  | 'supply-lane-2'
  | 'supply-lane-3'
  | 'supply-lane-overflow'
  | 'upstream-gate'
  | 'order-road'
  | 'order-courier'
  | 'order-marker-0'
  | 'order-marker-1'
  | 'order-marker-2'
  | 'brewhouse'
  | 'brewhouse-wall-sign'
  | 'racking'
  | 'stock-floor'
  | 'stock-floor-empty'
  | 'backlog-pen'
  | 'production-queue'
  | 'order-desk'
  | 'ledger-wall'
  | 'cost-corner'
  | 'team-board'
  | 'leaderboard-plaque'
  | 'dispatch-bay'
  | 'demand-placard'
  | 'demand-ticker'
  | 'south-face'
  | 'customer-figures'
  | 'dock-truck'
  | 'rear-door-truck'
  | 'dispatch-truck'
  | 'neighbour-hatch'
  | 'chain-table'

/** What kind of thing a fixture is, i.e. which branch of `WarehouseScene`
 *  draws it. The id says *which*; the kind says *how*. */
export type FixtureKind =
  | 'bay-paint'
  | 'gate-threshold'
  | 'road'
  | 'placard'
  | 'pile-floor'
  | 'pen'
  | 'desk'
  | 'wall-board'
  | 'plinth'
  | 'hatch'
  | 'racking'
  | 'brewhouse'
  | 'shopfront'
  | 'dock-doors'
  | 'cross-dock'
  | 'dispatch-yard'
  | 'figures'
  | 'vehicle'

/** The GLB assets of 24 §6.1, by the keys `gltfModels.ts` loads them under. */
export type SceneAsset = 'box' | 'truck' | 'person' | 'money'

/** A mark that carries meaning without colour (19 §3.4, AC 8). Today the
 *  backlog pen's warning triangle — the same glyph the 2D `BacklogIcon`
 *  draws — is the only one. */
export type SceneGlyph = 'warning'

/** One line of in-scene text. Never a figure this module computed. */
export interface SceneSign {
  readonly id: string
  readonly text: string
  readonly position: Vec3
  /** World units, from `SIGN_SIZE`. */
  readonly size: number
  /** A hex from `scenePalette.ts` — text colours only. */
  readonly color: string
  /**
   * Which way the sign faces when it is not billboarded, and the way it
   * *starts* facing when it is.
   */
  readonly rotationY: number
  /**
   * The white rectangle behind the words, in world metres (24 §6.1, amended
   * 2026-09-22).
   *
   * Measured here rather than in the renderer, by `signPlateSize`, because
   * 24 §8.1 puts every geometry decision on the model: a plate sized inside
   * `SignPlates.tsx` is a plate no test can measure, and the overlap sweep
   * that found the collisions of 2026-09-22 needs the same rectangle the
   * player sees.
   */
  readonly plateWidth: number
  readonly plateHeight: number
  /**
   * Where troika wraps this sign, in world metres.
   *
   * On the sign rather than on the component because the hall has three
   * different amounts of room: `SIGN_MAX_WIDTH` is the ledger board's own
   * width, a bay total standing in twenty-four metres of open floor can run
   * `SIGN_WIDE_MAX_WIDTH`, and a lane placard six metres from the next one
   * cannot run either. A single default wrapped the bay totals onto two lines
   * and let the lane placards' plates touch.
   */
  readonly maxWidth: number
  /**
   * Whether this sign turns to face the player.
   *
   * True for everything free-standing in the hall — over a pile, on a post,
   * hanging over the receiving bay — which is what a player asked for when
   * they asked for the text to *"always face the player"*. **False for a sign
   * mounted flat on a panel**: the ledger wall, the team board, the
   * leaderboard, the neighbour hatch and the roller-door numbers are painted
   * on a surface, and a surface's lettering that swung to follow the player
   * would leave its own board and sink into the wall behind it — the ledger
   * board stands 1 m off the west wall and its rows are 5.8 m wide, so a yaw
   * of 20° already buries an end of them. Those signs already face the only
   * place a player can stand to read them. Set from the fixture's kind in
   * `buildSceneModel`, never by hand, so a panel added later cannot forget.
   */
  readonly billboard: boolean
}

/**
 * One stack of instances standing at one spot. Structurally the `CrateStack`
 * that `CratePile.tsx` takes, so a pool hands its stacks straight over.
 */
export interface PileStack {
  readonly position: Vec3
  /** Already divided and capped by {@link crateCount}. */
  readonly count: number
  /** The front supply-line lane renders at `1.15` (24 §4.2). */
  readonly scale?: number
}

/** The pools of 24 §7.2: one `InstancedMesh` each, so a pile of any size is
 *  one draw call. Six are budgeted and eight is the ceiling. */
export type PoolId =
  | 'inventory'
  | 'backlog'
  | 'supply-lanes'
  | 'order-markers'
  | 'production-queue'
  | 'money'

/** One instanced pool: its asset, its quantity hex and its stacks. */
export interface InstancePool {
  readonly id: PoolId
  readonly asset: SceneAsset
  /** A **quantity** hex, never an accent (24 §3.8). */
  readonly color: string
  readonly gridWidth: number
  readonly gridDepth: number
  readonly stacks: readonly PileStack[]
}

/** One whole GLB standing somewhere — a truck, a person. */
export interface ModelPlacement {
  readonly id: string
  readonly asset: SceneAsset
  readonly position: Vec3
  readonly rotationY: number
}

/** A fixture: a thing in the hall, with the signs, crates and models on it. */
export interface SceneFixture {
  readonly id: FixtureId
  readonly kind: FixtureKind
  readonly position: Vec3
  readonly rotationY: number
  /** The role accent, on the fixtures 24 §3.0 lets carry one. Architecture
   *  only: no crate is ever accent-coloured. */
  readonly accent?: string
  readonly signs: readonly SceneSign[]
  readonly models: readonly ModelPlacement[]
  readonly pool?: InstancePool
  readonly glyph?: SceneGlyph
  /** Shelf tiers, for the racking. */
  readonly tiers?: number
}

/**
 * **One kind, and that is the point** (24 §7.1, amended 2026-09-22).
 *
 * This was `'hemisphere' | 'directional' | 'point'`, and the hall ran one of
 * each plus a second point light. A player asked for the lighting to be
 * removed and replaced with lighting uniform across the whole board, and a
 * `pointLight` cannot be that: it falls off with the square of the distance,
 * so it is a hotspot under itself and a dark corner everywhere else.
 *
 * Narrowing the union rather than deleting two entries from an array is what
 * makes the change stick. A hemisphere light has no position and no falloff —
 * it is identical at every point in the hall — and a future edit that wants a
 * positional light back cannot make one without widening this type, changing
 * `MAX_LIGHTS` and failing `Board3D.test.tsx` on the way. `sceneLayout.ts`'s
 * `MAX_LIGHTS` comment has the choice, the two flatter options it was made
 * against, and what it costs a crate's vertical edges.
 */
export type SceneLightKind = 'hemisphere'

export interface SceneLight {
  readonly id: string
  readonly kind: SceneLightKind
  readonly position: Vec3
  readonly intensity: number
  readonly color: string
  readonly groundColor?: string
}

/** The three things E opens (24 §5.3). */
export type InteractTargetId = 'order-desk' | 'ledger-wall' | 'team-board'

export interface InteractTarget {
  readonly id: InteractTargetId
  readonly position: Vec3
  /** `INTERACT_DISTANCE`, carried on the target so the controller compares
   *  against the model rather than reaching for a constant of its own. */
  readonly radius: number
  readonly prompt: string
  /** False while paused: the prompt still reads, E is inert (24 §5.2). */
  readonly enabled: boolean
}

/** What the clipboard on the desk is doing (24 §4.3). */
export type ClipboardState = 'open' | 'closed' | 'absent'

/** The order desk's state, which is the game's state as the desk shows it. */
export interface DeskState {
  readonly prompt: string
  readonly enabled: boolean
  /** The `SUBMITTED` stamp, in `--color-success`. */
  readonly stamped: boolean
  readonly clipboard: ClipboardState
  readonly verb: string
}

/**
 * The server's figures, kept beside the model so `describeScene` can name them
 * without re-deriving anything from a mesh count (24 §4.1).
 */
export interface SceneFigures {
  readonly inventory: number
  readonly backlog: number
  readonly supplyLine: number
  /** How many receiving lanes the model actually carries placards for. */
  readonly lanesShown: number
  readonly supplyLineProminent: boolean
}

/** Everything `WarehouseScene` draws, and nothing it works out for itself. */
export interface SceneModel {
  readonly role: Role
  readonly roleSet: RoleSet
  /**
   * The sky over the open hall — `scenePalette.ts`'s `skyCyan`, and no fog
   * (24 §3.1, amended 2026-09-22).
   *
   * It was `--color-surface-sunken`, matching a sealed room's walls, with a
   * `<fog>` in the same hex so the far end softened into the hall rather than
   * into a seam. The hall has no ceiling any more.
   */
  readonly background: string
  readonly lights: readonly SceneLight[]
  readonly fixtures: readonly SceneFixture[]
  /** Every pool in the scene, gathered from the fixtures that own them. */
  readonly pools: readonly InstancePool[]
  /** Every GLB placement, likewise gathered. Trucks are capped at two by the
   *  draw-call budget of 24 §7.1. */
  readonly models: readonly ModelPlacement[]
  /** Every sign, gathered, so a test can scan the whole scene's copy. */
  readonly signs: readonly SceneSign[]
  readonly interactTargets: readonly InteractTarget[]
  readonly desk: DeskState
  /** `gameOver` shuts the dispatch door — one mesh translated to `y = 0`. */
  readonly dispatchDoorClosed: boolean
  /** True for the 400 ms after a week turned over (24 §5.5). */
  readonly weekChanged: boolean
  readonly figures: SceneFigures
}

/* ─── Small builders ─── */

/** A point offset from a zone centre. Zones are centres, not corners. */
function at(base: Vec3, dx: number, dy: number, dz: number): Vec3 {
  return [base[0] + dx, base[1] + dy, base[2] + dz]
}

function sign(
  id: string,
  text: string,
  position: Vec3,
  size: number = SIGN_SIZE.statement,
  color: string = TEXT_HEX.ink,
  rotationY = 0,
  maxWidth: number = SIGN_MAX_WIDTH,
  // The one override of the fixture-kind rule below, and it takes an argument
  // rather than a kind because it is about *where a fixture stands*, not what
  // it is: the Factory's blank-wall notice is a placard like any other, 60 cm
  // from the north wall, and a 6 m plate that billboarded there would swing
  // straight through it.
  billboard = true,
): SceneSign {
  const [plateWidth, plateHeight] = signPlateSize(text, size, maxWidth)
  return {
    id,
    text,
    position,
    size,
    color,
    rotationY,
    maxWidth,
    plateWidth,
    plateHeight,
    billboard,
  }
}

/* ─── Columns (24 §6.1, amended 2026-09-22) ─── */

/**
 * Put `below` directly under `above`, plates clear by `SIGN_STACK_GAP`.
 *
 * The one piece of arithmetic behind every column in the hall. It is
 * arithmetic and not a table of hand-picked heights because the plate's height
 * depends on the *words* — a settlement that wraps onto an extra line is a
 * taller plate — and a hand-picked gap that holds for one week's copy is a
 * collision in another. The overlap sweep of 2026-09-22 found eleven pairs of
 * signs stacked at gaps chosen before the plates existed; this is what
 * replaced them.
 */
function below(above: SceneSign, item: SceneSign): SceneSign {
  const y =
    above.position[1] - above.plateHeight / 2 - SIGN_STACK_GAP - item.plateHeight / 2
  return { ...item, position: [item.position[0], y, item.position[2]] }
}

/**
 * Lay a column out downward from a top edge. `signs` is in reading order, top
 * first, and `topY` is where the first plate's **top** sits.
 *
 * For the columns whose top matters more than any one row in them — the team
 * board's plaques inside their frame, the chain table's four rows above their
 * plinth.
 */
function stackDown(topY: number, signs: readonly SceneSign[]): SceneSign[] {
  const out: SceneSign[] = []
  for (const item of signs) {
    const previous = out[out.length - 1]
    if (previous === undefined) {
      const y = topY - item.plateHeight / 2
      out.push({ ...item, position: [item.position[0], y, item.position[2]] })
    } else {
      out.push(below(previous, item))
    }
  }
  return out
}

/**
 * Lay a column out around one row that must not move. `signs` is in reading
 * order, top first; `anchor` is the index of the row that keeps the height it
 * was built at.
 *
 * Which row is anchored is a decision about meaning, not about layout: the
 * stock-floor figure belongs at `SIGN_HEIGHT.pile`, clear of a full stack of
 * crates, and the label above it and the empty-state caption below it are what
 * move to make room. Anchoring the *top* of such a column instead would let a
 * longer label push the figure down into the pile it labels.
 */
function stackAround(anchor: number, signs: readonly SceneSign[]): SceneSign[] {
  const out: SceneSign[] = signs.map((item) => item)
  for (let index = anchor - 1; index >= 0; index -= 1) {
    const under = out[index + 1]
    const item = out[index]
    const y = under.position[1] + under.plateHeight / 2 + SIGN_STACK_GAP + item.plateHeight / 2
    out[index] = { ...item, position: [item.position[0], y, item.position[2]] }
  }
  for (let index = anchor + 1; index < out.length; index += 1) {
    out[index] = below(out[index - 1], out[index])
  }
  return out
}

/** One row of a stacked block of text, before the block is folded into as few
 *  meshes as its colours allow. */
interface SignRow {
  /** The id the row would have carried on its own. The fold gives it to the
   *  mesh the row *starts*, so a block that stays one colour keeps the id the
   *  first of its rows always had. */
  readonly id: string
  readonly text: string
  readonly position: Vec3
  readonly size: number
  readonly color: string
}

/** The component-wise mean of a run of points: where a folded block's single
 *  mesh stands so that it covers the span its separate rows covered. */
function midpoint(rows: readonly SignRow[]): Vec3 {
  let x = 0
  let y = 0
  let z = 0
  for (const row of rows) {
    x += row.position[0]
    y += row.position[1]
    z += row.position[2]
  }
  return [x / rows.length, y / rows.length, z / rows.length]
}

/**
 * Fold a stacked block of rows into as few signs as its typography allows
 * (24 §7.1).
 *
 * **A drei `<Text>` is one draw call whatever it says**, and troika renders
 * multi-line content in that one mesh. A ledger wall of nine rows built as
 * nine `<Text>`s therefore spends nine of the ninety §7.1 allows the whole
 * hall on one board — which is how a budget that reads *"signs ~16"* came to
 * be carrying thirty and more. Rows that share a size and a colour are one
 * mesh with newlines between them; `SceneSign`'s line pitch is what spaces
 * them, in place of the per-row `y` this used to step by hand.
 *
 * **The words a player reads do not change.** The fold is a change of mesh
 * count, never of copy: the rows are joined in order, verbatim, and a row
 * whose colour flips on a condition — the team board's own-seat plaque, the
 * chain table's own row — breaks the run and keeps its own mesh, because that
 * colour is the signal (`19 §3.4`). A run is broken by a change of size for
 * the same reason: the ledger's heading is a heading.
 */
function foldRows(
  rows: readonly SignRow[],
  rotationY = 0,
  maxWidth: number = SIGN_MAX_WIDTH,
  billboard = true,
): SceneSign[] {
  const signs: SceneSign[] = []
  let start = 0
  while (start < rows.length) {
    let end = start + 1
    while (
      end < rows.length &&
      rows[end].color === rows[start].color &&
      rows[end].size === rows[start].size
    ) {
      end += 1
    }
    const run = rows.slice(start, end)
    signs.push(
      sign(
        run[0].id,
        run.map((row) => row.text).join('\n'),
        midpoint(run),
        run[0].size,
        run[0].color,
        rotationY,
        maxWidth,
        billboard,
      ),
    )
    start = end
  }
  return signs
}

/**
 * When the slot at `index` lands, in words, upper-cased for a warehouse sign.
 *
 * 24 §4.2 says the lane placards reuse `SupplyLine.tsx`'s own wording, and
 * these are those words: *next week*, *the week after*, *in N weeks*. Never a
 * computed week number — the only place `week + lead` appears is inside
 * `DecisionForm`, which already computes it (24 §4.2, `19 §3.1`).
 */
function whenLabel(index: number): string {
  if (index === 0) return 'NEXT WEEK'
  if (index === 1) return 'THE WEEK AFTER'
  return `IN ${index + 1} WEEKS`
}

/* ─── The prompts of 24 §5.2 ─── */

/** The prompts that do not vary with the game's state. 24 §5.2 fixes only the
 *  desk's; the other two targets say what they open, in the same shape. */
const LEDGER_PROMPT = "Press E — read this week's settlement"
const TEAM_BOARD_PROMPT = 'Press E — see who has decided'

/** The paused prompt reads the server's words, and E is inert (24 §4.3). */
function pausedPrompt(pausedReason: string | null): string {
  return pausedReason === null ? 'Paused.' : `Paused. ${pausedReason}`
}

/**
 * The desk prompt, as a pure function of the props (24 §5.2).
 *
 * The order of the branches is the precedence the props carry, not the order
 * of the table: `paused` outranks everything because E is inert while paused,
 * then `gameOver`, then the three order states. The Factory wording is not
 * decoration — it is `19` AC 11, and `DecisionForm.tsx` already branches
 * exactly this way.
 */
export function deskPrompt(props: BoardViewProps): string {
  if (props.paused) return pausedPrompt(props.pausedReason)
  if (props.gameOver) return 'Press E — the game is over'
  if (props.isChangingOrder) return 'Press E — change your order'
  if (props.locked) {
    return props.canChangeOrder
      ? "Press E — your order is in. See who's left."
      : 'Press E — your last order stands'
  }
  return `Press E — ${ROLE_SETS[props.view.role].deskVerb}`
}

/** The prompt for whichever of the three targets the player is standing at. */
export function interactPrompt(target: InteractTargetId, props: BoardViewProps): string {
  if (props.paused) return pausedPrompt(props.pausedReason)
  if (target === 'order-desk') return deskPrompt(props)
  return target === 'ledger-wall' ? LEDGER_PROMPT : TEAM_BOARD_PROMPT
}

/* ─── Lights (24 §7.1) ─── */

/**
 * **One light**, and it is a hemisphere (24 §7.1, amended 2026-09-22).
 *
 * There were four — a hemisphere, a directional key and two point lights over
 * the desk and the receiving bay — until a player walked the hall and asked
 * for the lighting to be removed and replaced with lighting that is uniform
 * across the whole board. The two point lights were what they were looking
 * at: inverse-square falloff is a hotspot under the light and a dark corner
 * away from it, which is the definition of non-uniform.
 *
 * A hemisphere light has no position and no falloff, so a crate in the far
 * corner of a 60 × 42 hall is lit exactly as the crate at the player's feet —
 * uniform by construction — while still separating an up-face from a side
 * face, so a crate still reads as a cube rather than as a flat silhouette.
 * `sceneLayout.ts`'s `MAX_LIGHTS` carries the full reasoning, the two flatter
 * options it was chosen against, and what it costs.
 *
 * Sky over ground, and the room is still lit bone rather than white:
 * `--color-surface-raised` above, `--color-surface-sunken` below, so the warm
 * floor stays warm and the hall does not take the cyan of its own sky.
 */
const SCENE_LIGHTS: readonly SceneLight[] = [
  {
    id: 'sky',
    kind: 'hemisphere',
    // Positionless: three.js shades a hemisphere light from its two colours
    // and the surface normal alone, so this changes nothing and is carried
    // only because `SceneLight` has the field.
    position: LIGHT_POSITIONS.sky,
    intensity: SKY_LIGHT_INTENSITY,
    color: ARCHITECTURE_HEX.surfaceRaised,
    groundColor: ARCHITECTURE_HEX.surfaceSunken,
  },
]

/* ─── Placement constants shared by the builders below ─── */

/**
 * The `y`-rotation of anything flat against the **east** wall, facing back
 * into the hall.
 *
 * The ledger wall's `Math.PI / 2` mirrored. `FixtureMesh.tsx`'s `WallBoard`
 * pushes a board back along `(sin θ, 0, cos θ)`, so at `−π / 2` the panel
 * moves to `+x` — into the wall, behind its own text — and the text faces
 * `−x`, which is where the player is standing.
 */
const EAST_WALL_FACING = -Math.PI / 2

/** How far north of the team board the leaderboard stands, on the same wall.
 *  A board is 6.2 m wide; eight leaves a frame's worth of wall between them. */
const LEADERBOARD_OFFSET = 8

/** How far east of the dispatch bay's centre the demand ticker stands, clear
 *  of the demand placard that shares the bay with it. */
const DEMAND_TICKER_OFFSET = 6

/**
 * Where a wall board's first plate hangs, in world metres off the floor.
 *
 * `FIXTURE_SIZE.board` is 5.4 m tall and sits 0.2 m off the floor, so the
 * panel runs 0.2 to 5.6; `4.4` starts the rows inside their own frame with
 * room for a four-row plaque block under them.
 */
const TEAM_BOARD_TOP = 4.4

/** The same, for the neighbour hatch, which is 3.4 m tall (`FIXTURE_SIZE`). */
const HATCH_SIGN_TOP = 3.3

/** The same, for the chain table — a 0.9 m plinth with its rows above it. */
const CHAIN_TABLE_TOP = 3.2

/** The south face's own wall plane: the shopfront glass, the roller doors,
 *  the cross-dock kerbs and the dispatch door all sit just inside `z = +20`,
 *  a metre short of the south wall at `HALL.halfDepth`. */
const SOUTH_FACE_Z = 20

/* ─── The fixture builders, one per row of 24 §4.2 ─── */

/**
 * The receiving bay: four painted lanes, the two totals over them, and — only
 * when the host left the supply line prominent — the lane crates and their
 * placards.
 *
 * The totals used to hang from a gantry, a beam on two posts across the bay,
 * and the beam is gone with the other two overhead structures (amended
 * 2026-09-22). **The signs are not**: `gantry-total` is `view.supply_line`,
 * which §4.2 requires and 24 §1.1 calls the whole bet of this board, and
 * `gantry-receipt` is the role's own word for what lands here. They keep
 * their ids — a test asserts against them — and now stand free over the bay
 * at `BAY_SIGN_HEIGHT`, which clears the tallest lane stack by more than a
 * metre.
 *
 * `show_supply_line_prominently === false` means the lane crates and placards
 * are **absent from the model**, not hidden. The host made the game harder on
 * purpose (`19 §2.2`) and helpfully compensating defeats that (AC 10, FM 3).
 * The total still renders, over bare paint.
 */
function buildReceivingBay(view: PlayerView, roleSet: RoleSet): SceneFixture[] {
  const base = ZONES.receivingBay
  const prominent = view.show_supply_line_prominently
  const slots = view.supply_line_slots
  const lanesShown = prominent ? Math.min(slots.length, MAX_SUPPLY_LANES) : 0

  // Label over figure, the figure anchored at the height §3.2 gives it and the
  // label pushed up by however tall its own plate turns out to be. The two
  // were 0.7 m apart, which is less than the height of either plate: the sweep
  // of 2026-09-22 measured 82 cm of the receipt sitting on the total.
  const signs: SceneSign[] = stackAround(1, [
    // What lands in this bay, in the role's own words. For the FACTORY that is
    // "FINISHED PRODUCTION" and the bay is a production line (24 §3.7).
    sign(
      'gantry-receipt',
      roleSet.receiptSign.toUpperCase(),
      at(base, 0, 0, 0),
      SIGN_SIZE.label,
      TEXT_HEX.inkMuted,
      0,
      SIGN_WIDE_MAX_WIDTH,
    ),
    // The server's total, never a sum of the lanes beside it. Wrapped at the
    // open-floor width: the bay is twenty-four metres across and the board
    // wrap would have folded one statement onto two lines.
    sign(
      'gantry-total',
      `TOTAL ON THE WAY TO YOU: ${view.supply_line} UNITS`,
      at(base, 0, BAY_SIGN_HEIGHT, 0),
      SIGN_SIZE.statement,
      TEXT_HEX.ink,
      0,
      SIGN_WIDE_MAX_WIDTH,
    ),
  ])

  if (prominent && slots.length === 0) {
    signs.push(
      sign(
        'gantry-empty',
        'Nothing is on its way to you.',
        at(base, 0, SIGN_HEIGHT.placard, 0.8),
        SIGN_SIZE.caption,
        TEXT_HEX.inkMuted,
        0,
        SIGN_WIDE_MAX_WIDTH,
      ),
    )
  }

  const stacks: PileStack[] = []
  for (let index = 0; index < lanesShown; index += 1) {
    stacks.push({
      position: [spreadX(index, lanesShown, LANE_SPAN.from, LANE_SPAN.to), 0, base[2]],
      count: crateCount(slots[index], PILE_SCALE.supplyLane.divisor, PILE_SCALE.supplyLane.cap),
      // The front lane is nearest the player and largest: the beer arriving
      // next week is what a player most often fails to count (24 §4.2).
      scale: index === 0 ? FRONT_LANE_SCALE : 1,
    })
  }

  const bay: SceneFixture = {
    id: 'receiving-bay',
    kind: 'bay-paint',
    position: base,
    rotationY: 0,
    accent: roleSet.accent,
    signs,
    models: [],
    pool:
      stacks.length > 0
        ? {
            id: 'supply-lanes',
            asset: 'box',
            color: QUANTITY_HEX.supplyLine,
            gridWidth: PILE_GRID.supplyLane.width,
            gridDepth: PILE_GRID.supplyLane.depth,
            stacks,
          }
        : undefined,
  }

  const fixtures: SceneFixture[] = [bay]

  // One placard fixture per rendered lane, each id'd so a test can assert the
  // whole set is gone when the host turned the breakdown off.
  const laneIds: FixtureId[] = [
    'supply-lane-0',
    'supply-lane-1',
    'supply-lane-2',
    'supply-lane-3',
  ]
  // **The post stands in front of the lane, not in it.** The placard fixture
  // used to sit at the lane's own centre while its sign floated 1.4 m south of
  // it: `PlacardPosts` then drew the post inside the crate stack — one of the
  // intersections a player reported as clipping — and left the words hanging
  // off nothing. Fixture and sign now share one floor position, clear of a
  // capped stack's 1.83 m half-depth.
  for (let index = 0; index < lanesShown; index += 1) {
    const stand: Vec3 = [spreadX(index, lanesShown, LANE_SPAN.from, LANE_SPAN.to), 0, base[2] + PLACARD_STAND_OFF]
    fixtures.push({
      id: laneIds[index],
      kind: 'placard',
      position: stand,
      rotationY: 0,
      signs: [
        sign(
          `supply-lane-${index}-placard`,
          `${slots[index]} UNITS ARRIVING ${whenLabel(index)}`,
          at(stand, 0, SIGN_HEIGHT.placard, 0),
          SIGN_SIZE.lane,
          TEXT_HEX.ink,
          0,
          // Four of these on a 6 m pitch. At the default wrap their plates
          // were 6.14 m wide and overlapped by 14 cm, the length of the bay.
          SIGN_LANE_MAX_WIDTH,
        ),
      ],
      models: [],
    })
  }

  // A fifth slot and beyond folds into one placard rather than a fifth lane:
  // the bay is four lanes wide and the server's total already covers the rest.
  if (prominent && slots.length > MAX_SUPPLY_LANES) {
    const more = slots.length - MAX_SUPPLY_LANES
    fixtures.push({
      id: 'supply-lane-overflow',
      kind: 'placard',
      // Fifteen metres east of the bay's centre, not thirteen: the fourth
      // lane's placard stands at `SUPPLY_LANE_X[3]` and the two plates met at
      // the old offset.
      position: at(base, 15, 0, PLACARD_STAND_OFF),
      rotationY: 0,
      signs: [
        sign(
          'supply-lane-overflow-placard',
          `+${more} MORE LANES`,
          at(base, 15, SIGN_HEIGHT.placard, PLACARD_STAND_OFF),
          SIGN_SIZE.label,
          TEXT_HEX.inkMuted,
          0,
          SIGN_LANE_MAX_WIDTH,
        ),
      ],
      models: [],
    })
  }

  return fixtures
}

/**
 * The north end: a road in from a supplier, or the brewhouse of a seat that
 * has none.
 *
 * For the FACTORY the **entire** upstream gate, road, courier truck, road
 * markers and their signs are absent, replaced by four tanks and a wall that
 * says why (`19` AC 7, FM 13). The absence is made explicit rather than
 * silent: a player who cannot find the order road should be told there is not
 * one, not left hunting for a door that was never built (24 §3.7).
 */
function buildNorthEnd(view: PlayerView, roleSet: RoleSet): SceneFixture[] {
  if (!roleSet.hasOrderRoad) {
    return [
      {
        id: 'brewhouse',
        kind: 'brewhouse',
        position: ZONES.brewhouse,
        rotationY: 0,
        accent: roleSet.accent,
        signs: [],
        models: [],
      },
      {
        id: 'brewhouse-wall-sign',
        kind: 'placard',
        position: ZONES.blankWall,
        rotationY: 0,
        // Two lines of one statement, in one mesh: the wall says the same
        // words it always said (24 §7.1, §3.7).
        signs: foldRows(
          [
            {
              id: 'brewhouse-wall-line-1',
              text: 'YOU BREW YOUR OWN SUPPLY —',
              position: at(ZONES.blankWall, 0, 3.2, 0),
              size: SIGN_SIZE.statement,
              color: TEXT_HEX.ink,
            },
            {
              id: 'brewhouse-wall-line-2',
              text: 'NOBODY IS UPSTREAM OF YOU',
              position: at(ZONES.blankWall, 0, 2.6, 0),
              size: SIGN_SIZE.statement,
              color: TEXT_HEX.ink,
            },
          ],
          0,
          SIGN_MAX_WIDTH,
          // **The one sign in the hall that does not turn to face the
          // player.** `ZONES.blankWall` stands 60 cm off the north wall, and
          // a 6 m plate billboarding there would swing half its width into
          // the masonry from most of the room. It is a notice painted on that
          // wall, facing into the hall, which is what it always was; the
          // player reads it from the only side there is.
          false,
        ),
        models: [],
      },
    ]
  }

  const gate = ZONES.upstreamGate
  // **The collision the player walked into.** `ORDERS TO THE WHOLESALER` sat
  // 0.6 m under `TOTAL STILL TRAVELLING UPSTREAM`, which is less than half the
  // height of either plate; the sweep measured 1.29 m of them inside each
  // other. Label above figure, caption below it, every gap computed from the
  // plates rather than guessed — and the whole column wrapped at the gate's
  // own width, because it stands 4 m from the west wall and billboards.
  const gateColumn: SceneSign[] = [
    // Which way the orders go, in the role's own chain vocabulary.
    sign(
      'upstream-destination',
      `ORDERS TO ${(roleSet.upstreamName ?? '').toUpperCase()}`,
      at(gate, 0, 0, 0),
      SIGN_SIZE.label,
      TEXT_HEX.inkMuted,
      0,
      SIGN_GATE_MAX_WIDTH,
    ),
    // The server's total, and the 2D wording of `SupplyLine`'s orders pipeline.
    sign(
      'upstream-total',
      `TOTAL STILL TRAVELLING UPSTREAM: ${view.orders_in_flight} UNITS`,
      at(gate, 0, 3.4, 0),
      SIGN_SIZE.statement,
      TEXT_HEX.ink,
      0,
      SIGN_GATE_MAX_WIDTH,
    ),
  ]

  if (view.orders_in_flight === 0) {
    gateColumn.push(
      sign(
        'upstream-empty',
        'No orders of yours are still travelling upstream.',
        at(gate, 0, 0, 0),
        SIGN_SIZE.caption,
        TEXT_HEX.inkMuted,
        0,
        SIGN_GATE_MAX_WIDTH,
      ),
    )
  }

  const gateSigns = stackAround(1, gateColumn)

  const fixtures: SceneFixture[] = [
    {
      id: 'upstream-gate',
      // No painted threshold under the courier any more: the accent quad read
      // as a blue rug the truck was parked on. `placard` draws no mesh of its
      // own, so the gate is now just its signs and the truck (2026-09-22).
      kind: 'placard',
      position: gate,
      rotationY: 0,
      accent: roleSet.accent,
      signs: gateSigns,
      models: [],
    },
  ]

  // The road markers: one group per slot, at most three, in `--color-order`.
  const slots = view.orders_in_flight_slots
  const groups = Math.min(slots.length, MAX_ORDER_SLOTS)
  const stacks: PileStack[] = []
  for (let index = 0; index < groups; index += 1) {
    stacks.push({
      position: [spreadX(index, groups, ORDER_MARKER_SPAN.from, ORDER_MARKER_SPAN.to), 0, ORDER_ROAD_Z],
      count: crateCount(slots[index], PILE_SCALE.orderMarker.divisor, PILE_SCALE.orderMarker.cap),
    })
  }

  fixtures.push({
    id: 'order-road',
    kind: 'road',
    // The painted road, from the west wall to just short of the receiving
    // bay's own paint: two accent quads at `PAINT_Y` that overlapped would
    // z-fight, and a metre of bare floor between them is the seam.
    position: [-21.5, 0, ORDER_ROAD_Z],
    rotationY: 0,
    accent: roleSet.accent,
    signs: [],
    models: [],
    pool:
      stacks.length > 0
        ? {
            id: 'order-markers',
            asset: 'box',
            color: QUANTITY_HEX.order,
            gridWidth: PILE_GRID.orderMarker.width,
            gridDepth: PILE_GRID.orderMarker.depth,
            stacks,
          }
        : undefined,
  })

  // Post and sign on the same spot, south of the marker group rather than
  // inside it — the same clipping the lane placards had.
  for (let index = 0; index < groups; index += 1) {
    const id = (`order-marker-${index}` as FixtureId)
    const stand: Vec3 = [spreadX(index, groups, ORDER_MARKER_SPAN.from, ORDER_MARKER_SPAN.to), 0, ORDER_ROAD_Z + PLACARD_STAND_OFF]
    fixtures.push({
      id,
      kind: 'placard',
      position: stand,
      rotationY: 0,
      signs: [
        sign(
          `${id}-placard`,
          `${slots[index]} REACHING YOUR SUPPLIER ${whenLabel(index)}`,
          at(stand, 0, SIGN_HEIGHT.placard, 0),
          SIGN_SIZE.caption,
          TEXT_HEX.ink,
          0,
          // Three of these on a 3.5 m pitch — the tightest row of signs in the
          // hall, and the one the sweep found overlapping by 2.5 m.
          SIGN_MARKER_MAX_WIDTH,
        ),
      ],
      models: [],
    })
  }

  // A truck on the road only when something is actually on it. `0` means an
  // empty road, which is the point: the road is a picture of the pipeline.
  if (view.orders_in_flight > 0) {
    fixtures.push({
      id: 'order-courier',
      kind: 'vehicle',
      position: TRUCK_POSITIONS.upstream,
      rotationY: TRUCK_ROTATION.onTheRoad,
      signs: [],
      models: [
        {
          id: 'order-courier-truck',
          asset: 'truck',
          position: TRUCK_POSITIONS.upstream,
          rotationY: TRUCK_ROTATION.onTheRoad,
        },
      ],
    })
  }

  return fixtures
}

/** The stock floor: `inventory` crates, and the sign that carries the figure
 *  whether or not the pile was capped. */
function buildStockFloor(view: PlayerView): SceneFixture[] {
  const base = ZONES.stockFloor
  const empty = view.inventory === 0

  const floor: SceneFixture = {
    id: 'stock-floor',
    kind: 'pile-floor',
    position: base,
    rotationY: 0,
    signs: [
      sign(
        'stock-floor-sign',
        // The server's figure, uncapped, always. `inventory: 81` reads 81
        // beside forty crates (AC 7, FM 1).
        empty ? 'ON HAND 0 — nothing in stock' : `ON HAND ${view.inventory}`,
        at(base, 0, SIGN_HEIGHT.pile, 0),
        SIGN_SIZE.statement,
        TEXT_HEX.ink,
        0,
        SIGN_WIDE_MAX_WIDTH,
      ),
    ],
    models: [],
    pool: empty
      ? undefined
      : {
          id: 'inventory',
          asset: 'box',
          color: QUANTITY_HEX.inventory,
          gridWidth: PILE_GRID.inventory.width,
          gridDepth: PILE_GRID.inventory.depth,
          stacks: [
            {
              position: base,
              count: crateCount(
                view.inventory,
                PILE_SCALE.inventory.divisor,
                PILE_SCALE.inventory.cap,
              ),
            },
          ],
        },
  }

  if (!empty) return [floor]

  // An empty floor is not nothing: the pallet outline says "this is where your
  // stock goes, and there is none", which a bare patch of floor does not.
  return [
    floor,
    {
      id: 'stock-floor-empty',
      kind: 'pile-floor',
      position: base,
      rotationY: 0,
      accent: ARCHITECTURE_HEX.border,
      signs: [],
      models: [],
    },
  ]
}

/**
 * The backlog pen: always present, empty or not.
 *
 * Colour is never the only signal (`19 §3.4`, AC 8), so the pen carries the
 * fence, the warning glyph the 2D `BacklogIcon` draws, and the word OWED at
 * `0.42` units — three signals for one quantity.
 */
function buildBacklogPen(view: PlayerView): SceneFixture {
  const base = ZONES.backlogPen
  const owed = view.backlog

  // The figure is the row that must not move — `SIGN_HEIGHT.pile` is what
  // clears a full stack of crates — so the word above it and the empty-state
  // copy below it are stacked around it. At the old fixed ±0.6 the word's
  // plate cut 23 cm into the figure's.
  const column: SceneSign[] = [
    sign(
      'backlog-word',
      'OWED',
      at(base, 0, 0, 0),
      SIGN_SIZE.label,
      TEXT_HEX.ink,
      0,
      SIGN_WIDE_MAX_WIDTH,
    ),
    sign(
      'backlog-figure',
      `OWED ${owed}`,
      at(base, 0, SIGN_HEIGHT.pile, 0),
      SIGN_SIZE.statement,
      TEXT_HEX.ink,
      0,
      SIGN_WIDE_MAX_WIDTH,
    ),
  ]

  if (owed === 0) {
    column.push(
      sign(
        'backlog-empty',
        // The 2D teaching copy, verbatim from `DecisionPanel`.
        'Nothing owed. Everything your customer has asked for has gone out.',
        at(base, 0, 0, 0),
        SIGN_SIZE.caption,
        TEXT_HEX.inkMuted,
        0,
        SIGN_WIDE_MAX_WIDTH,
      ),
    )
  }

  const signs = stackAround(1, column)

  return {
    id: 'backlog-pen',
    kind: 'pen',
    position: base,
    rotationY: 0,
    glyph: 'warning',
    signs,
    models: [],
    pool:
      owed === 0
        ? undefined
        : {
            id: 'backlog',
            asset: 'box',
            color: QUANTITY_HEX.backlog,
            gridWidth: PILE_GRID.backlog.width,
            gridDepth: PILE_GRID.backlog.depth,
            stacks: [
              {
                position: base,
                count: crateCount(owed, PILE_SCALE.backlog.divisor, PILE_SCALE.backlog.cap),
              },
            ],
          },
  }
}

/**
 * The production queue: the only fixture in the game that exists for exactly
 * one role.
 *
 * FACTORY only, and only when `production_queue > 0` — mirroring 2D's
 * `!== null && > 0` (AC 12). `null` or `0` and the whole fixture is absent:
 * no pen, no sign, nothing about a queue that is not there.
 */
function buildProductionQueue(view: PlayerView, roleSet: RoleSet): SceneFixture[] {
  const queued = view.production_queue
  if (!roleSet.hasProductionBay || queued === null || queued <= 0) return []

  const base = ZONES.productionQueue
  return [
    {
      id: 'production-queue',
      kind: 'pen',
      position: base,
      rotationY: 0,
      glyph: 'warning',
      signs: [
        sign(
          'production-queue-sign',
          `WAITING TO BE PRODUCED: ${queued}`,
          at(base, 0, SIGN_HEIGHT.pile, 0),
          SIGN_SIZE.statement,
          TEXT_HEX.ink,
          0,
          SIGN_WIDE_MAX_WIDTH,
        ),
      ],
      models: [],
      pool: {
        id: 'production-queue',
        asset: 'box',
        color: QUANTITY_HEX.warning,
        gridWidth: PILE_GRID.productionQueue.width,
        gridDepth: PILE_GRID.productionQueue.depth,
        stacks: [
          {
            position: base,
            count: crateCount(
              queued,
              PILE_SCALE.productionQueue.divisor,
              PILE_SCALE.productionQueue.cap,
            ),
          },
        ],
      },
    },
  ]
}

/** The order desk: the role sign, the canopy plates and the clipboard. */
function buildOrderDesk(props: BoardViewProps, roleSet: RoleSet, desk: DeskState): SceneFixture {
  const base = ZONES.orderDesk
  const view = props.view

  // **The canopy column**, stacked around `canopy-week` at `SIGN_HEIGHT.canopy`
  // so that the week a player reads stays where §3.2 puts it and the rest
  // moves. Four signs at fixed 0.6-0.7 m steps used to overlap in five pairs
  // at once: the role sign is a 1.1 m face and its plate is 1.65 m tall on its
  // own. All four wrap at the open-floor width — the desk stands in the middle
  // of the hall, and `WHOLESALER` at 1.1 m does not fit a board's 5.8 m.
  const signs: SceneSign[] = stackAround(2, [
    sign(
      'role-sign',
      roleSet.label,
      at(base, 0, 0, 0),
      SIGN_SIZE.roleSign,
      TEXT_HEX.ink,
      0,
      SIGN_WIDE_MAX_WIDTH,
    ),
    sign(
      'role-strapline',
      roleSet.strapline,
      at(base, 0, 0, 0),
      SIGN_SIZE.strapline,
      TEXT_HEX.inkMuted,
      0,
      SIGN_WIDE_MAX_WIDTH,
    ),
    sign(
      'canopy-week',
      `Week ${props.week} of ${props.durationWeeks}`,
      at(base, 0, SIGN_HEIGHT.canopy, 0),
      SIGN_SIZE.statement,
      TEXT_HEX.ink,
      0,
      SIGN_WIDE_MAX_WIDTH,
    ),
    sign(
      'canopy-lead',
      // The role's verb, and never the arrival week: `week + lead` appears only
      // inside `DecisionForm`, which already computes it (24 §4.2).
      roleSet.hasProductionBay
        ? `ANYTHING YOU START NOW FINISHES IN ${view.order_arrival_lead_weeks} WEEKS`
        : `ANYTHING YOU ORDER NOW REACHES YOU IN ${view.order_arrival_lead_weeks} WEEKS`,
      at(base, 0, 0, 0),
      SIGN_SIZE.caption,
      TEXT_HEX.inkMuted,
      0,
      SIGN_WIDE_MAX_WIDTH,
    ),
  ])

  // **The desk's own two plates**, on the slab rather than under the canopy,
  // and stacked instead of side by side. The SUBMITTED stamp stood 0.9 m east
  // of `LAST ORDER n` at the same height; their plates are 2.5 m and 3.5 m
  // across, so the stamp was printed through the figure it confirms. It sits
  // above the clipboard line now, which is where a stamp goes on a docket.
  const plate: SceneSign[] = []

  if (desk.stamped) {
    plate.push(
      sign(
        'desk-stamp',
        'SUBMITTED',
        at(base, 0, 0, 0.6),
        SIGN_SIZE.label,
        ARCHITECTURE_HEX.success,
        0,
        SIGN_WIDE_MAX_WIDTH,
      ),
    )
  }

  if (props.gameOver) {
    // The clipboard is gone; the desk says so in its own words (24 §4.3).
    plate.push(
      sign(
        'desk-over',
        'THE GAME IS OVER',
        at(base, 0, 2.5, 0.6),
        SIGN_SIZE.statement,
        TEXT_HEX.ink,
        0,
        SIGN_WIDE_MAX_WIDTH,
      ),
    )
  } else {
    plate.push(
      sign(
        'desk-clipboard',
        view.last_order === null ? 'NO ORDER PLACED YET' : `LAST ORDER ${view.last_order}`,
        at(base, 0, 2.5, 0.6),
        SIGN_SIZE.label,
        TEXT_HEX.ink,
        0,
        SIGN_WIDE_MAX_WIDTH,
      ),
    )
  }

  // The docket line is the anchor: it is the one the player leans over.
  signs.push(...stackAround(plate.length - 1, plate))

  return {
    id: 'order-desk',
    kind: 'desk',
    position: base,
    rotationY: 0,
    accent: roleSet.accent,
    signs,
    models: [],
  }
}

/**
 * The ledger wall: the same rows, in the same order, in the same words as
 * `SettlementRecap`.
 *
 * Money goes through that file's `formatMoney`, and the rate lines are text
 * beside the server's money figure — the multiplication is never performed
 * here (`19` FM 4, AC 6). The display pair `opening_inventory + arrived` is
 * computed once, exactly as 2D computes it, and is the only arithmetic in this
 * function.
 */
function buildLedgerWall(view: PlayerView, weekChanged: boolean): SceneFixture {
  const base = ZONES.ledgerBoard
  const settlement = view.settlement
  const money = (value: number): string => formatMoney(view.currency_symbol, value)
  const lines: string[] = []

  if (!settlement) {
    lines.push('Nothing has settled yet')
  } else {
    const afterArrival = settlement.opening_inventory + settlement.arrived
    lines.push(`Week ${settlement.week} settlement`)
    lines.push(
      `${RECEIPT_LABEL[settlement.role]} +${settlement.arrived} — inventory ${
        settlement.opening_inventory
      } → ${afterArrival}`,
    )
    lines.push(
      settlement.opening_backlog > 0
        ? `${DEMAND_SOURCE_LABEL[settlement.role]} ordered ${settlement.incoming_order} — plus ${
            settlement.opening_backlog
          } owed from before, ${settlement.obligation} to ship in all`
        : `${DEMAND_SOURCE_LABEL[settlement.role]} ordered ${settlement.incoming_order}`,
    )
    lines.push(
      `You shipped ${settlement.shipped} — inventory ${afterArrival} → ${settlement.closing_inventory}`,
    )
    lines.push(
      `Unfulfilled ${settlement.unfulfilled} — backlog ${
        settlement.unfulfilled === 0 ? 'stays' : 'now'
      } ${settlement.closing_backlog}`,
    )
    lines.push(
      `Holding cost ${settlement.closing_inventory} units × ${money(
        view.holding_cost_per_unit_week,
      )} ${money(settlement.holding_cost)}`,
    )
    lines.push(
      `Backlog cost ${settlement.closing_backlog} units × ${money(
        view.backlog_cost_per_unit_week,
      )} ${money(settlement.backlog_cost)}`,
    )
    lines.push(`Week cost ${money(settlement.carrying_cost)}`)

    // The one line `show_running_cost_to_players` gates. With the flag off the
    // server sends neither field and the row is absent entirely.
    if (view.balance !== undefined) {
      lines.push(`Balance ${money(view.balance)}`)
    } else if (view.accumulated_cost !== undefined) {
      lines.push(`Total so far ${money(view.accumulated_cost)}`)
    }
  }

  return {
    id: 'ledger-wall',
    kind: 'wall-board',
    position: base,
    rotationY: Math.PI / 2,
    // The frame swaps to `--color-order` for the 400 ms of a week change
    // (24 §5.5) — a colour on the frame, which is architecture, never a crate.
    accent: weekChanged ? QUANTITY_HEX.order : ARCHITECTURE_HEX.borderStrong,
    // One heading mesh and one mesh for the rows under it, not one per row:
    // the rows below the heading share a size and a colour, so they are a
    // single `<Text>` with newlines (24 §7.1).
    // The heading is the anchor at 5.0, near the top of the 5.4 m board, and
    // the folded block of rows hangs under it. The rows were stepped by a
    // fixed 0.52 and the block's own plate is as tall as the copy makes it, so
    // the heading's plate stood 20 cm inside the block's; and at
    // `SIGN_SIZE.caption` the rows wrapped so hard that the block was taller
    // than the board behind it, which is why they are `SIGN_SIZE.row` now.
    signs: stackAround(
      0,
      foldRows(
        lines.map((text, index) => ({
          id: `ledger-row-${index}`,
          text,
          position: at(base, 0, 5, 0),
          size: index === 0 ? SIGN_SIZE.label : SIGN_SIZE.row,
          color: index === 0 ? TEXT_HEX.ink : TEXT_HEX.inkMuted,
        })),
        Math.PI / 2,
      ),
    ),
    models: [],
  }
}

/**
 * The cost corner: absent, entirely, when the host is not showing running cost.
 *
 * All three of `week_cost`, `balance` and `accumulated_cost` missing means no
 * plinth, no plate, no bills and nothing about running cost anywhere in the
 * scene (`19` AC 6). The precedence between `balance` and `accumulated_cost`
 * is `DecisionPanel`'s, unchanged.
 */
function buildCostCorner(view: PlayerView): SceneFixture[] {
  const present =
    view.week_cost !== undefined ||
    view.balance !== undefined ||
    view.accumulated_cost !== undefined
  if (!present) return []

  const base = ZONES.costCorner
  const money = (value: number): string => formatMoney(view.currency_symbol, value)
  const signs: SceneSign[] = []

  if (view.week_cost !== undefined) {
    signs.push(
      sign(
        'cost-week',
        `THIS WEEK ${money(view.week_cost)}`,
        at(base, 0, 2.6, 0),
        SIGN_SIZE.label,
        TEXT_HEX.ink,
        0,
        SIGN_WIDE_MAX_WIDTH,
      ),
    )
  }
  if (view.balance !== undefined) {
    signs.push(
      sign(
        'cost-balance',
        `BALANCE ${money(view.balance)}`,
        // The same height the week figure takes, so that the column reads the
        // same when the host shows a running total and no week cost: whichever
        // row is first is the one `stackAround` anchors.
        at(base, 0, 2.6, 0),
        SIGN_SIZE.label,
        TEXT_HEX.ink,
        0,
        SIGN_WIDE_MAX_WIDTH,
      ),
    )
  } else if (view.accumulated_cost !== undefined) {
    signs.push(
      sign(
        'cost-accumulated',
        `ACCUMULATED ${money(view.accumulated_cost)}`,
        at(base, 0, 2.6, 0),
        SIGN_SIZE.label,
        TEXT_HEX.ink,
        0,
        SIGN_WIDE_MAX_WIDTH,
      ),
    )
  }

  // Either plate is 63 cm tall and they were 50 cm apart. The week figure is
  // the anchor; the running total hangs under it, clear of it.
  const plates = stackAround(0, signs)
  signs.length = 0
  signs.push(...plates)

  // The bills stand for the figure beside them and are scaled like any other
  // pile: `÷10` currency units, capped at 20 (24 §4.2).
  const billed = view.balance ?? view.accumulated_cost ?? view.week_cost ?? 0
  return [
    {
      id: 'cost-corner',
      kind: 'placard',
      position: base,
      rotationY: 0,
      signs,
      models: [],
      pool: {
        id: 'money',
        asset: 'money',
        color: QUANTITY_HEX.money,
        gridWidth: PILE_GRID.money.width,
        gridDepth: PILE_GRID.money.depth,
        stacks: [
          {
            position: at(base, 0, 0, 0),
            count: crateCount(Math.abs(billed), PILE_SCALE.money.divisor, PILE_SCALE.money.cap),
          },
        ],
      },
    },
  ]
}

/**
 * The team board: four plaques in `ROLE_ORDER`, names only, never a quantity
 * (`19` AC 15). Plus the leaderboard beside it, when the host sends one.
 *
 * **Flat against the east wall** (amended 2026-09-22). It stood free in open
 * floor at `[15, 0, 9]` — a pane of nothing hanging in the middle of the
 * dispatch side — until a player asked for *"the still deciding / submitted
 * square"* to be against the wall *"just like the week settlement summary"*.
 * It is now the ledger wall's arrangement mirrored: the panel at `x = +29`
 * facing `−x`, and `ZONES.teamWall` three metres out as the stand-off, which
 * is what `INTERACT_ZONES` resolves `team-board` at. A target centred on a
 * panel flat against a wall is a target the player has to walk into the wall
 * to reach.
 *
 * The leaderboard used to hang on the **back** of the board, which on a wall
 * is inside the wall. It stands beside it instead, eight metres north, on the
 * same wall and facing the same way.
 */
function buildTeamBoard(view: PlayerView, awaitingRoles: Role[]): SceneFixture[] {
  const base = ZONES.teamBoard
  const waiting = new Set(awaitingRoles)

  // The four plaques are one mesh per *run of the same colour*, not one per
  // seat: a board where everyone is still deciding, or everyone has, is a
  // single `<Text>` of four lines, and a board part-way through the week
  // breaks only where the ink changes — which is the signal (24 §7.1,
  // `19 §3.4`).
  const plaques: SceneSign[] = foldRows(
    ROLE_ORDER.map((role) => ({
      id: `team-plaque-${role}`,
      text: waiting.has(role)
        ? `${ROLE_LABEL[role]} ⋯ still deciding`
        : `${ROLE_LABEL[role]} ✓ submitted`,
      position: at(base, 0, 0, 0),
      size: SIGN_SIZE.label,
      color: waiting.has(role) ? TEXT_HEX.inkMuted : TEXT_HEX.ink,
    })),
    EAST_WALL_FACING,
  )

  if (awaitingRoles.length === 0) {
    plaques.push(
      sign(
        'team-all-in',
        'EVERYONE HAS DECIDED. THE WEEK IS CLOSING.',
        at(base, 0, 0, 0),
        SIGN_SIZE.caption,
        TEXT_HEX.inkMuted,
        EAST_WALL_FACING,
      ),
    )
  }

  // Down from the top of the board rather than from a per-row step: the four
  // plaques fold into between one and four meshes depending on how many seats
  // have answered, so the column's shape changes every time somebody submits
  // and a fixed 0.55 m step cannot be right for all of them.
  const signs: SceneSign[] = stackDown(TEAM_BOARD_TOP, plaques)

  const fixtures: SceneFixture[] = [
    {
      id: 'team-board',
      kind: 'wall-board',
      position: base,
      rotationY: EAST_WALL_FACING,
      signs,
      models: [],
    },
  ]

  const leaderboard = view.leaderboard
  if (leaderboard) {
    fixtures.push({
      id: 'leaderboard-plaque',
      kind: 'wall-board',
      // Beside the team board on the same wall, not on its back: a board
      // pushed 0.4 m through a wall is a board nobody can read.
      position: at(base, 0, 0, -LEADERBOARD_OFFSET),
      rotationY: EAST_WALL_FACING,
      // Every entry is the same size in the same ink, so the whole table is
      // one mesh of N lines (24 §7.1).
      signs: stackDown(
        TEAM_BOARD_TOP,
        foldRows(
          leaderboard.map((entry) => ({
            id: `leaderboard-${entry.role}`,
            // The server's order, and the server's money figure.
            text: `${ROLE_LABEL[entry.role]}: ${formatMoney(
              view.currency_symbol,
              entry.accumulated_cost,
            )}`,
            position: at(base, 0, 0, -LEADERBOARD_OFFSET),
            size: SIGN_SIZE.label,
            color: TEXT_HEX.ink,
          })),
          EAST_WALL_FACING,
        ),
      ),
      models: [],
    })
  }

  return fixtures
}

/**
 * The south end: the dispatch bay, the demand placard, the role's own south
 * face, and whatever stands in front of it.
 *
 * This is the wall that identifies the seat from spawn (AC 8): glass and
 * people for the Retailer, three roller doors and a truck tail for the
 * Wholesaler, an open bay for the Distributor, one door and a yard for the
 * Factory.
 */
function buildSouthEnd(props: BoardViewProps, roleSet: RoleSet): SceneFixture[] {
  const view = props.view
  const bay = ZONES.dispatchBay
  const settlement = view.settlement

  // Where the demand placard stands: clear of the checkout counter for the
  // shop, and clear of the dock truck for everyone else.
  const demandStand: Vec3 =
    roleSet.south === 'shopfront'
      ? [0, 0, CHECKOUT_Z - PLACARD_STAND_OFF]
      : at(bay, 0, 0, -PLACARD_STAND_OFF)

  const fixtures: SceneFixture[] = [
    {
      id: 'dispatch-bay',
      kind: 'bay-paint',
      position: bay,
      rotationY: 0,
      accent: roleSet.accent,
      signs: [],
      models: [],
    },
    {
      // Who wants what, in the role's own chain vocabulary. Always rendered,
      // `0` included — an incoming order of zero is information.
      // **In front of the thing it labels, never inside it.** The Retailer's
      // copy stood at the checkout's own `z` — which is the middle of an
      // 11 m counter — and the other three stood at the dispatch bay's
      // centre, which is where the dock truck is parked. Both were posts
      // drawn inside solid geometry. It now stands a placard's stand-off
      // north of whichever it belongs to, on the player's side.
      id: 'demand-placard',
      kind: 'placard',
      position: demandStand,
      rotationY: Math.PI,
      signs: [
        sign(
          'demand-placard-sign',
          `${roleSet.demandSign} WANTS ${view.incoming_order}`,
          at(demandStand, 0, SIGN_HEIGHT.placard, 0),
          SIGN_SIZE.statement,
          TEXT_HEX.demand,
          Math.PI,
        ),
      ],
      models: [],
    },
    {
      id: 'south-face',
      kind: roleSet.south,
      position: [0, 0, SOUTH_FACE_Z],
      rotationY: Math.PI,
      accent: roleSet.accent,
      signs:
        roleSet.south === 'dock-doors'
          ? DOCK_DOOR_X.map((x, index) =>
              sign(
                `dock-door-${index}`,
                `DOOR ${index + 1}`,
                [x, 4, SOUTH_FACE_Z - 0.4],
                SIGN_SIZE.caption,
                TEXT_HEX.inkMuted,
                Math.PI,
              ),
            )
          : [],
      models: [],
    },
  ]

  // The end customer, and the only people in the game (24 §3.4).
  if (roleSet.customerFigures > 0) {
    fixtures.push({
      id: 'customer-figures',
      kind: 'figures',
      position: [0, 0, 18.5],
      rotationY: Math.PI,
      signs: [],
      models: CUSTOMER_FIGURE_POSITIONS.slice(0, roleSet.customerFigures).map(
        (position, index) => ({
          id: `customer-${index}`,
          asset: 'person' as SceneAsset,
          position,
          rotationY: Math.PI,
        }),
      ),
    })
  }

  // The south truck, where the role has one. Never more than one, so with the
  // upstream courier the hall holds at most two (24 §7.1).
  const truckId: FixtureId | null =
    roleSet.south === 'shopfront'
      ? 'rear-door-truck'
      : roleSet.south === 'dock-doors'
        ? 'dock-truck'
        : roleSet.south === 'dispatch-yard'
          ? 'dispatch-truck'
          : null

  if (truckId !== null) {
    const position = truckId === 'dock-truck' ? TRUCK_POSITIONS.dock : TRUCK_POSITIONS.rearDoor
    fixtures.push({
      id: truckId,
      kind: 'vehicle',
      position,
      rotationY: TRUCK_ROTATION.tailIn,
      signs: settlement
        ? [
            sign(
              'shipped-plate',
              `YOU SHIPPED ${settlement.shipped}`,
              // 2.4 m put its plate 3 cm inside the demand placard's, which
              // stands a metre north of it on the same centre line.
              [position[0], 2.9, position[2] - 2],
              SIGN_SIZE.label,
              TEXT_HEX.ink,
              0,
              SIGN_WIDE_MAX_WIDTH,
            ),
          ]
        : [],
      models: [
        {
          id: `${truckId}-model`,
          asset: 'truck',
          position,
          rotationY: TRUCK_ROTATION.tailIn,
        },
      ],
    })
  }

  // True customer demand, week by week, when the host shows it.
  if (view.customer_demand_series) {
    fixtures.push({
      id: 'demand-ticker',
      kind: 'placard',
      // Six metres east of the demand placard. For the RETAILER the two
      // landed on the same spot — the demand placard moves to `CHECKOUT_Z`
      // and the ticker sat one metre north of the bay, which is the same
      // metre — so two posts and two signs were drawn inside each other.
      position: at(bay, DEMAND_TICKER_OFFSET, 0, -1),
      rotationY: Math.PI,
      signs: stackAround(0, [
        sign(
          'demand-ticker-series',
          view.customer_demand_series.join(', '),
          at(bay, DEMAND_TICKER_OFFSET, 5, -1),
          SIGN_SIZE.label,
          TEXT_HEX.demand,
          Math.PI,
        ),
        sign(
          'demand-ticker-caption',
          'What the public actually bought, week by week, up to now.',
          at(bay, DEMAND_TICKER_OFFSET, 0, -1),
          SIGN_SIZE.caption,
          TEXT_HEX.inkMuted,
          Math.PI,
        ),
      ]),
      models: [],
    })
  }

  return fixtures
}

/**
 * The neighbour hatch and the chain table: two independent visibility gates,
 * each a fixture that is simply not built when its key is absent (AC 23).
 *
 * Both were checked over on 2026-09-22 against the complaint that made the
 * team board move, and neither is a floating pane: the hatch is recessed into
 * the east wall at `x = +29` (and `FixtureMesh.tsx` now lays it *on* that wall
 * rather than standing it off as a fin), and the chain table is a plinth —
 * a table standing on the floor, moved over to the east wall so it is a thing
 * in a place rather than an object in the middle of the room.
 */
function buildNeighbourFixtures(view: PlayerView, roleSet: RoleSet): SceneFixture[] {
  const fixtures: SceneFixture[] = []
  const neighbours = view.neighbours

  if (neighbours) {
    const present = ROLE_ORDER.filter((role) => neighbours[role] !== undefined)
    if (present.length > 0) {
      fixtures.push({
        id: 'neighbour-hatch',
        kind: 'hatch',
        position: ZONES.neighbourHatch,
        rotationY: -Math.PI / 2,
        // One mesh for the whole hatch: the plates differ in nothing but
        // their words (24 §7.1).
        signs: stackDown(
          HATCH_SIGN_TOP,
          foldRows(
            present.map((role) => {
              const entry = neighbours[role]
              return {
                id: `neighbour-${role}`,
                text: `${ROLE_LABEL[role]}: ${entry?.inventory ?? 0} ON HAND, ${
                  entry?.backlog ?? 0
                } OWED`,
                position: at(ZONES.neighbourHatch, 0, 0, 0),
                size: SIGN_SIZE.caption,
                color: TEXT_HEX.ink,
              }
            }),
            -Math.PI / 2,
          ),
        ),
        models: [],
      })
    }
  }

  const chain = view.chain
  if (chain) {
    fixtures.push({
      id: 'chain-table',
      kind: 'plinth',
      position: ZONES.chainTable,
      rotationY: 0,
      // The player's own plinth wears the accent; the other three do not. An
      // accent on architecture, as always.
      accent: roleSet.accent,
      // The player's own row is the one the ink picks out, so it is the one
      // that keeps its own mesh; the muted rows above and below it fold
      // (24 §7.1).
      // Down from a top that clears the plinth, for the same reason as the
      // team board: the player's own row breaks the fold wherever it sits, so
      // the column is one, two or three meshes depending on the seat.
      signs: stackDown(
        CHAIN_TABLE_TOP,
        foldRows(
          ROLE_ORDER.map((role) => ({
            id: `chain-${role}`,
            text: `${ROLE_LABEL[role]}: ${chain[role].inventory} ON HAND, ${chain[role].backlog} OWED`,
            position: at(ZONES.chainTable, 0, 0, 0),
            size: SIGN_SIZE.caption,
            color: role === view.role ? TEXT_HEX.ink : TEXT_HEX.inkMuted,
          })),
        ),
      ),
      models: [],
    })
  }

  return fixtures
}

/* ─── The model ─── */

/**
 * The fixture kinds whose signs are painted on a surface (24 §6.1, amended
 * 2026-09-22).
 *
 * A sign on one of these does **not** billboard. The rule lives on the kind
 * rather than on the call site so that it is one sentence in one place: a
 * fixture built later that is flat against something is spelled with one of
 * these kinds, and its lettering stays where it was put without anybody
 * remembering to say so. `SceneSign.billboard` has the reasoning.
 */
const WALL_MOUNTED_KINDS: ReadonlySet<FixtureKind> = new Set<FixtureKind>([
  'wall-board',
  'hatch',
  'dock-doors',
])


/**
 * Build the whole scene from the props the 2D board takes and nothing else.
 *
 * Pure, synchronous, and the single source of truth for what the canvas shows:
 * `WarehouseScene` walks this object and adds nothing to it (24 §8.1).
 */
export function buildSceneModel(props: BoardViewProps): SceneModel {
  const view = props.view
  const roleSet = ROLE_SETS[view.role]

  const desk: DeskState = {
    prompt: deskPrompt(props),
    // Paused freezes the desk but not the room: the prompt still reads and E
    // does nothing (24 §4.3, AC 18).
    enabled: !props.paused,
    stamped: props.locked && !props.isChangingOrder && !props.gameOver,
    clipboard: props.gameOver ? 'absent' : props.locked && !props.isChangingOrder ? 'closed' : 'open',
    verb: roleSet.deskVerb,
  }

  const built: SceneFixture[] = [
    ...buildReceivingBay(view, roleSet),
    ...buildNorthEnd(view, roleSet),
    ...buildStockFloor(view),
    buildBacklogPen(view),
    ...buildProductionQueue(view, roleSet),
    buildOrderDesk(props, roleSet, desk),
    buildLedgerWall(view, props.weekChanged),
    ...buildCostCorner(view),
    ...buildTeamBoard(view, props.awaitingRoles),
    ...buildSouthEnd(props, roleSet),
    ...buildNeighbourFixtures(view, roleSet),
  ]

  // One pass, and the only place `billboard` is decided (24 §6.1). A fixture
  // whose kind is flat against something keeps its lettering where it was
  // painted; everything else turns to face the player.
  const fixtures: SceneFixture[] = built.map((fixture) =>
    fixture.signs.length > 0 && WALL_MOUNTED_KINDS.has(fixture.kind)
      ? {
          ...fixture,
          signs: fixture.signs.map((item) => ({ ...item, billboard: false })),
        }
      : fixture,
  )

  // The flat lists are gathered from the fixtures rather than built beside
  // them: one construction site, so a fixture cannot be absent from the scene
  // while its crates are still drawn.
  const pools: InstancePool[] = []
  const models: ModelPlacement[] = []
  const signs: SceneSign[] = []
  for (const fixture of fixtures) {
    if (fixture.pool) pools.push(fixture.pool)
    for (const model of fixture.models) models.push(model)
    for (const item of fixture.signs) signs.push(item)
  }

  const interactTargets: InteractTarget[] = (
    ['order-desk', 'ledger-wall', 'team-board'] as InteractTargetId[]
  ).map((id) => ({
    id,
    position: INTERACT_ZONES[id],
    radius: INTERACT_DISTANCE,
    prompt: interactPrompt(id, props),
    enabled: !props.paused,
  }))

  return {
    role: view.role,
    roleSet,
    background: ARCHITECTURE_HEX.skyCyan,
    lights: SCENE_LIGHTS,
    fixtures,
    pools,
    models,
    signs,
    interactTargets,
    desk,
    dispatchDoorClosed: props.gameOver,
    weekChanged: props.weekChanged,
    figures: {
      inventory: view.inventory,
      backlog: view.backlog,
      supplyLine: view.supply_line,
      lanesShown: view.show_supply_line_prominently
        ? Math.min(view.supply_line_slots.length, MAX_SUPPLY_LANES)
        : 0,
      supplyLineProminent: view.show_supply_line_prominently,
    },
  }
}

/* ─── The draw-call budget (24 §7.1, AC 19) ─── */

/**
 * What one fixture costs the renderer in meshes, dressing only.
 *
 * `FIXTURE_DRAW_COST` has the per-kind figure; the two fixtures that carry a
 * conditional piece of themselves are topped up here, from the fixture, so
 * the count follows the same branches `FixtureMesh.tsx` follows rather than
 * assuming the expensive case everywhere.
 *
 * There used to be five. The desk's clipboard, the empty stock floor's pallet
 * ghost and the racking's shelves have stopped varying the count: a clipboard
 * is a choice between two merged surface geometries, a ghost is one merged
 * outline where the pad is one quad, and both racking bays' shelves are a
 * single mesh at any tier count.
 */
function dressingDrawCalls(fixture: SceneFixture): number {
  let total: number = FIXTURE_DRAW_COST[fixture.kind]

  // The pen's warning glyph, the one mark that says OWED without colour. It
  // cannot join the rails: it takes its hex from the pool inside the pen.
  if (fixture.kind === 'pen' && fixture.glyph !== undefined) total += 1

  return total
}

/**
 * A conservative estimate of the scene's steady-state draw calls (24 §7.1).
 *
 * This is to AC 19 what `MAX_LIGHTS` is to the light count: the number the
 * budget is *asserted* against, in `Board3D.test.tsx`, so that a board which
 * grows one more sign, one more placard or another truck fails a test rather
 * than a laptop. Before it existed the scene had drifted to three times
 * 24 §7.1's ~16 signs — every one of them doubled by an outline pass — and
 * nothing anywhere said so. It is asserted against `MAX_DRAW_CALLS` itself;
 * the ratchet that stood in for that ceiling while the architecture was drawn
 * unmerged is gone, and `sceneLayout.ts` records what closed the gap.
 *
 * What it counts, item for item against §7.1's own arithmetic:
 *
 *  - the shell — `SHELL_DRAW_COST`, three;
 *  - each fixture's dressing — `FIXTURE_DRAW_COST` plus its conditional
 *    pieces, counted out of the components that draw them;
 *  - the placard posts at **one** call for the whole hall, since they are one
 *    `InstancedMesh` (`PlacardPosts.tsx`), and none at all when the hall has
 *    no placards — `show_supply_line_prominently === false` strips them;
 *  - each instanced pool at **one** call however many crates it holds
 *    (24 §7.2), plus the painted contact quad under each stack that stands on
 *    bare floor rather than on paint (`FixtureMesh.tsx`'s `PoolContact`);
 *  - each placed GLB — `MODEL_DRAW_COST`, the truck at 2 after its colours are
 *    baked into vertices (§7.3) and a contact quad under both;
 *  - each sign at one call, because a drei `<Text>` is one draw call whatever
 *    it says — which is the whole reason the model folds a block of rows into
 *    one mesh instead of one per row;
 *  - and **one** call for every sign's backing plate together, since they are
 *    a single `InstancedMesh` (`SignPlates.tsx`). Thirty-odd plates drawn one
 *    at a time would be thirty-odd calls on an eleven-call headroom, so the
 *    pool is not an optimisation here — it is the difference between the
 *    plates existing and not.
 *
 * It is an estimate and it is deliberately the pessimistic one: nothing here
 * assumes frustum culling, which at a 72° fov in a 44 × 30 room holding most
 * of the hall in view is not a saving to spend in advance.
 */
export function estimateDrawCalls(model: SceneModel): number {
  let total = SHELL_DRAW_COST

  for (const fixture of model.fixtures) {
    total += dressingDrawCalls(fixture)
    const pool = fixture.pool
    if (pool === undefined) continue
    // One `InstancedMesh` per pool, whatever the pile's size (24 §7.2).
    total += 1
    // A pile on paint is grounded by the paint; only the floor-standing pools
    // pay for a contact quad, one per stack.
    if (fixture.kind === 'pile-floor' || fixture.kind === 'pen') total += pool.stacks.length
  }

  for (const placement of model.models) total += MODEL_DRAW_COST[placement.asset]

  // Every sign's backing plate, as one `InstancedMesh` for the whole hall
  // (`SignPlates.tsx`) — one call, not one per sign, which is the only reason
  // a white rectangle behind thirty-odd signs fits under `MAX_DRAW_CALLS`.
  if (model.signs.length > 0) total += SIGN_PLATE_DRAW_COST

  return total + model.signs.length
}

/**
 * The canvas wrapper's `aria-label` (24 §5.4).
 *
 * This is **not** the accessible fallback — that is `Board3DPanels`, which
 * mounts the real 2D components exactly once so a screen reader reaches every
 * figure. This sentence only says what the sighted player is looking at, and
 * it says it with the server's own figures: the crate counts are display
 * scaling and are never read back out as a quantity (24 §4.1).
 */
export function describeScene(model: SceneModel): string {
  const { inventory, backlog, supplyLine, lanesShown, supplyLineProminent } = model.figures

  const stock = `${inventory} crates on hand`
  const owed = backlog === 0 ? 'no backlog' : `${backlog} units owed`
  const incoming = !supplyLineProminent
    ? `${supplyLine} units on the way to you`
    : lanesShown === 0
      ? 'nothing on its way to you'
      : `${lanesShown} lane${lanesShown === 1 ? '' : 's'} of incoming shipments`

  return `A 3D warehouse for the ${model.roleSet.label}. ${stock}, ${owed}, ${incoming}.`
}
