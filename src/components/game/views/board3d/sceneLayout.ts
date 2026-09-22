/**
 * The hall, frozen: every coordinate, every clamp and every display-scaling
 * constant the 3D board is allowed to use (24 §3.1, §3.2, §4.2).
 *
 * There are **not** four scenes, there is one hall with four dressings
 * (24 §3.0), and this file is why: every number below is identical for all
 * four roles, so a player who sits in the Retailer's seat on Monday and the
 * Factory's on Tuesday does not re-learn the room, and the debrief compares
 * like with like. Only `roleSets.ts` varies per role, and it varies four
 * things and no more.
 *
 * Nothing here is a magic number in a component. `WarehouseScene.tsx` reads
 * the `SceneModel` that `sceneModel.ts` builds out of these constants, and
 * 24 §8.1 makes that boundary a hard rule: *a geometry decision made inside
 * the renderer rather than in the model is untestable, and is a defect.* A
 * coordinate typed into a `<mesh position>` is exactly that decision.
 *
 * World units are metres.
 */

/** A world-space point. Readonly because every constant here is shared. */
export type Vec3 = readonly [number, number, number]

/* ─── The shell (24 §3.1, amended 2026-09-22) ─── */

/**
 * The hall: a floor, four walls, and **open sky above them**.
 *
 * It was an enclosed room with a ceiling at `y = 7` until a player walked it
 * and said the ceiling did nothing but take the space away. It is now a yard
 * with walls: `60 × 42` of floor, walls `9` metres high, and nothing overhead
 * but `scenePalette.ts`'s `skyCyan`. There is still no drei `<Sky>` — 24 §7.4
 * keeps that line for a new reason, which is that a flat background colour is
 * uniform by construction and a procedural sky is not.
 *
 * `60 × 42` rather than the shipped `44 × 30` for the same reason: the seven
 * zones of §3.2 were 16 metres apart in a 44-metre hall and read as one
 * crowded room rather than as seven places.
 */
export const HALL = {
  /**
   * Floor plane, `30 × 42` at `y = 0`.
   *
   * The emptiness was on the **east–west** axis, not the north–south one.
   * `60 × 42` left the east wall's boards alone in open floor; shrinking
   * both axes to `46 × 32` then put the south wall in front of the customers
   * standing at `CUSTOMER_FIGURE_POSITIONS` (`z = 18.5`) and cut them out of
   * the hall entirely. The depth is back to what the customer bay, the
   * checkout and the dock truck were always positioned against; only the
   * width came in, so the east wall now stands a little past where the OWED
   * pen ends (2026-09-22).
   */
  width: 30,
  depth: 42,
  /** Walls at `x = ±15`, `z = ±21`. */
  halfWidth: 15,
  halfDepth: 21,
  /**
   * Wall top, and the height of the sky's lower edge.
   *
   * Nine metres, chosen against two numbers: the Distributor's three-tier
   * racking reaches `6.2` (`RACKING_HEIGHT`) and must stand clear of the top
   * of the wall rather than poke over it, and a wall much taller than that in
   * a hall this wide reads as the bottom of a well instead of a yard. There
   * is no ceiling, so this is the only thing setting how much sky a standing
   * player sees.
   */
  wallHeight: 10,
  /** Camera eye height, and the sanity check for every model target in §7.3. */
  eyeHeight: 1.7,
} as const

/** Player spawn `[0, 1.7, 12]`, facing `−z` — straight down the order axis,
 *  just south of the dispatch bay's paint and north of the south wall. */
export const SPAWN: Vec3 = [0, HALL.eyeHeight, 12]

/**
 * Movement clamps (24 §3.1). Tighter than the walls on purpose: a first-person
 * camera pressed flat against a wall renders the inside of it.
 *
 * The stand-off is the one the hall shipped with — 3 metres on `x`, 2.5 on
 * `z` — carried onto the larger footprint rather than rescaled with it. It
 * was never a proportion of the room; it is how close a 0.1 near-plane may
 * come to a wall.
 */
export const MOVEMENT_BOUNDS = {
  minX: -12,
  maxX: 12,
  minZ: -18.5,
  maxZ: 18.5,
} as const

/**
 * How close the player must stand to an interact target for its prompt to
 * appear (24 §5.2). There are no clickable meshes anywhere in this board:
 * proximity plus a keypress is one interaction model rather than two.
 */
export const INTERACT_DISTANCE = 3.6

/* ─── The crate, and everything measured off it (24 §4.2, §7.3) ─── */

/**
 * The normalised crate, on its longest axis.
 *
 * `gltfModels.ts` scales `box.glb` to this with the `Box3` block of 24 §7.3,
 * centred in `x`/`z` and grounded at `y = 0`. It is restated here rather than
 * imported because `gltfModels.ts` imports three.js and this module may not:
 * `sceneModel.ts` is loaded by a test file that never touches a renderer
 * (24 §8.2). `MODEL_TARGET_HEIGHT.box` is the other copy, and the two are one
 * number.
 */
export const CRATE_SIZE = 1.1

