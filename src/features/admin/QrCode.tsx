import QRCode from 'qrcode'
import { useMemo } from 'react'

/**
 * Draws a QR code as an inline SVG, entirely in the browser: the authenticator secret never
 * goes to a third party, and no image or script source beyond this page is needed.
 */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { size, path } = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: 'M' })
    const count = qr.modules.size
    let d = ''
    for (let row = 0; row < count; row += 1) {
      for (let column = 0; column < count; column += 1) {
        if (qr.modules.get(row, column)) d += `M${column + 2} ${row + 2}h1v1h-1z`
      }
    }
    return { size: count + 4, path: d }
  }, [value])

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className="size-48 rounded-xl border border-line"
    >
      {/* Always dark on light, so it scans in dark mode too. */}
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#111111" />
    </svg>
  )
}
