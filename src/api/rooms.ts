/**
 * REST client for the room endpoints (`10-rooms-rest-api.md`).
 *
 * `POST /rooms/create` needs no authentication: hosting is a capability, not
 * an account (D3). It returns the one-time `host_secret`, which the caller
 * stores per-room in `sessionStorage` and presents as `X-Host-Secret` on every
 * privileged REST call.
 */
import http from './http'
import type {
  ConfigPreview,
  ConfigResponse,
  GameConfig,
  Limits,
  HostedRoom,
  PresetListResponse,
  RoomBatchCreateRequest,
  RoomBatchCreateResponse,
  RoomCreateRequest,
  RoomCreateResponse,
  RoomStatusResponse,
  RoomSummary,
  RoomSummaryRequest,
  RoomSummaryResponse,
} from '../types/game'

function hostHeaders(hostSecret: string) {
  return { headers: { 'X-Host-Secret': hostSecret } }
}

export async function createRoom(body: RoomCreateRequest = {}): Promise<RoomCreateResponse> {
  const { data } = await http.post<RoomCreateResponse>('/rooms/create', {
    host_display_name: body.host_display_name ?? 'Host',
    preset: body.preset ?? null,
  })
  return data
}

export async function getRoomStatus(roomCode: string): Promise<RoomStatusResponse> {
  const { data } = await http.get<RoomStatusResponse>(`/rooms/${roomCode}/status`)
  return data
}

export async function getRoomConfig(
  roomCode: string,
  hostSecret: string,
): Promise<ConfigResponse> {
  const { data } = await http.get<ConfigResponse>(
    `/rooms/${roomCode}/config`,
    hostHeaders(hostSecret),
  )
  return data
}

export async function updateRoomConfig(
  roomCode: string,
  config: Partial<GameConfig>,
  hostSecret: string,
): Promise<ConfigResponse> {
  const { data } = await http.put<ConfigResponse>(
    `/rooms/${roomCode}/config`,
    { config },
    hostHeaders(hostSecret),
  )
  return data
}

export async function listPresets(): Promise<PresetListResponse> {
  const { data } = await http.get<PresetListResponse>('/rooms/presets')
  return data
}

/**
 * Every range the host form checks. The backend is the only copy of these
 * numbers; the form builds its checks from this response (2026-11-02).
 */
export async function getLimits(): Promise<Limits> {
  const { data } = await http.get<Limits>('/rooms/limits')
  return data
}

/**
 * The demand series and lead times a draft config will play (`10 §3.5b`).
 * No authentication: nothing is stored, and no room is read. A draft the
 * server refuses is a 422 whose `detail` names the field and the range.
 *
 * With a `patch`, the server first merges it over `config` exactly as a
 * config save merges it, and the answer's `config` is the validated result:
 * the multi-game setup form edits its local draft this way (2026-11-14).
 */
export async function previewConfig(config: object, patch?: object): Promise<ConfigPreview> {
  const body = patch === undefined ? { config } : { config, patch }
  const { data } = await http.post<ConfigPreview>('/rooms/preview', body)
  return data
}

/**
 * Creates `count` rooms that all start alike, for the multi-game dashboard
 * (`10 §3.5c`). The server resolves the preset and validates the config patch
 * once, before any room exists, so a refusal (400 unknown preset, 422 naming
 * the field) creates nothing. Every room counts against the per-address
 * room-create limit, all or nothing (429).
 *
 * Every room in the answer carries its `host_secret`: the caller stores each
 * with `setHostSecret` and never logs the response.
 */
export async function createRoomBatch(
  body: RoomBatchCreateRequest,
): Promise<RoomBatchCreateResponse> {
  const { data } = await http.post<RoomBatchCreateResponse>('/rooms/batch-create', {
    count: body.count,
    preset: body.preset ?? null,
    config: body.config ?? {},
    host_display_name: body.host_display_name ?? 'Host',
  })
  return data
}

/**
 * State, seats, week and `can_start` for each room this tab hosts, in the
 * order asked (`10 §3.5d`). A POST so the secrets stay out of URLs. Read-only
 * on the server: polling it never extends a room's lifetime.
 */
export async function getRoomsSummary(rooms: HostedRoom[]): Promise<RoomSummary[]> {
  const body: RoomSummaryRequest = { rooms }
  const { data } = await http.post<RoomSummaryResponse>('/rooms/summary', body)
  return data.rooms
}
