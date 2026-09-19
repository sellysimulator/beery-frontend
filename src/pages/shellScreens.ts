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
 */
import type { ReactElement } from 'react'

export type ShellScreen = () => ReactElement

type ScreenModule = Record<string, unknown>

/** Section 19's `GameRoomPlaying` and section 20's `HostConsole`. */
const delegatedScreens = import.meta.glob<ScreenModule>(
  ['./GameRoomPlaying.tsx', './HostConsole.tsx'],
  { eager: true },
)

/** Section 18's configuration panel, which the host lobby hosts a slot for. */
const configPanels = import.meta.glob<ScreenModule>(
  ['../components/config/ConfigPanel.tsx'],
  { eager: true },
)

/**
 * The named export if the module has one, else its default. Anything that is
 * not callable is treated as absent, so a half-written module degrades to the
 * placeholder instead of crashing the shell.
 *
 * Exported in this injectable form for the same reason `collectRoutes` is
 * (`16 §3`): the three resolvers below read a glob that is expanded at
 * transform time, so once a screen's file exists they can never return `null`
 * again. An assertion about the absent case must be made against an explicit
 * module record here, never against the live wiring, or it is true for exactly
 * one wave and false forever after.
 */
export function resolveShellScreen(
  modules: Record<string, ScreenModule>,
  path: string,
  name: string,
): ShellScreen | null {
  const found = modules[path]
  if (!found) return null

  const candidate = found[name] ?? found.default
  return typeof candidate === 'function' ? (candidate as ShellScreen) : null
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
