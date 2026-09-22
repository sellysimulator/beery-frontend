import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import HTMLFlipBook from 'react-pageflip'

/**
 * The page-turning frame both manuals are read in.
 *
 * `react-pageflip` (the StPageFlip wrapper Selly uses for its two manuals) is
 * driven off measured pixel sizes: it lays a spread out at a fixed leaf size
 * and animates the turn against real geometry. That has two consequences this
 * component exists to absorb.
 *
 *  1. A spread needs room for two leaves side by side. A phone does not have
 *     it, and a manual is read on a phone on the way to the session.
 *  2. Where there is no layout at all — jsdom, or a first paint before the
 *     container has been measured — there is nothing for it to flip.
 *
 * So the mode is decided by measuring the container rather than by sniffing
 * the user agent: a spread's worth of width gets the book, anything less (a
 * phone, a narrow split window, a test renderer that reports zero) gets the
 * same pages stacked and scrolled. Both modes render every page's copy, so
 * nothing a reader needs depends on which one they got.
 */

/** One leaf. Sized in pixels because StPageFlip animates against geometry. */
export const PAGE_WIDTH = 430
export const PAGE_HEIGHT = 620

/** Below a spread plus its shadow, the book is not worth showing. */
const SPREAD_BREAKPOINT = PAGE_WIDTH * 2 + 48

export interface ManualPageSpec {
  /** Stable key, and the anchor id in scroll mode. */
  id: string
  /** Omitted on the covers, which carry their own title. */
  heading?: string
  variant?: 'cover' | 'back'
  content: ReactNode
}

export interface ManualBookProps {
  /** Shown on the running head of every inside page. */
  title: string
  pages: ManualPageSpec[]
}

/** The running head + page number an inside leaf carries. */
function PageChrome({
  title,
  heading,
  number,
  children,
}: {
  title: string
  heading?: string
  number: number
  children: ReactNode
}): ReactElement {
  return (
    <>
      <div className="flex items-baseline justify-between border-b border-border px-6 pt-5 pb-3">
        <span className="text-[0.65rem] font-semibold tracking-widest text-ink-subtle uppercase">
          {title}
        </span>
        <span className="text-[0.65rem] text-ink-subtle">{number}</span>
      </div>
      {heading ? <h2 className="px-6 pt-4 text-lg font-semibold">{heading}</h2> : null}
      <div className="flex flex-col gap-3 px-6 py-4 text-sm leading-relaxed">{children}</div>
    </>
  )
}

/**
 * A page's body, identical in both modes.
 *
 * In book mode it is clipped to a leaf and scrolls if a section overruns; in
 * scroll mode it flows, so a long page is never cut off on the device least
 * able to afford a cut-off.
 */
function PageBody({
  page,
  title,
  number,
  mode,
}: {
  page: ManualPageSpec
  title: string
  number: number
  mode: 'book' | 'scroll'
}): ReactElement {
  const cover = page.variant === 'cover' || page.variant === 'back'

  if (cover) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-4 bg-brand-soft px-8 text-center ${
          mode === 'book' ? 'h-full' : 'py-12'
        }`}
      >
        {page.content}
      </div>
    )
  }

  return (
    <div className={mode === 'book' ? 'h-full overflow-y-auto' : ''}>
      <PageChrome title={title} heading={page.heading} number={number}>
        {page.content}
      </PageChrome>
    </div>
  )
}

export function ManualBook({ title, pages }: ManualBookProps): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null)
  const bookRef = useRef<{
    pageFlip: () => { flipNext: () => void; flipPrev: () => void }
  }>(null)
  const [mode, setMode] = useState<'book' | 'scroll'>('scroll')
  // The index StPageFlip reports on every turn: the left leaf of the open
  // spread, or the cover.
  const [current, setCurrent] = useState(0)

  useEffect(() => {
    const measure = () => {
      const width = hostRef.current?.getBoundingClientRect().width ?? 0
      setMode(width >= SPREAD_BREAKPOINT ? 'book' : 'scroll')
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const flip = useCallback((direction: 'next' | 'prev') => {
    const controller = bookRef.current?.pageFlip()
    if (!controller) return
    if (direction === 'next') controller.flipNext()
    else controller.flipPrev()
  }, [])

  // Keyboard is the only way through the book for a reader who is not using a
  // pointer: StPageFlip's own affordances are a drag and a corner click.
  useEffect(() => {
    if (mode !== 'book') return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') flip('next')
      if (event.key === 'ArrowLeft') flip('prev')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, flip])

  if (mode === 'scroll') {
    return (
      <div ref={hostRef} className="flex flex-col gap-6">
        {pages.map((page, index) => (
          <section
            key={page.id}
            id={page.id}
            className="overflow-hidden rounded-xl border border-border bg-surface-raised"
          >
            <PageBody page={page} title={title} number={index + 1} mode="scroll" />
          </section>
        ))}
      </div>
    )
  }

  return (
    <div ref={hostRef} className="flex flex-col items-center gap-6">
      <div className="shadow-2xl">
        <HTMLFlipBook
          ref={bookRef}
          width={PAGE_WIDTH}
          height={PAGE_HEIGHT}
          size="fixed"
          minWidth={PAGE_WIDTH}
          maxWidth={PAGE_WIDTH}
          minHeight={PAGE_HEIGHT}
          maxHeight={PAGE_HEIGHT}
          drawShadow
          flippingTime={600}
          usePortrait={false}
          startZIndex={0}
          autoSize={false}
          maxShadowOpacity={0.4}
          showCover
          mobileScrollSupport={false}
          clickEventForward
          useMouseEvents
          swipeDistance={30}
          showPageCorners
          // A click inside a page of prose selects text; it must not also turn
          // the page out from under the sentence being read. The corners, the
          // drag and the two buttons below are the ways through.
          disableFlipByClick
          startPage={0}
          className=""
          style={{}}
          onFlip={(event: { data: number }) => setCurrent(event.data)}
        >
          {pages.map((page, index) => (
            <div
              key={page.id}
              className="h-full w-full overflow-hidden bg-surface-raised text-ink select-none"
              style={{ boxShadow: 'inset 0 0 30px rgba(0,0,0,0.06)' }}
            >
              <PageBody page={page} title={title} number={index + 1} mode="book" />
            </div>
          ))}
        </HTMLFlipBook>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => flip('prev')}
          className="rounded-lg border border-border-strong bg-surface-raised px-5 py-2 text-sm hover:border-brand hover:text-brand"
        >
          ← Previous
        </button>
        <span className="text-sm text-ink-subtle">
          Page {current + 1} of {pages.length}
        </span>
        <button
          type="button"
          onClick={() => flip('next')}
          className="rounded-lg border border-border-strong bg-brand px-5 py-2 text-sm text-ink-inverse hover:bg-brand-strong"
        >
          Next →
        </button>
      </div>
    </div>
  )
}

export default ManualBook
