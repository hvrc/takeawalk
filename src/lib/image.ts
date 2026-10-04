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

/**
 * Downscale a camera photo to a sensible upload size, keeping its original
 * proportions (the polaroid crops to a square only on screen and when saved as
 * a polaroid). Browsers apply EXIF rotation when drawing.
 */
export async function compressImage(file: File | Blob, maxEdge = 2560, quality = 0.9): Promise<Compressed> {
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
 * Renders the framed polaroid to a JPEG at Polaroid 600 proportions
 * (88 x 107 mm frame, 79 mm square photo): 1200 x 1459, ink keyline border,
 * caption centred in the deep bottom strip.
 */
export async function renderPolaroid(opts: PolaroidRenderOptions): Promise<Blob> {
  const W = 1200
  const H = Math.round((W * 107) / 88)
  const SIDE = Math.round(W * 0.051)
  const TOP = Math.round(W * 0.068)
  const PHOTO = W - SIDE * 2
  const PAD = SIDE

  await document.fonts.load('600 92px Caveat').catch(() => undefined)
  const img = await loadImage(opts.imageUrl, opts.crossOrigin)

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#fbf8f0'
  ctx.fillRect(0, 0, W, H)

  // Photo, centre-cropped to a square.
  const side = Math.min(img.naturalWidth, img.naturalHeight)
  const sx = (img.naturalWidth - side) / 2
  const sy = (img.naturalHeight - side) / 2
  ctx.fillStyle = '#1b1916'
  ctx.fillRect(SIDE, TOP, PHOTO, PHOTO)
  ctx.drawImage(img, sx, sy, side, side, SIDE, TOP, PHOTO, PHOTO)
  // Ink keyline around the whole card.
  ctx.strokeStyle = '#2b2622'
  ctx.lineWidth = 12
  ctx.strokeRect(6, 6, W - 12, H - 12)

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
    const bottomBand = H - (TOP + PHOTO)
    ctx.fillText(caption, W / 2, TOP + PHOTO + bottomBand / 2 + 4, W - PAD * 2 - 24)
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
