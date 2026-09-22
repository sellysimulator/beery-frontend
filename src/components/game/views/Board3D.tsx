import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react'
import { Canvas } from '@react-three/fiber'
import { setBoardView } from '../../../utils/storage'
import ErrorBoundary from '../../shared/ErrorBoundary'
import PausedOverlay from '../PausedOverlay'
import Board2D, { type BoardViewProps } from './Board2D'
import Board3DHud from './board3d/Board3DHud'
import Board3DPanels, { type Board3DPanelId } from './board3d/Board3DPanels'
import { observeContextLoss } from './board3d/contextLoss'
import PlayerController from './board3d/PlayerController'
import { isTypingTarget } from './board3d/playerMotion'
import WarehouseScene from './board3d/WarehouseScene'
import {
  buildSceneModel,
  describeScene,
  type InteractTarget,
} from './board3d/sceneModel'

/**
 * The 3D board (24 §6.2) — the second entry in the view seam **D15** froze.
 *
 * It implements `BoardViewProps` and **nothing else**. Not one field is added,
 * not one widened: that is the whole content of the seam (`19 §2.8`, 24 §1.2).
 * If this file ever looks as though it needs a prop `Board2D` does not have,
 * the honest reading is that it has started computing something, and the fix is
 * in `sceneModel.ts` or in the screen above — never in the contract.
 *
 * Its job is assembly, in four layers that are deliberately siblings rather
 * than one nested tree:
 *
 * 1. **The canvas**, `aria-hidden`, inside a wrapper that carries `role="img"`
 *    and `describeScene(model)` as its label (§5.4).
 * 2. **`Board3DPanels`** — the one-DOM-copy layer. It is a sibling of the
 *    canvas wrapper and not a child of it, because a child of `role="img"` is
 *    a child a screen reader never reaches, and AC 17 wants the ledger, the
 *    "what you have" panel and the history table reachable at all times.
 * 3. **`Board3DHud`** — every word on this board that is not painted on a wall.
 * 4. **`PausedOverlay`**, reused verbatim from the 2D board, so the server's
 *    reason reads identically in both (AC 18).
 *
 * The model is built once per render by `buildSceneModel` and handed down. This
 * component works nothing out for itself, for the same reason `WarehouseScene`
 * does not: a figure decided here is a figure `Board3D.test.tsx` cannot see,
 * because jsdom has no WebGL and that file may never import this one (§8.1).
 */

/**
 * What renders when WebGL is not available, or the context is lost (24 §7.6.3).
 *
 * Two things, and the second is the one that matters. It renders `Board2D` with
 * the identical props — no state is lost, because no state lives here; the
 * server holds every figure on the screen, which is what the boundary's own
 * copy already says — and it writes `'2D'` to storage, so **the next load does
 * not walk back into the same wall**. A lost WebGL context must not cost a
 * player their week (AC 21).
 *
 * The write is in an effect rather than in the render body: a storage write
 * during render is a side effect React is free to run twice, and this one is
 * the player's persisted preference.
 *
 * It does not push the change back into `useBoardViewChoice`'s state, so the
 * toggle in `GameRoomPlaying` still offers *"Switch to the 2D board"* until the
 * next load. §7.6.3 scopes the write to the next load deliberately, and closing
 * that gap would mean a field on `BoardViewProps` that 24 §2.1 forbids.
 *
 * It is reached two ways, and the second is the one an error boundary cannot
 * see — see `onContextLost` below.
 */
function WebGLFallback(props: BoardViewProps): ReactElement {
  useEffect(() => {
    setBoardView('2D')
  }, [])

  return <Board2D {...props} />
}

