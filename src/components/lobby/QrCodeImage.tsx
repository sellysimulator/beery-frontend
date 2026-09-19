import { useMemo, type ReactElement } from 'react'
import { encodeQr } from './qrcode'

export interface QrCodeImageProps {
  value: string
  /** Rendered edge length in pixels, including the quiet zone. */
  size?: number
  label: string
}

/** Four light modules on every side, which every decoder expects. */
const QUIET_ZONE = 4

/**
 * The invite link as a QR symbol, drawn as a single SVG path so it stays
 * crisp when a host projects it at the front of a room.
 *
 * Rendered light-on-dark would not scan: decoders expect dark modules on a
 * light background, so the symbol keeps its own white plate regardless of the
 * surrounding theme.
 */
export function QrCodeImage({ value, size = 220, label }: QrCodeImageProps): ReactElement {
  const modules = useMemo(() => encodeQr(value), [value])

  if (!modules) {
    return (
      <p className="text-sm text-ink-muted">
        That link is too long to show as a QR code. Share the link itself instead.
      </p>
    )
  }

  const span = modules.length + QUIET_ZONE * 2
  let path = ''
  for (let row = 0; row < modules.length; row += 1) {
    const line = modules[row]!
    for (let col = 0; col < line.length; col += 1) {
      if (!line[col]) continue
      path += `M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`
    }
  }

  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${span} ${span}`}
      shapeRendering="crispEdges"
      className="rounded-md"
    >
      <rect width={span} height={span} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  )
}

export default QrCodeImage
