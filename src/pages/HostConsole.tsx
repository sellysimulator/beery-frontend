import { useCallback, useState, type ReactElement } from 'react'
import { Link, useParams } from 'react-router-dom'
import { resumeGame } from '../api/games'
import { useGameStore } from '../store/gameStore'
import { getHostSecret } from '../utils/storage'
import ChainDiagram from '../components/host/ChainDiagram'
import DemandCurve from '../components/host/DemandCurve'
import HostControls from '../components/host/HostControls'
import PresentationMode from '../components/host/PresentationMode'
import RoleCard from '../components/host/RoleCard'
import { type SubmissionEntry } from '../components/host/SubmissionTracker'
import WaitingNotice from '../components/lobby/WaitingNotice'
import { ROLE_LABEL } from '../components/lobby/roleCopy'
import { formatMoney } from '../components/game/SettlementRecap'
import { ROLE_ORDER, type Participant, type Role, type RoleToAlias } from '../types/game'

/** The person in a seat: `participants`, matched through `roleToAlias` (§2.1). */
function seatFor(
  role: Role,
  roleToAlias: RoleToAlias,
  participants: Participant[],
): Participant | null {
  const alias = roleToAlias[role]
  if (!alias) return null
  return participants.find((participant) => participant.alias === alias) ?? null
}

/**
 * The host's live view of the whole chain, and the controls that run a session
 * (section 20).
 *
 * Section 17's `HostRoom.tsx` shell resolves this by name and renders it with
 * no arguments once the room is `RUNNING`, `PAUSED` **or** `FINISHED`
 * (**D19**, §2.0). It takes no props, reads everything from the store and
 * `useParams`, and exports no `route`: `/host/:roomCode` belongs to section
 * 17, and a second descriptor for the same path would register a duplicate.
 *
 * **It computes nothing.** Every number is a field of `store.hostState`,
 * refreshed on every `host_state` event, which the server sends unredacted to
 * the host's sid alone. The host's view is authoritative precisely because it
 * is the server's — and it is what makes a refresh indistinguishable from
 * never having left (§3.1, AC 19).
 *
 * **Authority is the server's answer, never the presence of a secret**
 * (§3.3, **D18**). A host whose tab was closed has no `host_secret`, because
 * it lives in `sessionStorage`; the server re-authorises them against the
 * verified identity the handshake already carries. So nothing here refuses to
 * render, or hides a control, because storage is empty: deciding that locally
 * would lock out exactly the host **D18** exists to let back in, leaving four
 * players in a room nobody can unpause. The refusal case is `join_error`, and
 * `HostRoom` has already handled it by the time this renders.
 *
 * The host holds no seat: no decision form, no inventory of their own, no cost
 * of their own. The host does not play (§3.2).
 */
