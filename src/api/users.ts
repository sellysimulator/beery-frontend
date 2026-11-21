/**
 * REST client for the profile routes, `/users/me/*` (spec §9.9).
 *
 * It carries the TypeScript mirrors of their responses with it, rather
 * than adding them to `src/types/game.ts`.
 *
 * No route here sends an identifier of any kind. Every path is `/users/me/*`
 * and the caller is derived server-side from the bearer token that
 * `http.ts`'s interceptor attaches, so there is no way for one user to ask
 * for another's history.
 *
 * `ResultsResponse` is imported from the results charts' `chartSetup.ts`, never
 * re-declared: `GET /games/id/{public_id}/results` and
 * `GET /users/me/games/{public_id}` return the identical payload, and one contract read twice drifts.
 */
import http from './http'
import type { ResultsResponse } from '../components/charts/chartSetup'
import type { Role } from '../types/game'

/** `GET /users/me/stats`. Zero-filled for a user with no games. */
export interface UserStatsResponse {
  games_played: number
  weeks_played: number
  total_cost: number
  avg_cost_per_week: number
  /** `null` when no game of theirs had customer demand that varied (**D12**). */
  bullwhip_avg: number | null
  /**
   * The best game's `public_id`, not a room code — a room code can belong to
   * several games — and never an internal id (D22).
   */
  best_game_public_id: string | null
  games_as_retailer: number
  games_as_wholesaler: number
  games_as_distributor: number
  games_as_factory: number
}

/** One row of `GET /users/me/games`. */
export interface MatchSummary {
  /** The game's permanent id; the row opens `/profile/games/:publicId`. */
  public_id: string
  room_code: string
  /** ISO 8601 in UTC with a `Z` suffix (`2026-11-18T14:00:00Z`), so `new Date()` reads it as UTC. */
  finished_at: string
  role: Role
  weeks_played: number
  total_cost: number
  bullwhip_ratio: number | null
  chain_total_cost: number
  preset_name: string | null
}

export interface MatchHistoryResponse {
  matches: MatchSummary[]
  total: number
  page: number
  page_size: number
}

/** The page size the profile asks for, and the only one it ever asks for. */
const DEFAULT_PAGE_SIZE = 20

export async function getMyStats(): Promise<UserStatsResponse> {
  const { data } = await http.get<UserStatsResponse>('/users/me/stats')
  return data
}

/**
 * One page of the caller's match history, newest first.
 *
 * The server clamps `page_size` to `[1, 100]`; the client never
 * asks for more than a page's worth, because a bigger page is how the "one
 * query, one render" guarantee gets quietly undone from this side.
 */
export async function getMyGames(
  page: number,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<MatchHistoryResponse> {
  const { data } = await http.get<MatchHistoryResponse>('/users/me/games', {
    params: { page, page_size: pageSize },
  })
  return data
}

/**
 * One of the caller's own games, in full, by its `public_id`.
 *
 * 404 — never 403 — when the caller did not play it, so the route is not a
 * game-existence oracle (spec §9.9). The copy on that failure says so too.
 */
export async function getMyGame(publicId: string): Promise<ResultsResponse> {
  const { data } = await http.get<ResultsResponse>(`/users/me/games/${publicId}`)
  return data
}

/** One row of `GET /users/me/hosted-games`: a game the caller hosted signed in. */
export interface HostedGameSummary {
  /** Opens the open results page, `/results/:publicId` (D22). */
  public_id: string
  room_code: string
  /** ISO 8601 in UTC with a `Z` suffix. */
  finished_at: string
  /** Seats in the game, bots included. */
  player_count: number
  ended_early: boolean
}

export interface HostedGamesResponse {
  games: HostedGameSummary[]
  total: number
  page: number
  page_size: number
}

/**
 * One page of the games the caller hosted while signed in, newest first
 * (**D23**). A list only: being on it grants nothing — no export, no claim,
 * no results access beyond the open page everyone has.
 */
export async function getMyHostedGames(
  page: number,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<HostedGamesResponse> {
  const { data } = await http.get<HostedGamesResponse>('/users/me/hosted-games', {
    params: { page, page_size: pageSize },
  })
  return data
}
