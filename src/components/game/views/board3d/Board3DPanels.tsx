import { useEffect, useRef, type ReactElement, type RefObject } from 'react'
import DecisionForm from '../../DecisionForm'
import DecisionPanel from '../../DecisionPanel'
import GameOverPanel from '../../GameOverPanel'
import OwnHistoryChart from '../../OwnHistoryChart'
import SettlementRecap from '../../SettlementRecap'
import WaitingForOthers from '../../WaitingForOthers'
import type { BoardViewProps } from '../Board2D'

/** The three interact targets that open a DOM panel. */
export type Board3DPanelId = 'order-desk' | 'ledger-wall' | 'team-board'

export interface Board3DPanelsProps extends BoardViewProps {
  /**
   * The open panels, oldest first. A stack rather than a single id because
   * `Escape` closes *the most recently opened* panel, which is
   * only a meaningful sentence if more than one can be open.
   */
  open: readonly Board3DPanelId[]
  onClose(panel: Board3DPanelId): void
  /**
   * The canvas wrapper, so closing can hand focus back to the thing that was
   * driving the camera. It is the scene's keyboard host, not the
   * `<canvas>` itself, which is `aria-hidden`.
   */
  canvasRef: RefObject<HTMLElement | null>
}

/**
 * Each panel's heading. Exported because the HUD's Open button names the panel
 * it opens by this same title — one copy, so the button and the
 * heading it opens onto cannot disagree.
 */
// eslint-disable-next-line react-refresh/only-export-components
export const PANEL_TITLE: Record<Board3DPanelId, string> = {
  'order-desk': 'The order desk',
  'ledger-wall': 'The ledger wall',
  'team-board': 'The team board',
}

/**
 * Where each panel sits when it is open.
 *
 * Three fixed, non-overlapping berths rather than one modal slot: a player who
 * walked to the ledger wall and then to the desk should be able to read the
 * settlement while typing the order, which is the whole argument for
 * reusing the 2D components instead of summarising them in-scene. They sit at
 * `z-30`, under `PausedOverlay`'s `z-40`, because a paused game is not a game
 * you can act in.
 *
 * Below `lg` the berths cannot all be separate — at 375 px every panel is the
 * full width — so there they may overlap, and the panel on top is the one
 * most recently opened (`TOP_PANEL_LAYER`), which is also the one `Escape`
 * closes. Heights use `dvh`, not `vh`: on a phone `100vh` counts the space
 * behind the browser's own toolbar, and a panel sized to it hides its last
 * row — the Submit button — under that toolbar. The order desk sits
 * one toggle-height up below `lg`, because there it spans the corner the
 * 2D/3D toggle (`z-50`) occupies, and the toggle would cover its button.
 */
const PANEL_CHROME =
  'rounded-lg border border-border-strong bg-surface-raised p-4 shadow-lg overflow-y-auto'

const PANEL_POSITION: Record<Board3DPanelId, string> = {
  'order-desk':
    'fixed bottom-[calc(max(1rem,env(safe-area-inset-bottom))_+_3.5rem)] left-1/2 w-[min(32rem,calc(100vw-2rem))] max-h-[calc(100dvh-6rem)] -translate-x-1/2 lg:bottom-[max(1.5rem,env(safe-area-inset-bottom))] lg:max-h-[calc(100dvh-9rem)]',
  'ledger-wall':
    'fixed left-[max(1rem,env(safe-area-inset-left))] top-[max(1rem,env(safe-area-inset-top))] w-[min(26rem,calc(100vw-2rem))] max-h-[calc(100dvh-6rem)] sm:top-[calc(max(1rem,env(safe-area-inset-top))_+_5rem)] sm:max-h-[calc(100dvh-12rem)]',
  'team-board':
    'fixed right-[max(1rem,env(safe-area-inset-right))] top-[max(1rem,env(safe-area-inset-top))] w-[min(30rem,calc(100vw-2rem))] max-h-[calc(100dvh-6rem)] sm:top-[calc(max(1rem,env(safe-area-inset-top))_+_5rem)] sm:max-h-[calc(100dvh-12rem)]',
}

/** The layer of an open panel: the most recently opened one above the rest,
 *  all of them under `PausedOverlay`'s `z-40`. */
const TOP_PANEL_LAYER = 'z-[35]'
const PANEL_LAYER = 'z-30'