/**
 * The air between two crates, in **metres** rather than as a fraction.
 *
 * `CratePile.tsx` spaced its stacks at `size × 1.06`, which is 6.6 cm of gap
 * on the crate's long axis and less on its short ones, and every pad, pen and
 * sign height downstream was written against a different guess again —
 * `padSize` assumed `× 1.18`. A player reported the piles clipping, and the
 * arithmetic is why: a clearance that is a percentage of an axis is a
 * different clearance per axis, and a fixture sized from one of those guesses
 * does not contain a pile built from another.
 *
 * So the gap is one absolute figure, every pitch below is `CRATE_SIZE` plus
 * it, and every pad, pen and pile sign is measured from `CRATE_PITCH`.
 */
export const CRATE_CLEARANCE = 0.12

/** Centre-to-centre spacing of crates in a pile, on every axis: `1.22`. */
export const CRATE_PITCH = CRATE_SIZE + CRATE_CLEARANCE

/* ─── Fixed zones (24 §3.2, respaced 2026-09-22) ─── */

/**
 * Every zone centre in the hall. These are **centres**, not corners — the
 * piles, pens and boards built on them are centred on their own footprints.
 *
 * The **order and the axis are 24 §3.1's design and do not change**: orders
 * north, beer south, one line, with the order desk between the player and
 * everything upstream, so *you cannot walk to the receiving bay without
 * passing the desk.* What changed on 2026-09-22 is only the spacing — the
 * same seven places, further apart, in a hall with room for them.
 */
export const ZONES = {
  /** The four receiving lanes span `x ∈ [−9, +9]` at `z = −15`. */
  receivingBay: [0, 0, -15] as Vec3,
  /**
   * Where the order road leaves the hall, and where the courier stands on it.
   * Absent for the FACTORY (24 §3.7).
   *
   * It was an arch — two posts and a lintel "the courier drives under" —
   * until a player asked for the arches to go. What is left is the place and
   * the painted threshold on the road; the signs it carried are unchanged.
   */
  upstreamGate: [9, 0, -16.5] as Vec3,
  /** The FACTORY's brewhouse tank row, where the other three have a road. */
  brewhouse: [0, 0, -18] as Vec3,
  /** The FACTORY's blank north-west wall and its sign (24 §3.7). */
  blankWall: [9, 0, -20.4] as Vec3,
  stockFloor: [-8, 0, 0] as Vec3,
  backlogPen: [8, 0, 0] as Vec3,
  /** FACTORY only, and only when `production_queue > 0`. */
  productionQueue: [12, 0, -11] as Vec3,
  orderDesk: [0, 0, 5] as Vec3,
  /**
   * Where the player stands to read the ledger — a stand-off from the board
   * itself, which is flat against the west wall at `x = −29` (24 §3.2).
   */
  ledgerWall: [-11, 0, 6] as Vec3,
  ledgerBoard: [-14, 0, 6] as Vec3,
  /** Only when a cost field is present. Absent entirely otherwise (19 AC 6). */
  costCorner: [-11, 0, 13] as Vec3,
  /**
   * The team board, flat against the **east** wall, and the stand-off the
   * player reads it from — the ledger wall's arrangement, mirrored.
   *
   * It was a free-standing pane at `[15, 0, 9]` in open floor until a player
   * asked for it to be against the wall "just like the week settlement
   * summary". It stays in the southern half, on the dispatch side, so the
   * walk to it is still the walk away from the receiving bay.
   */
  teamWall: [11, 0, 6] as Vec3,
  teamBoard: [14, 0, 6] as Vec3,
  dispatchBay: [0, 0, 17] as Vec3,
  /** Only when `neighbours` is present; a solid east wall otherwise. */
  neighbourHatch: [14, 0, -7] as Vec3,
  /** Only when `chain` is present. A table standing against the east wall,
   *  not a pane floating in the middle of the floor. */
  chainTable: [11, 0, 1] as Vec3,
} as const

/** The three interact targets of 24 §3.2. Four would be more prompts than a
 *  first-time player can hold, which is why this list is closed.
 *
 *  Each resolves at the **stand-off**, never at the panel: a target centred
 *  on a board flat against a wall is a target the player cannot reach without
 *  walking into the wall. */
export const INTERACT_ZONES = {
  'order-desk': ZONES.orderDesk,
  'ledger-wall': ZONES.ledgerWall,
  'team-board': ZONES.teamWall,
} as const

/* ─── The receiving bay and the roads ─── */

/** Lane *i* sits at `x = −9 + 6i`, `z = −15` (24 §4.2). Six metres apart, for
 *  a three-wide stack that is 3.66 across and 4.21 in the front lane. */
/**
 * The two halves of the T's bar, and the rule that fills them.
 *
 * These were fixed tables — four lane positions and three marker positions,
 * indexed by slot. A week with two shipments therefore used the two leftmost
 * of four slots and left the rest of its half empty, which is the uneven
 * distribution a player sees: the arms bunch toward the outside and the
 * middle of each half is dead floor. The span is what is fixed now; the
 * positions inside it are dealt out evenly for however many arms that week
 * actually has (2026-09-22).
 */
export const LANE_SPAN = { from: -10.5, to: -4 } as const
export const ORDER_MARKER_SPAN = { from: 2.5, to: 7 } as const

