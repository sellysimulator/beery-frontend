import type { ReactElement } from 'react'
import { assignRole, setRoleMode, startGame } from '../../api/games'
import { useGameStore } from '../../store/gameStore'
import { getHostSecret } from '../../utils/storage'
import { ROLE_ORDER, type Role, type RoleAssignmentMode } from '../../types/game'
import ManualLink from '../manual/ManualLink'
import { configPanelScreen } from '../../pages/shellScreens'
import InvitePanel from './InvitePanel'
import ParticipantList from './ParticipantList'
import StartControl from './StartControl'
import { ROLE_LABEL, ROLE_MODE_DESCRIPTION, ROLE_MODE_LABEL } from './roleCopy'

export interface HostLobbyProps {
  roomCode: string
}

const MODES: RoleAssignmentMode[] = ['HOST_ASSIGNS', 'PLAYER_CHOOSES', 'RANDOM']

// Resolved once, at module load: the glob is static, and a component value
// created during render would remount the panel on every keystroke.
const ConfigPanel = configPanelScreen()

/**
 * What a host sees while the room is filling up.
 *
 * The configuration panel's fields belong to section 18; this screen owns the
 * slot they go in and resolves the panel through the same discovery seam the
 * shells use (**D19**), so neither section has to edit the other's file.
 *
 * Every privileged emit carries `host_secret` and nothing else. A client-side
 * "I am the host" boolean is a UI hint and is never sent (**D3**).
 */
export function HostLobby({ roomCode }: HostLobbyProps): ReactElement {
  const participants = useGameStore((state) => state.participants)
  const roleToAlias = useGameStore((state) => state.roleToAlias)
  const roleAssignmentMode = useGameStore((state) => state.roleAssignmentMode)
  const myAlias = useGameStore((state) => state.myAlias)
  const roomState = useGameStore((state) => state.roomState)
  const canStart = useGameStore((state) => state.canStart)
  const startBlockedReason = useGameStore((state) => state.startBlockedReason)

  const hostSecret = getHostSecret(roomCode)

  /**
   * Eligibility arrives from the server (`00-conventions.md` section 4).
   * `RoomService.can_start` already knows about empty seats, bot fill and a
   * config that will not build; a second implementation here would be a second
   * set of rules to keep in step, silently wrong the first time the two
   * disagree. The reason is rendered exactly as it was sent.
   */
  const blockedReason = canStart
    ? null
    : (startBlockedReason ??
      (roomState === null
        ? 'Waiting for the server to confirm the room is ready to start.'
        : 'The server has not said why the game cannot start yet.'))

  function handleMode(mode: RoleAssignmentMode): void {
    if (!hostSecret) return
    setRoleMode({ room_id: roomCode, host_secret: hostSecret, mode })
  }

  function handleAssign(alias: string, role: Role | null): void {
    if (!hostSecret) return
    assignRole({ room_id: roomCode, host_secret: hostSecret, alias, role })
  }

  function handleStart(): void {
    if (!hostSecret) return
    startGame({ room_id: roomCode, host_secret: hostSecret })
  }

  const seated = ROLE_ORDER.filter((role) => roleToAlias[role] !== null).length

  return (
    <div className="min-h-screen px-6 py-10 pb-24">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Setting up your game</h1>
          <p className="text-ink-muted">
            Players cannot see any of these settings. Take the time you need.
          </p>
        </header>

        <InvitePanel
          roomCode={roomCode}
          inviteUrl={`${window.location.origin}/join/${roomCode}`}
        />

        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">
            Who is here{' '}
            <span className="text-base font-normal text-ink-muted">
              — {seated} of {ROLE_ORDER.length} seats filled
            </span>
          </h2>
          <ParticipantList
            participants={participants}
            myAlias={myAlias}
            onAssign={roleAssignmentMode === 'HOST_ASSIGNS' ? handleAssign : undefined}
            assignDisabled={hostSecret === null}
          />
          {roleAssignmentMode === 'HOST_ASSIGNS' ? (
            <ul className="flex flex-wrap gap-3 text-sm text-ink-muted">
              {ROLE_ORDER.map((role) => (
                <li key={role} className="rounded border border-border px-2 py-1">
                  {ROLE_LABEL[role]}:{' '}
                  {roleToAlias[role] === null ? (
                    <span className="text-warning">empty</span>
                  ) : (
                    (participants.find((p) => p.alias === roleToAlias[role])?.display_name ??
                    roleToAlias[role])
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">How roles are handed out</h2>
          <label className="flex flex-col gap-1 text-sm">
            <span>Role assignment</span>
            <select
              value={roleAssignmentMode ?? ''}
              disabled={hostSecret === null}
              onChange={(event) => handleMode(event.target.value as RoleAssignmentMode)}
              className="rounded-md border border-border bg-surface px-3 py-2 text-ink"
            >
              {roleAssignmentMode === null ? <option value="">Not set yet</option> : null}
              {MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {ROLE_MODE_LABEL[mode]}
                </option>
              ))}
            </select>
          </label>
          {roleAssignmentMode ? (
            <p className="text-sm text-ink-muted">{ROLE_MODE_DESCRIPTION[roleAssignmentMode]}</p>
          ) : null}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Game settings</h2>
          {ConfigPanel ? (
            <ConfigPanel />
          ) : (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-ink-muted">
              The settings panel is not available yet. The game will run on its defaults.
            </p>
          )}
        </section>

        <StartControl blockedReason={blockedReason} onStart={handleStart} />
      </div>

      <ManualLink to="/host-manual" label="Host manual" />
    </div>
  )
}

export default HostLobby