/**
 * What the panel's focus move counts as "the panel's first focusable element".
 * Deliberately literal: the first thing a `Tab` would reach inside the wrapper,
 * which is the panel's own Close button.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * The one-DOM-copy layer (spec §9.7) — the most load-bearing idea in this board.
 *
 * A WebGL scene is opaque to a screen reader and first-person WASD is not an
 * accessible interaction model, and this file does not pretend otherwise. The
 * fallback is not a description of the scene: it is the 2D content itself,
 * always mounted. `SettlementRecap`, `DecisionPanel`, `OwnHistoryChart` and the
 * order-desk control are mounted **exactly once**, inside a wrapper whose class
 * is `sr-only` while its panel is closed and a floating-panel class while it is
 * open. One DOM copy, two presentations.
 *
 * That is not a saving, it is a correctness property. Rendering the panels
 * twice — once hidden for the reader, once visible for the player — would put
 * two `aria-label="What you have"` landmarks and two copies of the history
 * table in the document, and the reader must reach each of them
 * *exactly once*. It would also give the week two `DecisionForm`s with the same
 * remount key and two `<input>`s with the same label.
 *
 * Nothing here is a 3D re-implementation of a form. The order desk renders the
 * same `GameOverPanel` / `WaitingForOthers` / `DecisionForm` that `Board2D`
 * renders, with the same `${week}-${change|new}` remount key, because a
 * re-implementation is a second place for the 2D board's behaviour to
 * be wrong.
 */
export function Board3DPanels({
  view,
  week,
  paused,
  locked,
  isChangingOrder,
  gameOver,
  awaitingRoles,
  initialOrder,
  notice,
  canChangeOrder,
  weekChanged,
  onSubmitOrder,
  onChangeOrder,
  onKeepOrder,
  open,
  onClose,
  canvasRef,
}: Board3DPanelsProps): ReactElement {
  const wrappers = useRef(new Map<Board3DPanelId, HTMLDivElement | null>())
  const lastFocused = useRef<Board3DPanelId | null>(null)

  // The most recently opened panel: the one `Escape` closes, and the one that
  // takes focus when it opens.
  const topPanel = open.length === 0 ? null : (open[open.length - 1] ?? null)

  useEffect(() => {
    if (topPanel === null) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      onClose(topPanel)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [topPanel, onClose])

  useEffect(() => {
    // Only on a *change* of which panel is on top. Re-focusing on every render
    // would fight the player's own tabbing, and would steal the caret out of
    // the order input on every keystroke.
    if (topPanel === lastFocused.current) return
    lastFocused.current = topPanel
    if (topPanel === null) {
      canvasRef.current?.focus()
      return
    }
    const wrapper = wrappers.current.get(topPanel)
    wrapper?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
  }, [topPanel, canvasRef])

  const panelClass = (panel: Board3DPanelId): string =>
    open.includes(panel)
      ? `${PANEL_POSITION[panel]} ${panel === topPanel ? TOP_PANEL_LAYER : PANEL_LAYER} ${PANEL_CHROME}`
      : 'sr-only'

  /**
   * The panel's chrome — heading and Close — renders only while it is open. A
   * Close button for a panel that is not open is nonsense read aloud, and the
   * `sr-only` presentation is the always-available 2D content, not a dialog.
   */
  const chrome = (panel: Board3DPanelId): ReactElement | null =>
    open.includes(panel) ? (
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink-muted">{PANEL_TITLE[panel]}</h2>
        <button
          type="button"
          className="rounded-md border border-border-strong px-2 py-1 text-sm hover:border-brand hover:text-brand any-pointer-coarse:min-h-11 any-pointer-coarse:px-4"
          onClick={() => onClose(panel)}
        >
          Close
        </button>
      </div>
    ) : null

  return (
    <div>
      <div
        ref={(node) => {
          wrappers.current.set('ledger-wall', node)
        }}
        data-panel="ledger-wall"
        className={panelClass('ledger-wall')}
      >
        {chrome('ledger-wall')}
        <div className="flex flex-col gap-6">
          <SettlementRecap view={view} highlight={weekChanged} />
          <DecisionPanel view={view} />
        </div>
      </div>

      <div
        ref={(node) => {
          wrappers.current.set('order-desk', node)
        }}
        data-panel="order-desk"
        className={panelClass('order-desk')}
      >
        {chrome('order-desk')}
        {gameOver ? (
          <GameOverPanel />
        ) : locked ? (
          <WaitingForOthers
            myRole={view.role}
            awaitingRoles={awaitingRoles}
            notice={notice}
            canChange={canChangeOrder}
            onChangeOrder={onChangeOrder}
          />
        ) : (
          <DecisionForm
            // A new week, or a reopened order, starts a fresh input — the same
            // remount key `Board2D` uses, deliberately character for character.
            key={`${week}-${isChangingOrder ? 'change' : 'new'}`}
            view={view}
            disabled={paused}
            initialOrder={initialOrder}
            isChange={isChangingOrder}
            notice={notice}
            onSubmit={onSubmitOrder}
            onCancel={onKeepOrder}
          />
        )}
      </div>

      <div
        ref={(node) => {
          wrappers.current.set('team-board', node)
        }}
        data-panel="team-board"
        className={panelClass('team-board')}
      >
        {chrome('team-board')}
        <OwnHistoryChart history={view.own_history} />
      </div>
    </div>
  )
}

export default Board3DPanels
