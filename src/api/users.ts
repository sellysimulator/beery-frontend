/**
 * REST client for the profile routes, `/users/me/*` (spec §9.9).
 *
 * It carries the three TypeScript mirrors of their responses with it, rather
 * than adding them to `src/types/game.ts`.
 *
 * No route here sends an identifier of any kind. Every path is `/users/me/*`
 * and the caller is derived server-side from the bearer token that
 * `http.ts`'s interceptor attaches, so there is no way for one user to ask
 * for another's history.
 *
 * `ResultsResponse` is imported from the results charts' `chartSetup.ts`, never
 * re-declared: `GET /games/{code}/results` and `GET /users/me/games/{id}`
 * return the identical payload, and one contract read twice drifts.
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
  /** A `games.id`, not a room code — a room code can belong to several games. */
  best_game_id: number | null
  games_as_retailer: number
  games_as_wholesaler: number
  games_as_distributor: number
  games_as_factory: number
}

/** One row of `GET /users/me/games`. */
export interface MatchSummary {
  game_id: number
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
 * One of the caller's own games, in full.
 *
 * 404 — never 403 — when the caller did not play it, so the route is not a
 * game-existence oracle (spec §9.9). The copy on that failure says so too.
 */
export async function getMyGame(gameId: number): Promise<ResultsResponse> {
  const { data } = await http.get<ResultsResponse>(`/users/me/games/${gameId}`)
  return data
}