export function Board3D(props: BoardViewProps): ReactElement {
  const { view, week, durationWeeks, paused, pausedReason, gameOver, notice, weekChanged } =
    props

  /**
   * Everything the canvas shows, from the props and from nothing else.
   *
   * Keyed on the props **object**, which is the right granularity and not a
   * shortcut: React hands back the same object when this component re-renders
   * from its own state, so walking past a target or opening a panel does not
   * rebuild the scene, while a new `your_state` from the store does. Nothing
   * here re-renders per frame — the frame loop is r3f's and never React's
   * (§5.1, §7.4).
   */
  const model = useMemo(() => buildSceneModel(props), [props])

  /**
   * The wrapper, not the `<canvas>`: the canvas is `aria-hidden` (§5.4), so the
   * scene's keyboard and focus host is the element around it. `Board3DPanels`
   * hands focus back here when a panel closes (§5.3).
   */
  const canvasHost = useRef<HTMLDivElement>(null)

  /** The nearest interact target, as `PlayerController` reports it — which is
   *  only when the answer changes (§5.1, Tequila defect 8). */
  const [nearId, setNearId] = useState<Board3DPanelId | null>(null)

  /** True once the GPU has taken the context away under a mounted canvas. The
   *  one piece of state on this board that outranks everything below it, so it
   *  is read last, in the early return, and never merged into the tree. */
  const [contextLost, setContextLost] = useState(false)

  /**
   * The open panels, oldest first. `Board3DPanelId` and `InteractTargetId` are
   * the same three-member union under two names — the zone you stand in and the
   * panel it opens are one list (§3.2), and 24 §6.2 gives each module its own
   * name for it.
   */
  const [openPanels, setOpenPanels] = useState<readonly Board3DPanelId[]>([])
  const anyPanelOpen = openPanels.length > 0

  const nearTarget: InteractTarget | null =
    model.interactTargets.find((target) => target.id === nearId) ?? null

  /** What the key handler needs at the moment `E` is pressed, held in a ref so
   *  the listener is bound once for the life of the board. Re-binding it every
   *  time a week closes — which is every time the model is rebuilt — would drop
   *  a keypress in the gap. The same shape `PlayerController` uses. */
  const latest = useRef<{
    targets: readonly InteractTarget[]
    nearId: Board3DPanelId | null
  }>({ targets: model.interactTargets, nearId })
  useEffect(() => {
    latest.current = { targets: model.interactTargets, nearId }
  })

  /**
   * `E` is owned here, at the window, and **not** passed to
   * `PlayerController.onInteract`. That prop exists so the controller can bind
   * the key when nothing above it does; two handlers for one key open and shut
   * the same panel in one tick, and the controller's own comment says so.
   *
   * `Escape` is *not* bound here. `Board3DPanels` already owns it, because the
   * close it performs and the focus it returns to `canvasHost` are one action,
   * and splitting them across two files would give this board two definitions
   * of "the most recently opened panel" (§5.3).
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTypingTarget(event.target)) return
      if (event.key.toLowerCase() !== 'e') return

      const { targets, nearId: standingAt } = latest.current
      if (standingAt === null) return
      const target = targets.find((candidate) => candidate.id === standingAt)
      // `enabled` is false while paused: the prompt still reads and E is inert,
      // which is §5.2's own wording and AC 18's other half.
      if (!target || !target.enabled) return

      event.preventDefault()
      setOpenPanels((current) =>
        current.includes(standingAt) ? current : [...current, standingAt],
      )
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const closePanel = useCallback((panel: Board3DPanelId): void => {
    setOpenPanels((current) => current.filter((id) => id !== panel))
  }, [])

  /**
   * The other half of 24 §7.6.3, and the half an `ErrorBoundary` cannot do.
   *
   * A boundary catches a **render** throw — WebGL missing when the canvas
   * first mounts. It never hears about a context the GPU takes away twenty
   * minutes later, on a driver reset or a laptop switching graphics adapters,
   * because nothing throws: the canvas simply stops painting and the player is
   * left staring at a frozen warehouse with a week to submit. §7.6.3 is
   * explicit that **a lost WebGL context must not cost a player their week**,
   * so the loss is routed into the same `WebGLFallback` the boundary uses —
   * `Board2D` with the identical props, and `'2D'` written to storage.
   *
   * The subscription itself is `contextLoss.ts`'s, not this file's, and that
   * is deliberate: §8.1 forbids a test to import this module, so a listener
   * written inline here is a listener nothing can ever fire. What stays is the
   * state and the branch below — a `useState` is state, and state belongs to
   * the thing that renders.
   */
  useEffect(() => {
    const host = canvasHost.current
    if (host === null) return

    return observeContextLoss(host, () => setContextLost(true))
  }, [])

  // Read after every hook and before every element: a board with no context is
  // not a board with a broken canvas in it, it is the 2D board (§7.6.3).
  if (contextLost) return <WebGLFallback {...props} />

  return (
    <ErrorBoundary fallback={<WebGLFallback {...props} />}>
      <div className="relative min-h-screen bg-surface">
        {/*
          `role="img"` with `describeScene(model)` as the label, over a canvas
          that is `aria-hidden` (§5.4). One sentence is all a screen reader gets
          from the scene, and that is honest: the figures themselves are in the
          panels below, mounted at all times, exactly once.

          `tabIndex={-1}` so `Board3DPanels` can hand focus back here when a
          panel closes without putting a non-interactive region in the tab
          order — the keys this board reads are bound at the window.
        */}
        <div
          ref={canvasHost}
          role="img"
          aria-label={describeScene(model)}
          tabIndex={-1}
          className="fixed inset-0 outline-none"
        >
          <Canvas
            // 24 §7.5, figure for figure. `far: 120`, not Tequila's 200 — the
            // room is 44 × 30, and a far plane six times the hall buys nothing
            // but depth precision lost at the near end.
            camera={{ position: [0, 1.7, 9], fov: 72, near: 0.1, far: 120 }}
            gl={{ antialias: true, powerPreference: 'high-performance' }}
            // Capped at 1.5 so a 2× display does not quadruple the fill cost of
            // a scene made of flat-shaded polygons.
            dpr={[1, 1.5]}
            // Nothing moves while the game is paused or a panel is open, so
            // nothing is drawn: the render loop stops rather than spinning a
            // laptop fan behind a modal (§5.3, §7.5).
            frameloop={paused || anyPanelOpen ? 'demand' : 'always'}
            // Halve the internal resolution before dropping frames (§7.6.4).
            performance={{ min: 0.5 }}
            // Off, and `castShadow` is written nowhere in this directory —
            // Tequila sets it on meshes while never enabling shadows, which is
            // dead code that reads like a feature (§7.4).
            shadows={false}
            aria-hidden="true"
          >
            {/*
              The `<Suspense>` §7.4 requires *inside* the Canvas: the four GLBs
              and troika's SDF font both suspend, and a suspension inside r3f's
              own reconciler root does not reach a boundary in the DOM tree.

              Its fallback is `null` rather than `SceneLoading`, because
              everything rendered under this boundary is rendered by three.js:
              a `<div>` here is not a `<div>`, it is a lookup in the THREE
              namespace that throws. `SceneLoading` is DOM, and it is mounted
              where DOM belongs — `GameRoomPlaying`'s boundary around the lazy
              chunk, which is the *outer* of the two §7.4 asks for. The models
              are already in flight by then: `gltfModels.ts` calls
              `useGLTF.preload()` at module scope, so the fetches start with the
              chunk rather than with the first frame that needs a mesh (§7.3).
            */}
            <Suspense fallback={null}>
              <WarehouseScene model={model}>
                {/*
                  The controller lives inside the scene because the camera it
                  drives is the scene's. It reports proximity against the
                  model's own radii, and it is given no `onInteract`: `E` is
                  bound above.
                */}
                <PlayerController
                  targets={model.interactTargets}
                  onNearObject={setNearId}
                  paused={paused}
                  gameOver={gameOver}
                />
              </WarehouseScene>
            </Suspense>
          </Canvas>
        </div>

        {/*
          A sibling of the canvas wrapper, never a child: words are DOM, and a
          refusal or a week change must not be something a player can miss by
          facing the wrong way (§5.6, AC 16). The prompt is the one the model
          already worded — this file does not compose a second copy of it.
        */}
        <Board3DHud
          view={view}
          week={week}
          durationWeeks={durationWeeks}
          prompt={nearTarget?.prompt ?? null}
          notice={notice}
          weekChanged={weekChanged}
        />

        {/*
          The one-DOM-copy layer (§5.4). `{...props}` deliberately: the panels
          render the *existing* 2D components with the *same* props the 2D board
          gives them, which is what keeps the two boards from drifting and what
          AC 14 asks for. Spreading is the honest spelling of "the same props",
          and it is what makes a widened `BoardViewProps` impossible to sneak
          in here unnoticed.
        */}
        <Board3DPanels
          {...props}
          open={openPanels}
          onClose={closePanel}
          canvasRef={canvasHost}
        />

        {/* Reused verbatim, so the server's reason reads identically on both
            boards (§5.2, AC 18). `z-40`, above the panels and below the
            2D/3D toggle. */}
        {paused ? <PausedOverlay reason={pausedReason} /> : null}
      </div>
    </ErrorBoundary>
  )
}

export default Board3D
