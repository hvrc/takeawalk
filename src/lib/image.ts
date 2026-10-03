/** Image helpers: compression for upload, polaroid rendering for save. */

export function loadImage(src: string, crossOrigin?: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (crossOrigin) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load image'))
    img.src = src
  })
}

export interface Compressed {
  blob: Blob
  width: number
  height: number
  previewUrl: string
}

/** Downscale a camera photo to a sensible upload size. Browsers apply EXIF rotation when drawing. */
export async function compressImage(file: File | Blob, maxEdge = 1600, quality = 0.86): Promise<Compressed> {
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.round(img.naturalWidth * scale)
    const h = Math.round(img.naturalHeight * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0, w, h)
    const blob = await canvasToBlob(canvas, 'image/jpeg', quality)
    return { blob, width: w, height: h, previewUrl: URL.createObjectURL(blob) }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), type, quality)
  })
}

export interface PolaroidRenderOptions {
  imageUrl: string
  caption: string
  /** Set when the image comes from another origin (Firebase Storage). */
  crossOrigin?: boolean
}

/**
 * Renders the framed polaroid (square photo, caption in the fat bottom border)
 * to a JPEG blob at 1200x1440.
 */
export async function renderPolaroid(opts: PolaroidRenderOptions): Promise<Blob> {
  const W = 1200
  const H = 1440
  const PAD = 72
  const PHOTO = W - PAD * 2 // 1056, square

  await document.fonts.load('600 92px Caveat').catch(() => undefined)
  const img = await loadImage(opts.imageUrl, opts.crossOrigin)

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!

  // Frame: warm off-white with a hint of gradient like real film stock.
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, '#fcfbf7')
  g.addColorStop(1, '#f3efe6')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)

  // Photo, centre-cropped to a square.
  const side = Math.min(img.naturalWidth, img.naturalHeight)
  const sx = (img.naturalWidth - side) / 2
  const sy = (img.naturalHeight - side) / 2
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.18)'
  ctx.shadowBlur = 6
  ctx.fillStyle = '#111'
  ctx.fillRect(PAD, PAD, PHOTO, PHOTO)
  ctx.restore()
  ctx.drawImage(img, sx, sy, side, side, PAD, PAD, PHOTO, PHOTO)

  // Inner edge: a thin darker line like the real chemical border.
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'
  ctx.lineWidth = 2
  ctx.strokeRect(PAD + 1, PAD + 1, PHOTO - 2, PHOTO - 2)

  // Caption
  const caption = opts.caption.trim()
  if (caption) {
    ctx.fillStyle = '#2b2622'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    let size = 92
    ctx.font = `600 ${size}px Caveat, "Segoe Script", "Bradley Hand", cursive`
    while (ctx.measureText(caption).width > W - PAD * 2 - 40 && size > 48) {
      size -= 4
      ctx.font = `600 ${size}px Caveat, "Segoe Script", "Bradley Hand", cursive`
    }
    const bottomBand = H - (PAD + PHOTO)
    ctx.fillText(caption, W / 2, PAD + PHOTO + bottomBand / 2 + 4, W - PAD * 2 - 24)
  }

  return canvasToBlob(canvas, 'image/jpeg', 0.92)
}

/** Save to the device: share sheet where available (iOS "Save Image"), else download. */
export async function saveBlob(blob: Blob, filename: string): Promise<'shared' | 'downloaded'> {
  const file = new File([blob], filename, { type: blob.type })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file] })
      return 'shared'
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'shared'
      // fall through to download
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return 'downloaded'
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'polaroid'
  )
}
