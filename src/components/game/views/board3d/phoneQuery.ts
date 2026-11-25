/**
 * A phone held either way — too narrow upright, too short on its side — where
 * the 3D board has a HUD and panels of its own.
 *
 * `pointer`, not `any-pointer`, and here that is the point: both branches ask
 * for touch as the *main* input, so a desktop window matches at no size and a
 * laptop that merely has a touch screen keeps the desktop layout.
 *
 * In a module with no imports, because `BoardViewToggle` reads it and belongs
 * to neither board.
 */
export const PHONE_QUERY =
  '(pointer: coarse) and (max-width: 47.99rem), (pointer: coarse) and (max-height: 30rem)'

/**
 * Touch is the main input: a phone or a tablet. There is no E to press there,
 * so no prompt names it; a touch laptop has a keyboard and keeps the prompt.
 */
export const TOUCH_MAIN_QUERY = '(pointer: coarse)'