export function HostConsole(): ReactElement {
  const params = useParams<{ roomCode: string }>()
  const storeRoomCode = useGameStore((state) => state.roomCode)
  const hostState = useGameStore((state) => state.hostState)
  const participants = useGameStore((state) => state.participants)
  const roleToAlias = useGameStore((state) => state.roleToAlias)
  const roomState = useGameStore((state) => state.roomState)
  const paused = useGameStore((state) => state.paused)
  const pausedReason = useGameStore((state) => state.pausedReason)
  const finished = useGameStore((state) => state.finished)

  // Presentation mode is local state, and full screen is a side effect of
  // entering it (§3.4a). The console keeps running underneath, so exiting is
  // instant and no second copy of state exists.
  const [presenting, setPresenting] = useState(false)
  const present = useCallback(() => setPresenting(true), [])
  const exitPresentation = useCallback(() => setPresenting(false), [])

  const roomCode = params.roomCode ?? storeRoomCode ?? ''

  if (!hostState) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <WaitingNotice
          title="Waiting for the room's state"
          detail="The game is running. Every figure on this console comes from the server, and the first update is on its way."
        />
      </div>
    )
  }

  const isFinished = roomState === 'FINISHED' || hostState.phase === 'FINISHED'
  const isPaused = !isFinished && (paused || roomState === 'PAUSED')
  const weeksPlayed = finished?.weeks_played ?? hostState.week

  const entries: SubmissionEntry[] = ROLE_ORDER.map((role) => ({
    role,
    name: seatFor(role, roleToAlias, participants)?.display_name ?? ROLE_LABEL[role],
    submitted: hostState.roles[role].has_submitted,
  }))

  function handleResume(): void {
    // Read at the moment it is pressed, because under **D18** the secret can
    // arrive after this console first rendered. No secret means no emit at
    // all: an empty one is not authority (§5, FM 6).
    const hostSecret = getHostSecret(roomCode)
    if (hostSecret === null) return
    resumeGame({ room_id: roomCode, host_secret: hostSecret })
  }

  return (
    <>
      <div
        className="flex min-h-screen flex-col gap-4 px-6 py-6"
        aria-hidden={presenting ? 'true' : undefined}
      >
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-surface-raised px-5 py-4">
          <div className="flex flex-wrap items-baseline gap-4">
            {isFinished ? (
              <h1 className="text-2xl font-semibold">
                Finished — <span className="numeric">{weeksPlayed}</span> weeks played
              </h1>
            ) : (
              <h1 className="text-2xl font-semibold">
                Week <span className="numeric">{hostState.week}</span> of{' '}
                <span className="numeric">{hostState.duration_weeks}</span>
              </h1>
            )}
            <p
              className={`flex items-center gap-2 text-sm font-semibold ${
                isFinished ? 'text-ink-muted' : isPaused ? 'text-warning' : 'text-success'
              }`}
              data-field="phase"
            >
              <span
                aria-hidden="true"
                className={`inline-block h-2.5 w-2.5 rounded-full ${
                  isFinished ? 'bg-ink-subtle' : isPaused ? 'bg-warning' : 'bg-success'
                }`}
              />
              {isFinished ? 'Finished' : isPaused ? 'Paused' : 'Running'}
            </p>
            <p className="text-sm text-ink-muted">
              Chain cost so far{' '}
              <span className="numeric font-semibold" data-field="chain_total_cost">
                {formatMoney(hostState.currency_symbol, hostState.chain_total_cost)}
              </span>
            </p>
          </div>

          {/* Every control in §2.2 is GONE at FINISHED, not disabled: there is
              nothing left to pause, force or end, and a greyed-out "End the
              game now" invites the host to wonder whether it worked (§2.4a). */}
          {isFinished ? (
            <Link
              to={`/results/${roomCode}`}
              className="rounded-md border border-brand bg-brand-soft px-5 py-2.5 text-base font-semibold text-brand-strong hover:border-ink"
            >
              See the results
            </Link>
          ) : (
            <HostControls
              roomCode={roomCode}
              paused={isPaused}
              awaitingRoles={hostState.awaiting_roles}
              week={hostState.week}
              onPresent={present}
            />
          )}
        </header>

        {/* **D7**: the game never resumes itself, so this banner is the only
            exit from a pause and must be impossible to miss (§2.3). The reason
            is the server's, verbatim. */}
        {isPaused ? (
          <div
            role="status"
            className="flex flex-wrap items-center justify-between gap-4 rounded-lg border-2 border-warning bg-warning-soft px-5 py-4"
          >
            <div className="flex flex-col gap-1">
              <p className="text-xl font-semibold text-warning">The game is paused</p>
              <p className="text-base text-ink" data-field="paused_reason">
                {pausedReason ?? 'The game is paused.'}
              </p>
            </div>
            <button
              type="button"
              onClick={handleResume}
              className="rounded-md border-2 border-warning bg-surface-raised px-5 py-2.5 text-base font-semibold text-warning hover:border-ink hover:text-ink"
            >
              Resume
            </button>
          </div>
        ) : null}

        <ChainDiagram roles={hostState.roles} />

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {ROLE_ORDER.map((role) => (
            <RoleCard
              key={role}
              role={role}
              view={hostState.roles[role]}
              participant={seatFor(role, roleToAlias, participants)}
              currencySymbol={hostState.currency_symbol}
              roomCode={roomCode}
              showSubstitute={!isFinished}
              canSubstitute={!isFinished}
            />
          ))}
        </div>

        <DemandCurve
          demandSeries={hostState.demand_series}
          currentWeek={hostState.week}
        />
      </div>

      {presenting ? (
        <PresentationMode
          week={hostState.week}
          durationWeeks={hostState.duration_weeks}
          roles={hostState.roles}
          demandSeries={hostState.demand_series}
          entries={entries}
          onExit={exitPresentation}
        />
      ) : null}
    </>
  )
}

export default HostConsole