/**
 * The `index`-th of `count` arms, spread evenly from `from` to `to`.
 *
 * One arm sits in the middle of its span rather than at its left edge: a lone
 * shipment is the whole of what is arriving, and hanging it off the west wall
 * reads as though three more were missing.
 */
export function spreadX(index: number, count: number, from: number, to: number): number {
  if (count <= 1) return (from + to) / 2
  return from + ((to - from) * index) / (count - 1)
}

/**
 * The four lane positions at full occupancy, derived from the same span.
 *
 * Only static, module-scope geometry uses this — the FACTORY's four brewhouse
 * tanks and their accent bands, which are built once and cannot be dealt out
 * per week. Everything that varies with the week's slot count calls
 * `spreadX` directly.
 */
export const SUPPLY_LANE_X: readonly number[] = [0, 1, 2, 3].map((index) =>
  spreadX(index, 4, LANE_SPAN.from, LANE_SPAN.to),
)

/** Lanes rendered is `min(slots.length, 4)`; a fifth and beyond fold into a
 *  `+{n} MORE LANES` placard rather than a fifth lane (24 §4.2). */
export const MAX_SUPPLY_LANES = 4

/**
 * The front lane is nearest the player and `1.15×` scale (24 §4.2). The beer
 * arriving next week is the thing 24 §1.1 wants largest in the field of view,
 * because underweighting the supply line is the game's commonest losing
 * mistake.
 */
export const FRONT_LANE_SCALE = 1.15

/**
 * How high the receiving bay's two totals hang over it.
 *
 * This was `GANTRY_HEIGHT`, the top of a beam on two posts. The beam is gone
 * with the rest of the overhead structures; the **signs it carried are not**,
 * because `TOTAL ON THE WAY TO YOU` is a `PlayerView` figure §4.2 requires
 * and the gantry was only ever what it hung from. Four-and-a-bit metres
 * clears the tallest lane stack — two tiers at `CRATE_PITCH`, scaled `1.15`
 * in the front lane, so `2.67` — by more than a metre.
 */
export const BAY_SIGN_HEIGHT = 4.2

/**
 * Where each order-road marker group stands, receding west from the bay along
 * `z = −16.5` (24 §4.2). At most three groups are shown; the road is a
 * painted quad, not `road.glb` (24 §6.1).
 *
 * The westmost group clears the courier truck standing on the gate threshold
 * at `x = −26`: the truck is 3.8 m broadside, so its nose is at `−24.1` and
 * a two-wide marker stack at `−22` reaches `−23.22`.
 */
export const ORDER_MARKER_X: readonly number[] = [3, 6.5, 10]

/** Slots shown on the order road, beyond which the road simply runs out. */
export const MAX_ORDER_SLOTS = 3

/**
 * The centre-line of the order road and everything standing on it: the marker
 * groups, the gate threshold and the courier.
 *
 * One constant rather than a `−16.5` repeated in four builders, and far
 * enough north of the receiving bay's own painted apron that the two accent
 * quads never share a plane — two painted floors at `PAINT_Y` that overlap
 * z-fight, which is a shimmer no amount of tuning the colours fixes.
 */
export const ORDER_ROAD_Z = -16.5

/**
 * How far in front of the thing it labels a placard stands, on `z`.
 *
 * A placard is a post with a sign on it (`PlacardPosts.tsx`), and the post
 * used to be placed at the crate pile's own centre while the sign floated
 * 1.4 m in front of it — so the post was drawn *inside* the stack and the
 * words hung off nothing. A player reported it as clipping. Post and sign now
 * share one floor position, and this is that offset: clear of the 1.83 m
 * half-depth of the deepest capped pile in the hall.
 */
export const PLACARD_STAND_OFF = 2.6

/* ─── Racking (24 §3.4–§3.7) ─── */

/** Shelf height by tier count: 1 tier reads as a shop, 3 stand clear of the
 *  wall top without reaching it. */
export const RACKING_HEIGHT: Record<1 | 2 | 3, number> = {
  1: 2.2,
  2: 4.2,
  3: 6.2,
}

/**
 * Where the racking bays stand, by tier count.
 *
 * Two tiers flank the stock floor and three tiers run wall to wall — both
 * given by 24 §3.5 and §3.6, respaced with the hall. One tier is not placed
 * by the spec; it reuses the two-tier positions so the Retailer's shop is the
 * same room at a lower shelf height, which is the whole point of §3.0.
 */
export const RACKING_BAYS: Record<1 | 2 | 3, readonly Vec3[]> = {
  1: [
    [-17, 0, -6],
    [-7, 0, -6],
  ],
  2: [
    [-17, 0, -6],
    [-7, 0, -6],
  ],
  3: [
    [-20, 0, -6],
    [20, 0, -6],
  ],
}

/* ─── The south face (24 §3.4–§3.7) ─── */

/** The Retailer's checkout counter, and the two customers standing at it. */
export const CHECKOUT_Z = 16.5
export const CUSTOMER_FIGURE_POSITIONS: readonly Vec3[] = [
  [-3, 0, 18.5],
  [3, 0, 18.5],
]

/** The Wholesaler's three roller doors (24 §3.5), across a 30 m wall. */
export const DOCK_DOOR_X: readonly number[] = [-8, 0, 8]

