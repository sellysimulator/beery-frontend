import type { ReactElement } from 'react'
import { ROLE_ORDER, type HostRoleView, type Role } from '../../types/game'
import { ROLE_LABEL } from '../lobby/roleCopy'
import { FlowLane, FlowLegend } from '../game/ChainFlow'

export interface ChainDiagramProps {
  /** `host_state.roles` — every figure here is one of its fields (§3.1). */
  roles: Record<Role, HostRoleView>
  /** Projector styling: larger type, thicker rules (§2.4, §3.5). */
  presenting?: boolean
}

/**
 * The warning mark that rides with every backlog figure.
 *
 * Backlog must never be signalled by colour alone (§3.5, FM 9): on a projector
 * washed out by daylight, and for a colour-blind viewer, the shape and the word
 * *Backlog* are the signal and the red is decoration.
 */
function BacklogIcon({ large }: { large: boolean }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      className={large ? 'h-9 w-9 shrink-0' : 'h-5 w-5 shrink-0'}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M12 3 1.5 21h21L12 3Z"
        fill="currentColor"
        fillOpacity="0.18"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M12 9v5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="12" cy="17.4" r="1.15" fill="currentColor" />
    </svg>
  )
}

/**
 * How full a link's bar is drawn, as a percentage of the fullest link.
 *
 * Geometry, not a game figure: no number derived here is ever rendered as
 * text or sent anywhere (`00-conventions.md §4`). Every quantity on the
 * diagram is printed straight out of `host_state`.
 */
function barWidth(value: number, peak: number): string {
  if (peak <= 0 || value <= 0) return '0%'
  return `${Math.max(4, Math.round((value / peak) * 100))}%`
}

/**
 * The chain, end to end: Customer → Retailer → Wholesaler → Distributor →
 * Factory, with live inventory and backlog on each link (§2.1).
 *
 * Between the cards run the same animated links as the player's banner
 * (`game/ChainFlow.tsx`): sticky-note orders travel upstream towards the
 * factory while beer travels back down. The bars fill and drain as weeks
 * close, which is the whole point of putting this on a projector: the
 * bullwhip becomes visible *while it is happening* rather than in the debrief
 * afterwards.
 *
 * It shows no cost and no order quantity, in either mode, so that the same
 * component can face a room full of players (§2.4, FM 1 and 2).
 */
export function ChainDiagram({ roles, presenting = false }: ChainDiagramProps): ReactElement {
  const peak = Math.max(
    1,
    ...ROLE_ORDER.map((role) => Math.max(roles[role].inventory, roles[role].backlog)),
  )

  return (
    <section
      aria-label="The supply chain"
      className={
        presenting
          ? 'flex flex-col gap-3'
          : 'flex flex-col gap-3 rounded-lg border border-border bg-surface-raised px-5 py-4'
      }
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={presenting ? 'text-[2rem] font-bold' : 'text-xl font-semibold'}>
          The chain
        </h2>
        <div className="flex flex-col gap-1">
          <FlowLegend large={presenting} />
          {presenting ? null : (
            <p className="text-sm text-ink-subtle">
              Beer arrives a few weeks after the order that asked for it.
            </p>
          )}
        </div>
      </div>

      <ol className="flex flex-wrap items-stretch gap-y-2">
        <li className="flex items-center">
          <div
            className={`flex min-w-28 flex-col justify-center rounded-lg border border-dashed border-border-strong bg-surface-sunken px-3 ${
              presenting ? 'py-4' : 'py-3'
            }`}
          >
            <p
              className={
                presenting ? 'text-[1.75rem] font-bold' : 'text-sm font-semibold uppercase'
              }
            >
              Customer
            </p>
            <p className={presenting ? 'text-[1.25rem]' : 'text-xs text-ink-muted'}>
              Real demand
            </p>
          </div>
          <FlowLane index={0} large={presenting} />
        </li>

        {ROLE_ORDER.map((role, index) => {
          const view = roles[role]
          const last = index === ROLE_ORDER.length - 1
          return (
            <li key={role} className="flex flex-1 items-center" data-role={role}>
              <div
                className={`flex min-w-40 flex-1 flex-col gap-2 rounded-lg border bg-surface px-3 ${
                  presenting ? 'py-4' : 'py-3'
                } ${view.backlog > 0 ? 'border-backlog' : 'border-border'}`}
              >
                <p
                  className={
                    presenting
                      ? 'text-[1.75rem] font-bold'
                      : 'text-sm font-semibold uppercase'
                  }
                >
                  {ROLE_LABEL[role]}
                </p>

                <div className="flex flex-col gap-1">
                  <p
                    className={
                      presenting
                        ? 'text-[2rem] font-bold text-inventory'
                        : 'text-base font-semibold text-inventory'
                    }
                  >
                    <span className="numeric" data-field="inventory">
                      {view.inventory}
                    </span>{' '}
                    on hand
                  </p>
                  <span
                    aria-hidden="true"
                    className={`block rounded-full bg-inventory-soft ${
                      presenting ? 'h-4' : 'h-2'
                    }`}
                  >
                    <span
                      className="block h-full rounded-full bg-inventory transition-all duration-500"
                      style={{ width: barWidth(view.inventory, peak) }}
                    />
                  </span>
                </div>

                <div
                  className={`flex items-center gap-2 ${
                    view.backlog > 0 ? 'text-backlog' : 'text-ink-subtle'
                  }`}
                  data-backlog={view.backlog > 0 ? 'true' : 'false'}
                >
                  {view.backlog > 0 ? <BacklogIcon large={presenting} /> : null}
                  <p className={presenting ? 'text-[1.75rem] font-bold' : 'text-sm'}>
                    Backlog{' '}
                    <span className="numeric" data-field="backlog">
                      {view.backlog}
                    </span>
                  </p>
                </div>
                <span
                  aria-hidden="true"
                  className={`block rounded-full bg-backlog-soft ${
                    presenting ? 'h-4' : 'h-2'
                  }`}
                >
                  <span
                    className="block h-full rounded-full bg-backlog transition-all duration-500"
                    style={{ width: barWidth(view.backlog, peak) }}
                  />
                </span>
              </div>
              {last ? null : <FlowLane index={index + 1} large={presenting} />}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

export default ChainDiagram
