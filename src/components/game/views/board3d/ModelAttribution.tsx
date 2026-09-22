import type { ReactElement } from 'react'

interface ModelCredit {
  /** The shipped file, so a credit can be traced back to a mesh. */
  file: string
  title: string
  author: string
  authorUrl: string
  sourceUrl: string
}

/**
 * The four credits, copied verbatim out of `public/3dmodels/ATTRIBUTION.txt`,
 * which is itself copied verbatim out of each `.glb`'s `asset.extras`.
 *
 * Re-typing a licence record is how a licence record gets quietly wrong, so
 * these strings are the file's strings — title, author, author page and source
 * page, character for character. If a model is ever re-exported (24 §6.1), the
 * `asset.extras` must survive the round trip and this list must be re-copied
 * from it, not edited by hand.
 */
const MODEL_CREDITS: readonly ModelCredit[] = [
  {
    file: 'box.glb',
    title: 'Box, Low Poly',
    author: 'FLAREMEDIA',
    authorUrl: 'https://sketchfab.com/flaremedia',
    sourceUrl:
      'https://sketchfab.com/3d-models/box-low-poly-c7a1ecb2355145bc91337e64f57bd0ec',
  },
  {
    file: 'truck.glb',
    title: 'Low Poly Truck',
    author: 'Arifido._',
    authorUrl: 'https://sketchfab.com/Arifido._',
    sourceUrl:
      'https://sketchfab.com/3d-models/low-poly-truck-98826ebd44e2492298ac925461509216',
  },
  {
    file: 'person.glb',
    title: 'FREE Mecha Chameleon Character Model!',
    author: 'xtiborz095',
    authorUrl: 'https://sketchfab.com/xtiborz095',
    sourceUrl:
      'https://sketchfab.com/3d-models/free-mecha-chameleon-character-model-4ebee377a562402980aafea2c1d99e0f',
  },
  {
    file: 'money.glb',
    title: 'Low Poly Stack of Money',
    author: 'Courvois',
    authorUrl: 'https://sketchfab.com/CourvoisZ',
    sourceUrl:
      'https://sketchfab.com/3d-models/low-poly-stack-of-money-632cf7dbc59a496283d1a6092dc6f9b0',
  },
]

/** The licence every one of the four is shipped under. */
const LICENCE_LABEL = 'CC-BY-4.0'
const LICENCE_URL = 'http://creativecommons.org/licenses/by/4.0/'

/** Every outbound link is `noopener`: an attribution credit is not a place to hand a third party a `window.opener` handle. */
const LINK_REL = 'noopener noreferrer'
const LINK_CLASS = 'underline underline-offset-2 hover:text-brand'

/**
 * The model credits, reachable in-app (24 §6.1, AC 20).
 *
 * CC-BY is an attribution licence: shipping these four meshes without visible
 * credit is a licence breach, not a polish item. It is a `<details>` rather
 * than a permanent strip because the credit has to be *reachable*, not
 * constantly in front of a player who is trying to read a supply line — and a
 * `<details>` is reachable by keyboard and readable by a screen reader without
 * any of the machinery a custom disclosure would need.
 */
export function ModelAttribution(): ReactElement {
  return (
    <details className="rounded-md border border-border bg-surface-raised/90 px-3 py-2 text-xs text-ink-muted">
      <summary className="cursor-pointer">3D model credits</summary>
      <ul className="mt-2 flex flex-col gap-2">
        {MODEL_CREDITS.map((credit) => (
          <li key={credit.file} className="flex flex-col">
            <span className="text-ink">{credit.title}</span>
            <span>
              by{' '}
              <a
                className={LINK_CLASS}
                href={credit.authorUrl}
                target="_blank"
                rel={LINK_REL}
              >
                {credit.author}
              </a>{' '}
              —{' '}
              <a className={LINK_CLASS} href={LICENCE_URL} target="_blank" rel={LINK_REL}>
                {LICENCE_LABEL}
              </a>
            </span>
            <a
              className={LINK_CLASS}
              href={credit.sourceUrl}
              target="_blank"
              rel={LINK_REL}
            >
              Source ({credit.file})
            </a>
          </li>
        ))}
      </ul>
    </details>
  )
}

export default ModelAttribution