/** Where each south-end truck stands. Never more than two trucks in the hall
 *  at once — 24 §7.1's draw-call budget drops the truck count first. */
export const TRUCK_POSITIONS = {
  /** On the road at the gate threshold, when `orders_in_flight > 0`. */
  upstream: [9, 0, -16.5] as Vec3,
  /** Backed to the rear door (RETAILER) / the dispatch yard (FACTORY). */
  rearDoor: [9, 0, 17] as Vec3,
  /**
   * Reversed into DOOR 2, tail toward the player, so it reads as loading.
   *
   * `17.5`, not the wall: a 3.8 m truck tail-in at `z = 18` puts its nose
   * through the door leaf at `19.8`, which is one of the intersections a
   * player called clipping.
   */
  dock: [0, 0, 17.5] as Vec3,
} as const

/**
 * The dock truck faces tail-in at `y`-rotation π (24 §3.5); the upstream
 * courier sits broadside on the east–west road.
 */
export const TRUCK_ROTATION = {
  tailIn: Math.PI,
  onTheRoad: Math.PI / 2,
} as const

/* ─── Display scaling (24 §4.1, §4.2) ─── */

/**
 * Units of beer per crate mesh. A quantity may decide how many meshes are
 * drawn; it may never be re-derived from them (24 §4.1).
 */
export const UNITS_PER_CRATE = 2

/** Currency units per money bill in the cost corner. */
export const UNITS_PER_BILL = 10

/**
 * Every divisor and cap in 24 §4.2's table, in one place.
 *
 * The caps are draw-budget decisions, not display decisions: the sign beside
 * each pile always carries the server's true, uncapped figure, so a capped
 * pile understates nothing — the crates are a texture on the number, not a
 * substitute for it (24 §4.1, AC 7, FM 1).
 */
export const PILE_SCALE = {
  /** `inventory` → stock floor. */
  inventory: { divisor: UNITS_PER_CRATE, cap: 40 },
  /** `backlog` → backlog pen. */
  backlog: { divisor: UNITS_PER_CRATE, cap: 40 },
  /** One receiving lane, per slot. */
  supplyLane: { divisor: UNITS_PER_CRATE, cap: 12 },
  /** One order-road marker group, per slot. */
  orderMarker: { divisor: UNITS_PER_CRATE, cap: 10 },
  /** FACTORY only. */
  productionQueue: { divisor: UNITS_PER_CRATE, cap: 20 },
  /** Bills, not crates: `÷10` currency units. */
  money: { divisor: UNITS_PER_BILL, cap: 20 },
} as const

/**
 * The footprint each instanced pool stacks into: `gridWidth` across,
 * `gridDepth` back, then up a tier.
 *
 * **Wide and low, not narrow and tall** (amended 2026-09-22). The stock floor
 * was 24 §4.2's `5 × 2`, which turns a capped 40-crate pile into a four-tier
 * tower 4.76 m high — through the `ON HAND` sign at 3.2, which is the second
 * of the two intersections a player called clipping. Eight by three is
 * twenty-four crates a tier, so the same cap is two tiers and `2.32` m, and
 * the hall is now wide enough to lay them out. Every grid below is sized so
 * its cap fits in **two tiers**, except the order-road markers, which are
 * deliberately narrow because they stand on a 3.2 m road.
 */
export const PILE_GRID = {
  inventory: { width: 8, depth: 3 },
  backlog: { width: 8, depth: 3 },
  supplyLane: { width: 2, depth: 2 },
  orderMarker: { width: 2, depth: 2 },
  productionQueue: { width: 5, depth: 2 },
  money: { width: 4, depth: 2 },
} as const

/**
 * How tall a pile of `cap` crates stands in a `width × depth` grid, in metres.
 *
 * The arithmetic every pad, pen and pile sign is sized against, written once:
 * a full pile is `ceil(cap / (width × depth))` tiers, the top tier's floor is
 * one `CRATE_PITCH` below the next, and the crate itself is `CRATE_SIZE` tall
 * on top of that. `Board3D.test.tsx` asserts `SIGN_HEIGHT.pile` against it,
 * so a cap or a grid that grows a third tier is a red test rather than a sign
 * buried in a stack of boxes.
 */
export function pileStackTop(cap: number, grid: { width: number; depth: number }): number {
  const perTier = Math.max(1, grid.width * grid.depth)
  const tiers = Math.max(1, Math.ceil(cap / perTier))
  return (tiers - 1) * CRATE_PITCH + CRATE_SIZE
}

/**
 * The ceiling on instanced pools (24 §7.1). Six are budgeted — inventory,
 * backlog, supply lanes, order markers, production queue, money — and eight is
 * the hard stop. The four supply lanes share **one** pool with four offsets.
 */
export const MAX_INSTANCE_POOLS = 8

/* ─── Lighting (24 §7.1, §7.4, amended 2026-09-22) ─── */

