/**
 * The three heavy screens the shells and the host lobby delegate to, each
 * fetched on the first render that shows it.
 *
 * None of them is needed to render the welcome screen or a lobby, where every
 * session starts. `routes/registry.ts` leaves the two pages out of its eager
 * glob, which would otherwise put them in the entry chunk.
 *
 * The values are module constants: a `lazy()` created during render would
 * remount its screen on every render.
 */
import { lazy } from 'react'

/** The playing screen, which `GameRoom` shows once the game has started. */
export const PlayingScreen = lazy(() => import('./GameRoomPlaying'))

/** The host console, which `HostRoom` shows once the game has started. */
export const ConsoleScreen = lazy(() => import('./HostConsole'))

/** The configuration panel, in the host lobby's settings slot. */
export const ConfigPanelScreen = lazy(() => import('../components/config/ConfigPanel'))
