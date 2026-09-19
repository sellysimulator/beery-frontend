import { useState, type ReactElement } from 'react'

export interface AvatarProps {
  photoUrl: string | null
  displayName: string
  /** Edge length in pixels. */
  size?: number
}

function initialOf(displayName: string): string {
  const trimmed = displayName.trim()
  return trimmed ? trimmed[0]!.toUpperCase() : '?'
}

/**
 * A profile picture with an initial fallback.
 *
 * `lh3.googleusercontent.com` answers 429 to requests carrying a `Referer` it
 * dislikes, which happens routinely on localhost, so the image is requested
 * with `referrerPolicy="no-referrer"` and any error falls back to the initial
 * rather than leaving a broken image.
 */
export function Avatar({ photoUrl, displayName, size = 40 }: AvatarProps): ReactElement {
  const [failed, setFailed] = useState(false)
  const box = { width: `${size}px`, height: `${size}px` }

  if (photoUrl && !failed) {
    return (
      <img
        src={photoUrl}
        alt={displayName}
        style={box}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="shrink-0 rounded-full border border-border object-cover"
      />
    )
  }

  return (
    <span
      role="img"
      aria-label={displayName}
      style={{ ...box, fontSize: `${Math.round(size * 0.4)}px` }}
      className="inline-flex shrink-0 items-center justify-center rounded-full border border-border bg-surface-raised font-semibold text-ink"
    >
      {initialOf(displayName)}
    </span>
  )
}

export default Avatar