/**
 * **One light, and it is positionless.**
 *
 * The hall shipped with four — a hemisphere, a directional key and two point
 * lights over the desk and the bay — and a player who walked it asked for the
 * lighting to be removed and replaced with lighting that is uniform across
 * the whole board. The two point lights are what they were objecting to: a
 * `pointLight` falls off with the square of the distance, so it is a hotspot
 * under itself and a dark corner everywhere else, which is precisely
 * non-uniform illumination.
 *
 * What replaces them is a single `hemisphereLight`, and the choice is
 * deliberate against two flatter options:
 *
 * - **`ambientLight` alone** is perfectly uniform and gives every face of a
 *   box *identical* illumination. The hall is largely boxes — crates, pens,
 *   racking, the desk — and a crate whose six faces are the same colour is a
 *   flat silhouette, not a cube. An inventory a player cannot count is not
 *   what "uniform" was asking for.
 * - **`meshBasicMaterial`, unlit**, is the same failure with no light at all.
 * - **A hemisphere light** has no position and no falloff, so it is identical
 *   at every point in the hall — a crate in the far corner is lit exactly as
 *   the crate at the player's feet — while still separating an up-face from a
 *   side-face and a side-face from the underside. Uniform coverage, and a
 *   cube still reads as a cube.
 *
 * What it costs, honestly: a hemisphere light varies with the surface normal's
 * `y` alone, so the **four vertical faces of a box are lit identically** and a
 * crate's vertical edges carry no shading. Three things already in the scene
 * keep the piles countable anyway — `CRATE_CLEARANCE` leaves 12 cm of dark
 * gap between crates, `CratePile.tsx` shades each instance a deterministic
 * ±6%, and every pile stands on a painted contact quad — and a vertical seam
 * was never what told the player how many boxes there were.
 *
 * `SceneLight.kind` is narrowed to `'hemisphere'` in `sceneModel.ts` so this
 * is a type rule and not a convention: a point light cannot be added back
 * without changing the model's types, and `MAX_LIGHTS` is the count.
 */
export const MAX_LIGHTS = 1

/**
 * A hemisphere light is positionless — three.js shades from its colours and
 * the surface normal, and never from where the light is — so this is carried
 * only because `SceneLight` has the field, and moving it changes nothing.
 * It is the wall top, where the sky begins.
 */
export const LIGHT_POSITIONS = {
  sky: [0, HALL.wallHeight, 0] as Vec3,
} as const

/**
 * The one light's intensity.
 *
 * Four lights summed to roughly this much on an up-facing surface — a 0.9
 * hemisphere, a 0.75 directional key and two point lights adding locally —
 * and one light has to carry all of it. Raised until the far corners read as
 * the same room as the desk, which is the whole point of the change.
 */
export const SKY_LIGHT_INTENSITY = 2.8

/* ─── The draw-call budget (24 §7.1, AC 19) ─── */

/**
 * The hard ceiling of 24 §7.1's budget table: **steady-state draw calls ≤ 90**,
 * against a target of 60, and the number AC 19 holds this board to.
 *
 * It is stated here because nothing in this board counted at all. `MAX_LIGHTS`
 * made Tequila's eighteen point lights a red test rather than a frame-rate
 * report nobody runs, and the same sentence applies word for word to draw
 * calls: a scene that grows one more sign, one more placard or one more truck
 * per release has no way of noticing until a laptop does.
 *
 * `estimateDrawCalls` in `sceneModel.ts` is what counts them, and
 * `Board3D.test.tsx` asserts that count against **this** number over all four
 * roles in three variants each. It did not always: the count stood at 132 in
 * its worst view and was held to a ratchet, because §7.1's arithmetic assumed
 * one draw call per fixture and `FixtureMesh.tsx` drew between one and ten. On
 * 2026-09-22 the static architecture was merged — see `mergeParts` in
 * `sceneMaterials.ts` — the truck's thirteen materials were baked into vertex
 * colours (`gltfModels.ts`), and the placard posts became one `InstancedMesh`.
 * That brought the worst view to 81; removing the three overhead structures
 * later the same day brought it to 79, and the headroom is what the signs are
 * about to spend.
 */
export const MAX_DRAW_CALLS = 90

/**
 * The ceiling on in-scene text meshes.
 *
 * 24 §7.1 budgets *"signs ~16 (one per drei `<Text>`)"*, and that is the
 * number to hold this board to; this constant is the **hard** stop above it,
 * in the same relation as 6 budgeted instance pools to `MAX_INSTANCE_POOLS`'s
 * 8. A drei `<Text>` is one draw call whatever it says, so the answer to a
 * block of rows is never N meshes — `sceneModel.ts`'s `foldRows` makes a run
 * of rows that share a size and a colour into one mesh with newlines, and the
 * words a player reads are unchanged by it.
 *
 * Signs are the largest single category in the budget — 38 of the worst
 * view's calls — so this is the number that moves next if it has to.
 */
export const MAX_SIGNS = 40

/**
 * What one fixture of each kind costs the renderer, in meshes.
 *
 * Every number here was counted out of the components that draw these kinds —
 * `FixtureMesh.tsx`'s `Dressing` switch, and `Racking.tsx`, `Brewhouse.tsx`
 * and `SouthFace.tsx` under it — and three.js issues one draw call per mesh
 * whatever geometry and material it shares with its neighbours. The table is
 * therefore the honest cost of a fixture, not 24 §7.1's per-fixture average,
 * and `estimateDrawCalls` is only as truthful as this table is: **a mesh
 * added to one of those components is a number to change here.**
 *
 * Most of these were four, six or ten until the static parts of each fixture
 * were merged into one geometry per material (`mergeParts`, `sceneMaterials.ts`).
 * What is left above one is what genuinely differs within a fixture: a second
 * material, a part that moves, or a part in another coordinate frame.
 *
 * One variable part remains, and it is not per-kind: the pen's warning glyph,
 * which takes its hex from the pool inside the pen, so it is counted from the
 * fixture itself in `estimateDrawCalls`. The receiving bay's gantry used to be
 * the other; it is gone.
 */
