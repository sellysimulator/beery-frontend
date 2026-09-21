import { useState, type ReactElement } from 'react'
import { claimRole } from '../../api/games'
import { useGameStore } from '../../store/gameStore'
import { ROLE_ORDER, type Role } from '../../types/game'
import ManualLink from '../manual/ManualLink'
import LeaveControl from './LeaveControl'
import ParticipantList from './ParticipantList'
import RoleCard from './RoleCard'
import WaitingNotice from './WaitingNotice'
import { ROLE_LABEL } from './roleCopy'

export interface PlayerLobbyProps {
  roomCode: string
}

/**
 * What a player sees before week 1.
 *
 * `beer-game-spec.md` section 4.1 is explicit that players MUST NOT see game
 * parameters while the host configures, and this screen honours that by never
 * reading `store.config` at all. The server should never send a player a
 * config (`11-socket-lobby.md` section 3.4); if it ever did, there is nothing
 * here that would render it.
 *
 * Everything on the screen comes from the store, which the socket handlers
 * own. This component computes nothing about the game.
 */
export function PlayerLobby({ roomCode }: PlayerLobbyProps): ReactElement {
  const hostDisplayName = useGameStore((state) => state.hostDisplayName)
  const participants = useGameStore((state) => state.participants)
  const roleToAlias = useGameStore((state) => state.roleToAlias)
  const roleAssignmentMode = useGameStore((state) => state.roleAssignmentMode)
  const myAlias = useGameStore((state) => state.myAlias)
  const myRole = useGameStore((state) => state.myRole)
  const roomState = useGameStore((state) => state.roomState)
  // `join_error` is read from the store, not from a listener of this screen's
  // own: the store is the single reader of the wire (`16 §3`).
  const joinError = useGameStore((state) => state.joinError)
  const clearJoinError = useGameStore((state) => state.clearJoinError)

  // Which card the refusal belongs against — the one this player last clicked.
  const [pendingRole, setPendingRole] = useState<Role | null>(null)

  /**
   * A refusal stops being relevant the moment this player is seated, because
   * the server's `lobby_update` has settled who holds what.
   */
  const activeError =
    joinError && pendingRole && myRole === null
      ? { role: pendingRole, message: joinError }
      : null

  const host = hostDisplayName ?? 'The host'
  const nameFor = (alias: string | null): string | null =>
    alias === null
      ? null
      : (participants.find((participant) => participant.alias === alias)?.display_name ?? alias)

  function handleClaim(role: Role): void {
    setPendingRole(role)
    clearJoinError()
    claimRole({ room_id: roomCode, role })
  }

  return (
    <div className="min-h-screen px-6 py-10 pb-24">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <header className="flex flex-col gap-1">
          <p className="text-sm uppercase tracking-wide text-ink-muted">Room</p>
          <p className="numeric text-figure text-brand">{roomCode}</p>
          <p className="text-ink-muted">Hosted by {host}</p>
        </header>

        <WaitingNotice
          title={
            roomState === 'READY'
              ? `${host} is about to start the game.`
              : `${host} is setting up the game.`
          }
          detail="You will not see the settings — that is deliberate. The game starts on the host's signal, and your screen changes by itself."
        />

        <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised px-5 py-4">
          <h2 className="text-sm uppercase tracking-wide text-ink-muted">Your seat</h2>
          <p className="text-lg">
            {myRole
              ? `You are the ${ROLE_LABEL[myRole]}.`
              : roleAssignmentMode === 'PLAYER_CHOOSES'
                ? 'You have not taken a seat yet. Choose one below.'
                : roleAssignmentMode === 'RANDOM'
                  ? 'Seats are dealt at random when the game starts.'
                  : `You have no seat yet. ${host} decides who plays which link in the chain.`}
          </p>
        </section>

        {roleAssignmentMode === 'PLAYER_CHOOSES' ? (
          <section className="flex flex-col gap-3">
            <h2 className="text-xl font-semibold">Choose a seat</h2>
            <p className="text-sm text-ink-muted">
              First come, first served. The host can move anyone before the game starts.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {ROLE_ORDER.map((role) => (
                <RoleCard
                  key={role}
                  role={role}
                  holder={nameFor(roleToAlias[role])}
                  isMine={myRole === role}
                  error={activeError?.role === role ? activeError.message : null}
                  onClaim={handleClaim}
                />
              ))}
            </div>
          </section>
        ) : null}

        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Who is here</h2>
          <ParticipantList participants={participants} myAlias={myAlias} />
        </section>

        <LeaveControl roomCode={roomCode} />
      </div>

      <ManualLink to="/player-manual" label="Player manual" />
    </div>
  )
}

export default PlayerLobby
