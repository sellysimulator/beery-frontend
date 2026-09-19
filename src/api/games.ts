/**
 * The client -> server half of the wire contract: one function per event in
 * sections 11 and 12, each taking the payload that section declares.
 *
 * Every emit in the app goes through here, which is what makes two invariants
 * checkable in one place:
 *   - authority is only ever `host_secret`. A client-side "I am the host"
 *     boolean is a UI hint and is never sent (D3).
 *   - no payload carries a client-computed total. Inventory, cost and
 *     eligibility all arrive from the server and are display-only
 *     (`00-conventions.md` section 4).
 *
 * This module holds no REST call: `rooms.ts` is section 10's REST client and
 * `health.ts` is the wake-up probe.
 */
import { socket } from './socket'
import type {
  AssignRoleEmit,
  ClaimRoleEmit,
  ConfigUpdateEmit,
  EndGameEarlyEmit,
  ForceCloseWeekEmit,
  JoinEmit,
  JoinWaitingEmit,
  LeaveEmit,
  PauseGameEmit,
  ReleaseRoleEmit,
  RequestStateEmit,
  ResumeGameEmit,
  SetRoleModeEmit,
  StartGameEmit,
  SubmitOrderEmit,
  SubstituteBotEmit,
} from '../types/game'

/* ─── lobby (section 11) ─── */

/**
 * Claims the host seat. The payload omits `host_secret` when this tab holds
 * none, so the server can authorise the claim against the connection's
 * verified identity instead (D18) and answer with `host_claimed`.
 */
export function joinWaiting(payload: JoinWaitingEmit): void {
  socket.emit('join_waiting', payload)
}

export function join(payload: JoinEmit): void {
  socket.emit('join', payload)
}

export function leave(payload: LeaveEmit): void {
  socket.emit('leave', payload)
}

export function configUpdate(payload: ConfigUpdateEmit): void {
  socket.emit('config_update', payload)
}

export function setRoleMode(payload: SetRoleModeEmit): void {
  socket.emit('set_role_mode', payload)
}

export function assignRole(payload: AssignRoleEmit): void {
  socket.emit('assign_role', payload)
}

export function claimRole(payload: ClaimRoleEmit): void {
  socket.emit('claim_role', payload)
}

export function releaseRole(payload: ReleaseRoleEmit): void {
  socket.emit('release_role', payload)
}

export function startGame(payload: StartGameEmit): void {
  socket.emit('start_game', payload)
}

/* ─── play (section 12) ─── */

/**
 * `week` is this tab's belief about the open week. The server treats it as a
 * guard, not an instruction, so a stale tab cannot order into the wrong week.
 */
export function submitOrder(payload: SubmitOrderEmit): void {
  socket.emit('submit_order', payload)
}

export function pauseGame(payload: PauseGameEmit): void {
  socket.emit('pause_game', payload)
}

export function resumeGame(payload: ResumeGameEmit): void {
  socket.emit('resume_game', payload)
}

export function forceCloseWeek(payload: ForceCloseWeekEmit): void {
  socket.emit('force_close_week', payload)
}

export function substituteBot(payload: SubstituteBotEmit): void {
  socket.emit('substitute_bot', payload)
}

export function endGameEarly(payload: EndGameEarlyEmit): void {
  socket.emit('end_game_early', payload)
}

export function requestState(payload: RequestStateEmit): void {
  socket.emit('request_state', payload)
}
