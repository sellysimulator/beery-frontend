import type { ManualPageSpec } from './ManualBook'

/**
 * The table of contents, built from the body pages rather than written by
 * hand, so a page that moves cannot leave a wrong number behind.
 *
 * `offset` is how many pages precede the body — the cover and this page.
 * Continuation pages are listed under the entry they continue.
 */
export function contentsPage(body: ManualPageSpec[], offset = 2): ManualPageSpec {
  return {
    id: 'contents',
    heading: 'Contents',
    content: (
      <ul className="flex flex-col gap-2">
        {body.map((page, index) =>
          page.heading && !page.heading.endsWith(', continued') ? (
            <li key={page.id} className="flex items-baseline gap-3">
              <span className="w-5 shrink-0 text-right text-xs text-ink-subtle">
                {index + offset + 1}
              </span>
              <span>{page.heading}</span>
              <span className="flex-1 border-b border-dotted border-border" />
            </li>
          ) : null,
        )}
      </ul>
    ),
  }
}
