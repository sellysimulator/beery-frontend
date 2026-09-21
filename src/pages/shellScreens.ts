/**
 * The seam that lets `GameRoom.tsx` and `HostRoom.tsx` be built and shipped
 * before the screens they delegate to exist (**D19**).
 *
 * A static `import GameRoomPlaying from './GameRoomPlaying'` fails `tsc -b`
 * while section 19 is unwritten, which is the same defect that made section
 * 16's literal route table unbuildable. `import.meta.glob` resolves at build
 * time and yields an empty record for a file that is not there, so a missing
 * screen is a runtime `null` rather than a compile error, and the shell can
 * render a placeholder until the section lands.
 *
 * Nothing here is a fallback for a *broken* screen: once the module exists,
 * its component is used unconditionally.
 *
 * The glob is deliberately NOT `eager`. These three screens are the heavy end
 * of the app — the host console and the playing screen both draw Chart.js
 * canvases, and the configuration panel pulls in `react-hook-form` and `zod`,
 * which together are about a third of the JavaScript the browser has to parse.
 * None of it is needed to render the welcome screen or a lobby, which is where
 * every session starts, so each screen is fetched on the first render that
 * actually shows it. A non-eager glob hands back a loader per file rather than
 * a module, which is exactly what `React.lazy` wants; the "is the file there?"
 * question it was written to answer is still answered at build time, because
 * the loader is absent when the file is.
 */
import { lazy, type ComponentType } from 'react'
import ScreenUnavailable from '../components/lobby/ScreenUnavailable'

export type ShellScreen = ComponentType

type ScreenModule = Record<string, unknown>
type ScreenLoader = () => Promise<ScreenModule>

/** Section 19's `GameRoomPlaying` and section 20's `HostConsole`. */
const delegatedScreens = import.meta.glob<ScreenModule>([
  './GameRoomPlaying.tsx',
  './HostConsole.tsx',
])

/** Section 18's configuration panel, which the host lobby hosts a slot for. */
const configPanels = import.meta.glob<ScreenModule>(['../components/config/ConfigPanel.tsx'])

/**
 * The named export if the module has one, else its default. Anything that is
 * not callable is treated as absent, so a half-written module degrades to the
 * placeholder instead of crashing the shell.
 *
 * Exported in this injectable form for the same reason `collectRoutes` is
 * (`16 §3`): the three resolvers below read a glob that is expanded at
 * transform time, so once a screen's file exists they can never return `null`
 * again. An assertion about the absent case must be made against an explicit
 * loader record here, never against the live wiring, or it is true for exactly
 * one wave and false forever after.
 *
 * The absent cases are decided WITHOUT calling the loader — a missing key and
 * a key that is not a function are both "the section is unbuilt", and both are
 * knowable synchronously, so the shell still gets its `null` up front.
 *
 * Only the export SHAPE now has to wait for the module, so a module that
 * exists but carries no component resolves to `ScreenUnavailable` — the very
 * placeholder the shell would have rendered for a `null` — rather than
 * rejecting. The user-visible contract is therefore unchanged: a half-written
 * module degrades to the placeholder. What changed is when that is decided,
 * and rejecting instead would take the whole shell down through the nearest
 * error boundary.
 */
export function resolveShellScreen(
  loaders: Record<string, ScreenLoader | undefined>,
  path: string,
  name: string,
): ShellScreen | null {
  const load = loaders[path]
  if (typeof load !== 'function') return null

  return lazy(async () => {
    const found = await load()
    const candidate = found?.[name] ?? found?.default
    return {
      default: typeof candidate === 'function' ? (candidate as ShellScreen) : ScreenUnavailable,
    }
  })
}

/** Section 19's playing screen, or `null` while section 19 is unbuilt. */
export function playingScreen(): ShellScreen | null {
  return resolveShellScreen(delegatedScreens, './GameRoomPlaying.tsx', 'GameRoomPlaying')
}

/** Section 20's host console, or `null` while section 20 is unbuilt. */
export function hostConsoleScreen(): ShellScreen | null {
  return resolveShellScreen(delegatedScreens, './HostConsole.tsx', 'HostConsole')
}

/** Section 18's configuration panel, or `null` while section 18 is unbuilt. */
export function configPanelScreen(): ShellScreen | null {
  return resolveShellScreen(configPanels, '../components/config/ConfigPanel.tsx', 'ConfigPanel')
}