export const FIXTURE_DRAW_COST = {
  'bay-paint': 1,
  /** One painted threshold quad across the road where it leaves the hall.
   *  It was an arch — two posts and a lintel — until 2026-09-22. */
  'gate-threshold': 1,
  road: 1,
  /** Zero: every placard's post is an instance in `PlacardPosts`, counted
   *  once for the whole hall as `PLACARD_POST_DRAW_COST`. */
  placard: 0,
  /** The pad, or the four-edged empty-pallet ghost, merged either way. */
  'pile-floor': 1,
  /** Four rails, merged. The warning glyph is counted from the fixture. */
  pen: 1,
  /** Slab-and-clipboard, canopy, posts — three, whatever the game's state. */
  desk: 1,
  'wall-board': 2,
  plinth: 1,
  hatch: 1,
  /** Both bays' uprights merged, and all their shelves merged: two at any
   *  tier count (`Racking.tsx`). */
  racking: 2,
  /** Four tank bodies merged, four accent bands merged (24 §3.7). */
  brewhouse: 2,
  /** Glass, merged mullions, counter, counter top. */
  shopfront: 4,
  /** Three frames merged, three leaves merged — the leaves roll up as one. */
  'dock-doors': 2,
  /** The aisle markings — arrows and both edge stripes, merged — and the two
   *  low kerbs that flank the opening. The piers and the lintel above them
   *  were the third of the overhead structures removed on 2026-09-22. */
  'cross-dock': 2,
  'dispatch-yard': 2,
  /** A figure group and a vehicle *are* their models, which are counted with
   *  the rest of `SceneModel.models`. */
  figures: 0,
  vehicle: 0,
} as const

/**
 * Every placard post in the hall, as one `InstancedMesh` (`PlacardPosts.tsx`).
 *
 * Counted once for the scene and not once per placard: that is the whole point
 * of the pool, and a maximal view holds ten placards.
 */
export const PLACARD_POST_DRAW_COST = 1

/**
 * What one placed GLB costs, model plus the painted contact patch under it
 * (`PlacedModel.tsx`; shadows are off, so contact is a quad — 24 §7.4).
 *
 * The truck's 33 primitives across 13 materials are baked to **two** meshes at
 * load — one lit, one for the lamps that cannot give up their emission — so it
 * is 2 and not 33, and not the 13 a per-material merge left it at (24 §7.3,
 * `gltfModels.ts`). It was the largest single item in the budget; at two
 * trucks it is now six calls.
 *
 * `person.glb` is one mesh with one material and needs no bake.
 */
export const MODEL_DRAW_COST = {
  truck: 2 + 1,
  person: 1 + 1,
  /** Crates and bills are never placed singly; they are instanced pools. */
  box: 0,
  money: 0,
} as const

/**
 * The shell: the four walls as one merged geometry, the floor grid quad, and
 * the spine stripe and far-wall band merged into one accent mesh
 * (`SceneShell.tsx`).
 *
 * Still three with the ceiling gone. The room was the *inside* of one box,
 * which was one mesh for floor, walls and ceiling; it is now four inward-
 * facing wall planes merged into one mesh, with the floor's textured quad
 * carrying the floor by itself. A ceiling removed is not a draw call saved,
 * because it never had one of its own.
 */
export const SHELL_DRAW_COST = 3

/* ─── Signs (24 §3.8) ─── */

/**
 * Text heights, in world units. `label` is 24 §3.8's `0.42` for the word OWED
 * beside the backlog pen — the pen carries the fence, the warning glyph and
 * that word, because colour is never the only signal (19 §3.4, AC 8).
 */
export const SIGN_SIZE = {
  /** The role sign over the order desk. Readable from spawn. */
  roleSign: 1.1,
  strapline: 0.36,
  /** A figure a player reads: pile signs, gantry totals, plates. */
  statement: 0.5,
  label: 0.42,
  /** A lane placard. Smaller than `label` so it wraps to one or two rows
   *  rather than three, which is what made the lane plates so tall. */
  lane: 0.34,
  caption: 0.28,
  /**
   * A ledger-wall row, and the smallest text in the hall.
   *
   * It was `caption`. The backing plates made the cost of `0.28` visible: at
   * that size the wall's own 5.8 m wrap width takes 35 characters, and rows
   * like *"Distributor ordered 55 — plus 0 owed from before, 55 to ship in
   * all"* are twice that, so a nine-row settlement rendered as fourteen and
   * its plate stood taller than the 5.4 m board behind it. At `0.22` the wrap
   * takes 45 characters, most rows fit on one line, and the block sits inside
   * its own frame. It is still 22 cm of letter read from three metres, which
   * is several times the angular size of body text on a laptop.
   */
  row: 0.22,
} as const

