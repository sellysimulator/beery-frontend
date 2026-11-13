import { useEffect, useState, type ReactElement } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { startGame } from '../api/games'
import GameCard from '../components/multihost/GameCard'
import { hostedRooms } from '../components/multihost/multihost'
import { useRoomsSummary } from '../components/multihost/useRoomsSummary'
import { useGameStore } from '../store/gameStore'
import { clearHostBatch, getHostBatch } from '../utils/storage'
import type { RouteDescriptor } from '../routes/registry'

/** How long after "Start all" the dashboard asks again, so the server has
 * handled the `start_game` emits before the cards are refreshed. */
const REFRESH_AFTER_START_MS = 1000

/**
 * `/multihost`: every game of the batch this tab made, as a grid of cards.
 *
 * It sits one layer above the host screen and never joins a room's socket
 * channel. Seats and state come from `POST /rooms/summary` (polled), and each
 * game's host screen opens in its own tab (`openHostScreen`), with its own
 * socket and store.
 *
 * **Start all ready games** sends the ordinary `start_game` emit for each room
 * whose server summary says `can_start`. That is safe from this tab:
 * `start_game` is authorised by `host_secret` alone, not by which socket last
 * claimed the room, and the server re-checks `can_start` (dealing RANDOM roles
 * and filling bots first, exactly as the host screen's Start does). The
 * `game_started` broadcast reaches the room's players and any open host
 * screen, and the host view goes to the claimed host tab — or here, when no
 * host screen is open, where it is ignored until one opens and re-claims.
 */
export function MultiHostDashboard(): ReactElement {
  const navigate = useNavigate()
  // Read once: the batch only changes on /multihost/new, which remounts this page.
  const [rooms] = useState(() => hostedRooms(getHostBatch() ?? []))
  const { summaries, error, refresh } = useRoomsSummary(rooms)

  // This tab may have been in a room before (a single game's host screen, say).
  // On every reconnect `rejoinAfterConnect` re-claims `store.roomCode`, which
  // would put this tab back in that room's channel and its broadcasts in the
  // store. Clearing the store stops that; the dashboard keeps no room of its own.
  useEffect(() => {
    if (useGameStore.getState().roomCode !== null) useGameStore.getState().reset()
  }, [])

  if (rooms.length === 0) return <Navigate to="/multihost/new" replace />

  const ready = rooms.filter(({ room_code }) => summaries[room_code]?.can_start === true)

  function handleStartAll(): void {
    for (const room of ready) {
      if (room.host_secret) startGame({ room_id: room.room_code, host_secret: room.host_secret })
    }
    window.setTimeout(refresh, REFRESH_AFTER_START_MS)
  }

  function handleNewBatch(): void {
    clearHostBatch()
    navigate('/multihost/new')
  }

  return (
    <div className="min-h-screen px-6 py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="flex flex-col gap-2">
            <Link to="/home" className="text-sm text-ink-muted hover:text-brand">
              ← Home
            </Link>
            <h1 className="text-2xl font-semibold">Your games</h1>
            <p className="text-ink-muted">
              Share each invite link or QR code with one group. Seats and status refresh every few
              seconds.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleStartAll}
              disabled={ready.length === 0}
              className="rounded-md bg-brand px-4 py-2 font-semibold text-ink-inverse transition hover:bg-brand-strong disabled:bg-surface-sunken disabled:text-ink-subtle"
            >
              Start all ready games ({ready.length})
            </button>
            <button
              type="button"
              onClick={handleNewBatch}
              className="rounded-md border border-border-strong px-4 py-2 font-semibold hover:border-brand hover:text-brand"
            >
              New batch
            </button>
          </div>
        </header>

        {error ? (
          <p role="alert" className="rounded-md border border-danger bg-danger-soft px-4 py-3 text-sm text-danger">
            {error}
          </p>
        ) : null}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {rooms.map(({ room_code }, index) => (
            <GameCard key={room_code} index={index} roomCode={room_code} summary={summaries[room_code]} />
          ))}
        </div>
      </div>
    </div>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const route: RouteDescriptor = {
  path: '/multihost',
  guard: 'auth+backend',
  element: <MultiHostDashboard />,
}

export default MultiHostDashboard
