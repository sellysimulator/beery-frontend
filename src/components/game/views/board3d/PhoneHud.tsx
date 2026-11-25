import { ChartLine, ClipboardPen, ScrollText, type LucideIcon } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import type { Role } from '../../../../types/game'
import { isPhoneHelpHidden, setPhoneHelpHidden } from '../../../../utils/storage'
import { PANEL_TITLE, type Board3DPanelId } from './Board3DPanels'
import Joystick from './Joystick'
import ModelAttribution from './ModelAttribution'
import type { MovePadProps } from './MovePad'
import type { InteractTargetId } from './sceneModel'

/** The same sentence in every Novus game. */
export const PHONE_WARNING = '3D mode may not be very well optimized for phones.'

/** The help card's lines. The same three in every Novus game. */
export const PHONE_PROMPT_COPY = {
  move: 'Joystick: walk',
  look: 'Drag: look around',
  panels: 'Icons: open everything',
} as const

/** The icon of each panel, the order desk first: it is the one a week needs. */
const DOCK: ReadonlyArray<{ id: Board3DPanelId; icon: LucideIcon }> = [
  { id: 'order-desk', icon: ClipboardPen },
  { id: 'ledger-wall', icon: ScrollText },
  { id: 'team-board', icon: ChartLine },
]

export interface PhoneDock {
  /** The panel on screen, or null. */
  readonly top: Board3DPanelId | null
  /** False while paused, exactly when `E` is inert. */
  readonly enabled: boolean
  /** Opens a panel, brings an open one to the front, or closes the one shown. */
  onToggle(id: Board3DPanelId): void
}

export interface PhoneHudProps {
  week: number
  durationWeeks: number
  role: Role
  notice: string | null
  /** The week-change sentence, or ''. */
  announcement: string
  /** A prompt that offers no button (paused), or null. */
  prompt: string | null
  openable: InteractTargetId | null
  /** The Open button's name: the action, then the station's panel title. */
  openLabel: string
  onInteract(id: InteractTargetId): void
  pad: MovePadProps | null
  dock: PhoneDock | undefined
}

/** The "?" and its card: the corner upright, beside the dock's column on its
 *  side. The 2D button (`BoardViewToggle`) stands to its left. */
const HELP_RIGHT =
  'right-[max(0.75rem,env(safe-area-inset-right))] landscape:right-[calc(max(0.75rem,env(safe-area-inset-right))_+_3.25rem)]'

const ROUND =
  'pointer-events-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full border shadow-md'

/**
 * The HUD on a phone: the week on the left, "2D" and "?" on the right, every
 * panel in one dock of icons, a joystick to walk, and the Open button under
 * the crosshair at a station.
 *
 * The dock exists because walking is the hard part on a phone: an order is one
 * tap from anywhere, and the hall is there to look around in. It is a row
 * along the bottom of an upright phone and a column on the right of one on its
 * side, and the panels (`PHONE_PANEL`) leave it uncovered, so a player can look
 * at the ledger and go back to a half-typed order.
 *
 * Every live region of the desktop's HUD is here too, mounted empty or not.
 */