/** How high a sign hangs on the thing it labels, by the thing it labels. */
export const SIGN_HEIGHT = {
  /**
   * Over a floor pile, clear of a full stack.
   *
   * `pileStackTop` is the number this has to beat: the tallest capped pile in
   * the hall is the front receiving lane at `2.32 × 1.15 = 2.67`, so `3.2`
   * stands half a metre clear of it. It did not, before the grids were
   * widened: a 40-crate stock floor reached `4.76` and swallowed its own sign.
   */
  pile: 3.2,
  /**
   * The desk's canopy row — `Week n of m` — and the anchor the whole desk
   * column is stacked around.
   *
   * `2.8` until 2026-09-22. The column above it (the role sign, the strapline)
   * and the column below it (the lead-time caption, then the clipboard plate
   * and the SUBMITTED stamp on the desk itself) have to clear each other now
   * that every sign carries a plate, and 2.8 left the caption's plate sitting
   * on the stamp's. Raising the anchor by 0.6 opens the whole column; the role
   * sign tops out at 6.2 m, well under the 9 m walls.
   */
  canopy: 4.3,
  /** On a wall board. */
  wall: 3,
  /** Over the receiving bay, where the gantry used to hang them. */
  bayTotal: BAY_SIGN_HEIGHT,
  /** A placard on a post. */
  placard: 1.6,
} as const

/**
 * The week-change lift of 24 §5.5: the front receiving lane rises this far and
 * drops back, inside the 400 ms `19 §3.2` caps deliberately — *"a class of
 * four is waiting."*
 */
export const WEEK_CHANGE_LIFT = 0.15

/* ─── Sign plates (24 §6.1, amended 2026-09-22) ─── */

/**
 * How wide a sign may run before troika wraps it, in world metres.
 *
 * It lived in `SceneSign.tsx` until the plates arrived. It cannot stay there:
 * the backing rectangle has to be the size of the *wrapped* block, so the
 * model that sizes the plate and the component that renders the words must
 * wrap at the same number or the plate is the wrong shape. The number itself
 * is unchanged and its reason is unchanged — the ledger wall's rows are the
 * longest copy in the hall and its board is 6.2 m across, so a sign that
 * wrapped wider than this would run off its own frame.
 */
export const SIGN_MAX_WIDTH = 5.8

/**
 * The pitch of a multi-line sign's rows, as a multiple of the font size.
 *
 * Also moved out of `SceneSign.tsx`, and for the same reason: it is half of
 * how tall a folded block is, so the plate cannot be measured without it.
 * Chosen to sit between the 1.3× of the team board's plaques and the 1.9× of
 * the ledger wall's rows, so a block folded by `foldRows` occupies about the
 * span its separate rows did.
 */
export const SIGN_LINE_HEIGHT = 1.5

/**
 * The average glyph advance of the default face, as a fraction of the em.
 *
 * **This is an estimate, and it is deliberately the generous one.** troika
 * knows the true extent of a block only after it has laid it out on a worker,
 * which is an asynchronous answer arriving one or more frames late; sizing the
 * plates from it would make the plate pool's matrices depend on when a font
 * finished parsing, and would put a geometry decision inside a component where
 * 24 §8.1 says no test can reach it. The plates are therefore measured in
 * `buildSceneModel`, from the string and the font size, by this constant.
 *
 * `0.58` is measured against drei's default Roboto at the mix this hall
 * actually carries — mostly upper-case statements, which run wider than the
 * face's `0.5` lower-case mean. A plate a little too wide is a wider white
 * margin; a plate too narrow is a word hanging off its own background, which
 * is the defect the plates exist to fix, so the error is spent on the safe
 * side. `Board3D.test.tsx` asserts the plate contains its own longest row.
 */
export const SIGN_GLYPH_ADVANCE = 0.58

/**
 * The quiet margin between a sign's longest row and the edge of its plate, as
 * a fraction of the font size.
 *
 * Proportional rather than absolute so a `0.22` ledger row and a `1.1` role
 * sign get margins that look alike: an absolute margin that frames the row
 * crowds the role sign, and one that frames the role sign swallows the row.
 *
 * A quarter of the font size, not a half. The plates are stacked into columns
 * that have to fit between a desk and a nine-metre wall, and a generous margin
 * is paid for twice — once above the words and once below them — on every sign
 * in the column. A quarter still reads as a frame around the words and leaves
 * the desk's four-sign column 1.4 m shorter than a half would.
 */
export const SIGN_PLATE_MARGIN = 0.25

/**
 * How far behind its words a plate sits, in world metres.
 *
 * Far enough that the two never z-fight, near enough that a player at an angle
 * to a sign never sees the gap. It is measured along the sign's own facing, so
 * for a wall board it is 2 cm *towards* the wall — and the panel's own face is
 * 8 cm behind the words (`FixtureMesh.tsx`'s `WallBoard` pushes the board back
 * by 0.22 and its `FIXTURE_SIZE.board.thickness` is 0.14), so the plate has
 * 6 cm of clearance and does not sink into the board it is read against.
 */
export const SIGN_PLATE_OFFSET = 0.02

