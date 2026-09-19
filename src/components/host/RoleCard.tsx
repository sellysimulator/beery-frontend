import type { ReactElement, ReactNode } from 'react'
import type { HostRoleView, Participant, Role } from '../../types/game'
import { formatMoney } from '../game/SettlementRecap'
import { ROLE_LABEL } from '../lobby/roleCopy'
import { SubstituteBotButton } from './HostControls'

export interface RoleCardProps {
  role: Role
  /** `host_state.roles[role]`. Every *number* on the card comes from here. */
  view: HostRoleView
  /**
   * The *person* in the seat: `participants` matched through
   * `roleToAlias[role]`, or `null` when nobody holds it (§2.1).
   */
  participant: Participant | null
  /** `host_state.currency_symbol`. */
  currencySymbol: string
  roomCode: string
  /** False at `FINISHED`, where every control is gone rather than disabled. */
  showSubstitute: boolean
  /** `RUNNING` or `PAUSED` (§2.2). */
  canSubstitute: boolean
}

/** One labelled figure, tagged with the `host_state` field it came from. */
function Figure({
  label,
  field,
  value,
  tone,
  detail,
}: {
  label: string
  field: string
  value: ReactNode
  tone?: string
  detail?: string
}): ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-sm text-ink-muted" title={detail}>
        {label}
      </span>
      <span className={`numeric text-base font-semibold ${tone ?? ''}`} data-field={field}>
        {value}
      </span>
    </div>
  )
}

/**
 * One role's live position, as the host sees it (§2.1).
 *
 * **Two sources, and only two.** Every number is a field of
 * `host_state.roles[role]`; the person in the seat comes from
 * `participants`, matched through `roleToAlias`. `host_state` carries no
 * display name and no connection state, because who is sitting in a seat is
 * lobby state and the lobby owns it — this card is the one place the two meet,
 * and it derives nothing from either.
 *
 * Two labels are role-specific rather than cosmetic. For the FACTORY the
 * inbound pipeline **is** the production line, so `supply_line` reads *in
 * production* and `production_queue` reads *queued*; they are two different
 * fields and neither is derived from the other. And `orders_in_flight` on the
 * host view is the role's **own** incoming-order pipeline — orders travelling
 * towards it, not the redacted figure a player sees under that name — so it is
 * labelled for what it is.
 */
export function RoleCard({
  role,
  view,
  participant,
  currencySymbol,
  roomCode,
  showSubstitute,
  canSubstitute,
}: RoleCardProps): ReactElement {
  const isFactory = role === 'FACTORY'
  // The name for the *Swap in a bot* warning, which is about a person.
  const seatName = participant?.display_name ?? ROLE_LABEL[role]
  // Never a blank cell: a seat nobody holds still says whose seat it is, and
  // only a real participant gets a connection dot (§2.1, AC 21).
  const emptySeatLabel = `${ROLE_LABEL[role]} — ${
    view.is_bot ? 'played by a bot' : 'empty seat'
  }`

  return (
    <article
      data-role={role}
      className={`flex flex-col gap-3 rounded-lg border bg-surface-raised px-4 py-4 ${
        view.backlog > 0 ? 'border-backlog' : 'border-border'
      }`}
    >
      <header className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          {ROLE_LABEL[role]}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-lg font-semibold" data-field="display_name">
            {participant ? participant.display_name : emptySeatLabel}
          </p>
          {view.is_bot ? (
            <span
              data-field="is_bot"
              className="rounded-full border border-border-strong bg-surface-sunken px-2 py-0.5 text-xs font-semibold uppercase tracking-wide"
            >
              Bot
            </span>
          ) : null}
        </div>

        {participant ? (
          <p
            className={`flex items-center gap-2 text-sm ${
              participant.connected ? 'text-success' : 'text-danger'
            }`}
            data-connected={participant.connected ? 'true' : 'false'}
          >
            <span
              aria-hidden="true"
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                participant.connected ? 'bg-success' : 'bg-danger'
              }`}
            />
            {participant.connected ? 'Connected' : 'Disconnected'}
          </p>
        ) : null}
      </header>

      <div className="flex flex-col gap-1.5">
        <Figure
          label="On hand"
          field="inventory"
          value={view.inventory}
          tone="text-inventory"
        />
        <Figure
          label="Backlog"
          field="backlog"
          value={view.backlog}
          tone={view.backlog > 0 ? 'text-backlog' : undefined}
        />
        <Figure
          label={isFactory ? 'In production' : 'Supply line'}
          field="supply_line"
          value={view.supply_line}
          detail={
            isFactory
              ? "The production line is the Factory's inbound pipeline."
              : 'Beer already shipped to them and still in transit.'
          }
        />
        {isFactory ? (
          <Figure
            label="Queued"
            field="production_queue"
            value={view.production_queue}
            detail="Units that exceeded capacity and are waiting for the line."
          />
        ) : null}
        <Figure
          label="Orders on the way to them"
          field="orders_in_flight"
          value={view.orders_in_flight}
          detail="Orders travelling towards this role, not yet received."
        />
        <Figure
          label="Incoming order"
          field="incoming_order"
          value={view.incoming_order}
        />
        <Figure
          label={isFactory ? 'Last production start' : 'Last order'}
          field="last_order"
          value={view.last_order ?? '—'}
        />
        <Figure
          label="Cost so far"
          field="accumulated_cost"
          value={formatMoney(currencySymbol, view.accumulated_cost)}
        />
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2">
        <p
          className={`flex items-center gap-2 text-sm font-semibold ${
            view.has_submitted ? 'text-success' : 'text-ink-muted'
          }`}
          data-field="has_submitted"
        >
          <span aria-hidden="true">{view.has_submitted ? '✓' : '…'}</span>
          {view.has_submitted ? 'Decided' : 'Still deciding'}
        </p>
        {showSubstitute ? (
          <SubstituteBotButton
            roomCode={roomCode}
            role={role}
            playerName={seatName}
            disabled={!canSubstitute || view.is_bot}
          />
        ) : null}
      </footer>
    </article>
  )
}

export default RoleCard