export function PhoneHud({
  week,
  durationWeeks,
  role,
  notice,
  announcement,
  prompt,
  openable,
  openLabel,
  onInteract,
  pad,
  dock,
}: PhoneHudProps): ReactElement {
  const [helpOpen, setHelpOpen] = useState(() => !isPhoneHelpHidden())
  const panelShown = (dock?.top ?? null) !== null
  const toggleHelp = (): void => {
    setPhoneHelpHidden(helpOpen)
    setHelpOpen(!helpOpen)
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-20">
      <div
        role="status"
        aria-live="polite"
        className="absolute inset-x-0 top-[calc(max(0.75rem,env(safe-area-inset-top))_+_3.25rem)] z-10 flex justify-center px-3"
      >
        {notice === null ? null : (
          <p className="max-w-md rounded-md border border-danger bg-danger-soft px-4 py-2 text-center text-danger">
            {notice}
          </p>
        )}
      </div>

      <div
        className={`absolute left-[max(0.75rem,env(safe-area-inset-left))] top-[max(0.75rem,env(safe-area-inset-top))] flex h-11 items-center rounded-full border border-border bg-surface-raised/95 px-4 text-sm font-semibold shadow-md ${panelShown ? 'landscape:hidden' : ''}`}
      >
        <span className="numeric">
          Week {week} of {durationWeeks}
        </span>
        <span className="sr-only">, {role}</span>
      </div>

      <div
        role="status"
        aria-live="polite"
        className="absolute left-[max(0.75rem,env(safe-area-inset-left))] top-[calc(max(0.75rem,env(safe-area-inset-top))_+_3.25rem)] text-sm"
      >
        {announcement === '' ? null : (
          <p className="rounded-md border border-brand bg-brand-soft px-3 py-2 text-ink">
            {announcement}
          </p>
        )}
      </div>

      {panelShown ? null : (
        <button
          type="button"
          onClick={toggleHelp}
          aria-expanded={helpOpen}
          aria-label={helpOpen ? 'Hide the 3D controls' : 'Show the 3D controls'}
          className={`${ROUND} absolute ${HELP_RIGHT} top-[max(0.75rem,env(safe-area-inset-top))] border-border bg-surface-raised/95 text-lg font-semibold text-ink-muted`}
        >
          {helpOpen ? '×' : '?'}
        </button>
      )}

      {helpOpen && !panelShown ? (
        <div
          className={`pointer-events-auto absolute ${HELP_RIGHT} top-[calc(max(0.75rem,env(safe-area-inset-top))_+_3.25rem)] max-h-[calc(100dvh-9rem)] landscape:max-h-[calc(100dvh-5.5rem)] max-w-[15rem] overflow-y-auto rounded-md border border-border bg-surface-raised text-xs text-ink-muted shadow-md`}
        >
          <button
            type="button"
            onClick={toggleHelp}
            className="flex w-full flex-col gap-1 px-3 py-2 text-left"
          >
            <span className="font-semibold text-warning">
              <span aria-hidden="true">⚠ </span>
              {PHONE_WARNING}
            </span>
            {Object.values(PHONE_PROMPT_COPY).map((line) => (
              <span key={line}>{line}</span>
            ))}
            <span className="font-semibold">Tap to hide</span>
          </button>
          <div className="flex flex-col gap-2 border-t border-border p-2">
            <a
              href="/player-manual"
              target="_blank"
              rel="noopener"
              className="px-1 py-1 font-semibold text-brand-strong underline-offset-2 hover:underline"
            >
              Player manual
            </a>
            <ModelAttribution />
          </div>
        </div>
      ) : null}

      {panelShown ? null : (
        <div
          aria-hidden="true"
          className="absolute inset-0 m-auto h-1.5 w-1.5 rounded-full border border-ink-inverse bg-ink/60"
        />
      )}

      {/* Only a prompt with no button to offer (paused) is drawn. The Open
          button is announced here, since nothing else says it appeared. */}
      <div
        role="status"
        aria-live="polite"
        className="absolute bottom-[calc(50%+0.75rem)] left-1/2 w-max max-w-full -translate-x-1/2 px-4"
      >
        {openable !== null ? (
          <span className="sr-only">{openLabel}</span>
        ) : prompt === null ? null : (
          <p className="max-w-sm rounded-md border border-border-strong bg-surface-raised/95 px-3 py-2 text-center text-sm">
            {prompt}
          </p>
        )}
      </div>

      {openable === null || panelShown ? null : (
        <button
          type="button"
          onClick={() => onInteract(openable)}
          aria-label={openLabel}
          className="pointer-events-auto absolute left-1/2 top-[calc(50%+1.25rem)] -translate-x-1/2 rounded-full bg-brand px-8 py-3 text-base font-semibold text-ink-inverse shadow-md"
        >
          Open
        </button>
      )}

      {pad === null ? null : (
        <Joystick
          onPress={pad.onPress}
          onRelease={pad.onRelease}
          className="bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))_+_4rem)] left-[max(0.75rem,env(safe-area-inset-left))] landscape:bottom-[max(0.75rem,env(safe-area-inset-bottom))]"
        />
      )}

      {dock === undefined ? null : (
        <nav
          aria-label="Panels"
          className="absolute inset-x-0 bottom-[max(0.75rem,env(safe-area-inset-bottom))] flex justify-center gap-1 landscape:inset-x-auto landscape:bottom-3 landscape:right-[max(0.75rem,env(safe-area-inset-right))] landscape:top-3 landscape:flex-col landscape:flex-wrap-reverse landscape:content-start"
        >
          {DOCK.map(({ id, icon: Icon }) => {
            const shown = dock.top === id
            return (
              <button
                key={id}
                type="button"
                disabled={!dock.enabled}
                onClick={() => dock.onToggle(id)}
                aria-label={PANEL_TITLE[id]}
                title={PANEL_TITLE[id]}
                aria-pressed={shown}
                className={`${ROUND} disabled:opacity-50 landscape:h-10 landscape:w-10 ${
                  id === 'order-desk'
                    ? `border-brand bg-brand text-ink-inverse ${shown ? 'ring-2 ring-ink-inverse' : ''}`
                    : shown
                      ? 'border-brand bg-brand-soft text-brand-strong'
                      : 'border-border bg-surface-raised/95 text-ink-muted'
                }`}
              >
                <Icon size={22} aria-hidden="true" />
              </button>
            )
          })}
        </nav>
      )}
    </div>
  )
}

export default PhoneHud
