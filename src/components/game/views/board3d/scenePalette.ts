/**
 * The scene's hexes, copied by hand from the `@theme` block in `src/index.css`.
 *
 * **`[HARD-WON]` CSS custom properties do not resolve inside a canvas.** A
 * `var(--color-inventory)` handed to a three.js material is not a colour; it is
 * a string three.js cannot parse, and the mesh renders black or white
 * depending on the material. `OwnHistoryChart.tsx` already documents exactly
 * this for Chart.js and hardcodes its three series colours for the same
 * reason. `scenePalette.ts` is 24 §3.8's equivalent for WebGL, with the same
 * discipline: **every value below names the `index.css` token it mirrors**, so
 * when the palette moves the two files can be diffed by eye rather than by
 * memory.
 *
 * ## The architecture/crates rule (24 §3.8)
 *
 * Two of these hexes collide with role accents. `--color-inventory` is the
 * *same* hex as `--color-role-retailer`, and `--color-backlog` `#a8420a` is one
 * digit off `--color-role-factory` `#a8480a`. Left unresolved, a Retailer would
 * stand in a room where the walls and the stock are the same blue, and a
 * Factory where the walls and the backlog are indistinguishable. The rule that
 * resolves it, and the reason this module is split into three groups rather
 * than one flat record:
 *
 * > **An accent hex is only ever applied to architecture** — floor stripe, wall
 * > band, desk canopy, sign frame. **A quantity hex is only ever applied to
 * > crates.** No crate is ever accent-coloured, and no wall is ever
 * > quantity-coloured.
 *
 * The split is structural so the rule is hard to break by accident: a fixture
 * reaches for `ARCHITECTURE_HEX`, a crate pool reaches for `QUANTITY_HEX`, and
 * a module that reaches into the wrong group is visible in the diff.
 *
 * And, per `19 §3.4` and `19` AC 8, **colour is never the only signal.** The
 * backlog pen additionally carries its fence, the warning glyph the 2D
 * `BacklogIcon` draws, and the word OWED in text.
 */

/** Walls, floors, bands, canopies, sign frames and lights. Never a crate. */
export const ARCHITECTURE_HEX = {
  /** `--color-role-retailer` — RETAILER accent. */
  roleRetailer: '#1f6f9c',
  /** `--color-role-retailer-soft` — RETAILER accent band and desk canopy. */
  roleRetailerSoft: '#d6ecf8',
  /** `--color-role-wholesaler` — WHOLESALER accent. */
  roleWholesaler: '#04705a',
  /** `--color-role-wholesaler-soft` — WHOLESALER accent band and desk canopy. */
  roleWholesalerSoft: '#d2ece5',
  /** `--color-role-distributor` — DISTRIBUTOR accent. */
  roleDistributor: '#9c4f78',
  /** `--color-role-distributor-soft` — DISTRIBUTOR accent band and desk canopy. */
  roleDistributorSoft: '#f6dfeb',
  /** `--color-role-factory` — FACTORY accent. Vermillion, not a second blue. */
  roleFactory: '#a8480a',
  /** `--color-role-factory-soft` — FACTORY accent band and desk canopy. */
  roleFactorySoft: '#fae0d2',
  /** `--color-surface-sunken` — the warm floor hue, and the ground half of
   *  the hall's one hemisphere light. */
  surfaceSunken: '#f2ede1',
  /**
   * The open sky over the hall (24 §3.1, amended 2026-09-22).
   *
   * **The one hex in this file with no `index.css` token behind it**, and the
   * exception is deliberate rather than an oversight: the 2D board has no sky,
   * so the theme has no token to mirror. It is named here, with this comment,
   * because 24 §6.2 forbids inventing a hex at the call site — a cyan typed
   * into `<color attach="background">` would be exactly that.
   *
   * A mid cyan, not a saturated one: the hall's walls are `--color-border`
   * bone and its ink is `--color-ink`, and a sky bright enough to blow them
   * out would cost the contrast a player has already asked for on the signs.
   */
  skyCyan: '#6ec6dd',
  /** `--color-surface-raised` — the light colour; the room is lit bone, not white. */
  surfaceRaised: '#fffdf8',
  /** `--color-border` — floor, walls, empty-pallet ghosts. */
  border: '#e2dac8',
  /** `--color-border-strong` — fences, racking uprights, door frames. */
  borderStrong: '#c9bda3',
  /** `--color-success` — the SUBMITTED stamp on the desk (24 §4.3). */
  success: '#04705a',
} as const

/** Crates, bills and the marks that stand for a quantity. Never a wall. */
export const QUANTITY_HEX = {
  /**
   * Stock-floor crates: a neutral stone grey, and the ONE entry in this file
   * that deliberately does **not** mirror its `index.css` token.
   *
   * `--color-inventory` is `#1f6f9c`, the same hex as `--color-role-retailer`.
   * The architecture/crates rule above was written to keep those apart, and on
   * paper it does — an accent only ever lands on a wall, a quantity only ever
   * on a crate. In the hall it does not: the player sees the accent band and
   * the stock floor in one glance and reads them as the same thing. Grey is
   * what a crate looks like anyway, it cannot collide with a role accent, and
   * the 2D board is untouched — `OwnHistoryChart.tsx` still draws its
   * inventory series in `#1f6f9c`, where nothing sits beside it to collide
   * with.  [HARD-WON — found by looking at the scene, not at the palette.]
   */
  inventory: '#8f8b84',
  /** `--color-backlog` — backlog-pen crates and the warning glyph beside them. */
  backlog: '#a8420a',
  /** `--color-supply-line` — receiving-lane crates. */
  supplyLine: '#8a6d00',
  /** `--color-order` — order-road markers, and the week-change flash on the ledger frame (24 §5.5). */
  order: '#c98a00',
  /** `--color-warning` — production-queue crates, FACTORY only. */
  warning: '#9a6800',
  /** `--color-brand` — money bills in the cost corner; the brand hue is the money hue in 2D too. */
  money: '#c98a00',
} as const

/** In-scene text. Two values, because a sign is either a statement or a label. */
export const TEXT_HEX = {
  /** `--color-ink` — every in-scene sign that carries a figure. */
  ink: '#23201a',
  /** `--color-ink-muted` — straplines, captions, empty-state copy. */
  inkMuted: '#5c5547',
  /** `--color-demand` — demand placards, which are neither architecture nor a pile. */
  demand: '#3f3a30',
} as const

/**
 * The three groups under one name, for the modules that legitimately need all
 * of them (`sceneModel.ts` builds fixtures, pools and signs in one pass).
 */
export const SCENE_PALETTE = {
  architecture: ARCHITECTURE_HEX,
  quantity: QUANTITY_HEX,
  text: TEXT_HEX,
} as const

export type ArchitectureHex = (typeof ARCHITECTURE_HEX)[keyof typeof ARCHITECTURE_HEX]
export type QuantityHex = (typeof QUANTITY_HEX)[keyof typeof QUANTITY_HEX]
export type TextHex = (typeof TEXT_HEX)[keyof typeof TEXT_HEX]
