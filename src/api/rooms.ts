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
  ConfigResponse,
  GameConfig,
  PresetListResponse,
  RoomCreateRequest,
  RoomCreateResponse,
  RoomStatusResponse,
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