/**
 * The wrap width for a sign standing in open floor, where no board frames it.
 *
 * `SIGN_MAX_WIDTH` is the *ledger board's* width, and applying it to the whole
 * hall is what wrapped `TOTAL ON THE WAY TO YOU: 103 UNITS` onto two lines
 * over a receiving bay twenty-four metres across. A free-standing sign has the
 * room, so it gets it, and one line of a statement reads as a statement where
 * two read as a paragraph. `9.5` and not more: the widest plate in the hall is
 * then 4.8 m from its own centre, and the signs that use it — the bay totals,
 * the desk column, the demand ticker — all stand at least 5 m from a wall,
 * which matters because a billboarded plate swings through every bearing.
 */
export const SIGN_WIDE_MAX_WIDTH = 9

/**
 * The wrap width for the four receiving-lane placards.
 *
 * `SUPPLY_LANE_X` puts them on a 6 m pitch, so a plate wider than about 5.5 m
 * touches its neighbour — and the overlap sweep of 2026-09-22 found exactly
 * that: four 6.14 m plates 6 m apart, a 14 cm collision repeated the length of
 * the bay. At `4.4` the placard wraps to two short lines and leaves 1.4 m of
 * bay paint between one lane's words and the next's.
 */
export const SIGN_LANE_MAX_WIDTH = 3

/**
 * How much clear air a billboarded sign keeps between its plate and a wall.
 *
 * A sign that turns to face the player sweeps a circle of its own plate
 * width, so "inside the hall" has to hold at every yaw rather than at the one
 * it happens to be built at. Without this the west lane's placard — 3.4 m of
 * plate centred at `SUPPLY_LANE_X[0] = -13`, against a wall at -15 — had its
 * first characters behind the wall, and `4 UNITS ARRIVING` read as
 * `NITS ARRIVING` (2026-09-22).
 */
export const SIGN_WALL_CLEARANCE = 0.7

/**
 * The wrap width for the order-road marker placards.
 *
 * `ORDER_MARKER_X` is a 3.5 m pitch — the markers are small groups on a road,
 * not lanes in a bay — so the plate has to be narrower again. `REACHING YOUR
 * SUPPLIER` is long copy in a small space; it wraps to three short lines and
 * still leaves half a metre between posts.
 */
export const SIGN_MARKER_MAX_WIDTH = 2.9

/**
 * The wrap width at the upstream gate.
 *
 * `ZONES.upstreamGate` stands 4 m from the west wall, and a billboarded plate
 * turns through every bearing, so its half-width is the clearance that matters
 * rather than its width. `7.2` puts the widest gate plate 3.7 m from its own
 * centre and keeps it out of the wall at every angle the player can walk to.
 */
export const SIGN_GATE_MAX_WIDTH = 7.2

/**
 * The clear air between two stacked plates, in world metres.
 *
 * Small and constant: the plates are what a player reads a column by, so the
 * gap wants to be visible as a seam and no larger — a column of four signs
 * pays it three times, and the desk's column has a nine-metre wall above it
 * and a clipboard below it. `sceneModel.ts`'s `stackDown`/`stackAround` are
 * the only things that use it, and between them they lay out every column in
 * the hall, which is why the sweep can now say there are no collisions rather
 * than that there are none *today*.
 */
export const SIGN_STACK_GAP = 0.12

/**
 * Every sign's backing plate, as **one** `InstancedMesh` (24 §7.1, AC 19).
 *
 * The same arithmetic that made the placard posts a pool, one order of
 * magnitude louder. A maximal view carries 33 signs; a plate apiece is 33 more
 * draw calls on a budget whose ceiling is 90 and whose worst view already
 * stands at 79. One pool is one call for the whole hall, whatever the seat and
 * whatever the week — which is what makes a white rectangle behind every sign
 * affordable at all.
 */
export const SIGN_PLATE_DRAW_COST = 1

/**
 * The world size of the plate behind one sign: `[width, height]`.
 *
 * Wrapping is modelled the way troika does it — a row longer than
 * `SIGN_MAX_WIDTH` becomes as many rows as it needs, and the block is as wide
 * as its widest row or the wrap width, whichever is smaller. The height is the
 * block's cap height plus the pitch of every row after the first, so a single
 * line is one font size tall rather than one line-height tall; a plate that
 * paid the 1.5× leading above and below a one-line sign would be half again
 * as tall as the word it backs.
 *
 * Exported from here, rather than computed in `SignPlates.tsx`, because both
 * the pool and `buildSceneModel` need the same answer and 24 §8.1 puts the
 * answer on the model.
 */
export function signPlateSize(
  text: string,
  size: number,
  maxWidth: number = SIGN_MAX_WIDTH,
): readonly [number, number] {
  const margin = size * SIGN_PLATE_MARGIN
  let widest = 0
  let rows = 0

  for (const row of text.split('\n')) {
    const run = row.length * SIGN_GLYPH_ADVANCE * size
    // A row twice the wrap width is two rows, and so on. An empty row is
    // still a row: troika keeps the blank line and so must the plate.
    rows += Math.max(1, Math.ceil(run / maxWidth))
    widest = Math.max(widest, Math.min(run, maxWidth))
  }

  return [
    widest + margin * 2,
    size + (rows - 1) * size * SIGN_LINE_HEIGHT + margin * 2,
  ] as const
}
