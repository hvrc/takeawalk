/**
 * Reads where and when a JPEG was taken from its EXIF block, if the camera
 * wrote one and the browser didn't strip it. Returns nulls when it's missing.
 * (Only the few tags we need: GPS position/accuracy and DateTimeOriginal.)
 */
export interface PhotoMeta {
  lat: number | null
  lng: number | null
  /** Horizontal accuracy in metres, when the camera recorded it. */
  acc: number | null
  takenAt: number | null
}

const NONE: PhotoMeta = { lat: null, lng: null, acc: null, takenAt: null }

export async function readPhotoMeta(file: Blob): Promise<PhotoMeta> {
  try {
    const buf = await file.slice(0, 256 * 1024).arrayBuffer()
    return parse(new DataView(buf))
  } catch {
    return NONE
  }
}

function parse(v: DataView): PhotoMeta {
  if (v.getUint16(0) !== 0xffd8) return NONE // not a JPEG
  let off = 2
  while (off + 4 < v.byteLength) {
    const marker = v.getUint16(off)
    const len = v.getUint16(off + 2)
    if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) return tiff(v, off + 10) // "Exif"
    if ((marker & 0xff00) !== 0xff00) break
    off += 2 + len
  }
  return NONE
}

function tiff(v: DataView, start: number): PhotoMeta {
  const le = v.getUint16(start) === 0x4949
  const u16 = (o: number) => v.getUint16(start + o, le)
  const u32 = (o: number) => v.getUint32(start + o, le)
  const rational = (o: number) => {
    const d = u32(o + 4)
    return d ? u32(o) / d : 0
  }
  const ascii = (o: number, n: number) => {
    let s = ''
    for (let i = 0; i < n; i++) {
      const c = v.getUint8(start + o + i)
      if (!c) break
      s += String.fromCharCode(c)
    }
    return s
  }
  // Read one IFD into tag -> value-offset (relative to TIFF start).
  const ifd = (o: number) => {
    const tags = new Map<number, { type: number; count: number; at: number }>()
    const n = u16(o)
    for (let i = 0; i < n; i++) {
      const e = o + 2 + i * 12
      const type = u16(e + 2)
      const count = u32(e + 4)
      const size = ({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 } as Record<number, number>)[type] ?? 1
      tags.set(u16(e), { type, count, at: size * count > 4 ? u32(e + 8) : e + 8 })
    }
    return tags
  }

  const out: PhotoMeta = { ...NONE }
  const ifd0 = ifd(u32(4))
  const exifPtr = ifd0.get(0x8769)
  if (exifPtr) {
    const exif = ifd(u32(exifPtr.at))
    const dt = exif.get(0x9003) ?? ifd0.get(0x0132) // DateTimeOriginal, else DateTime
    const offs = exif.get(0x9011) // OffsetTimeOriginal, e.g. "-04:00"
    if (dt) {
      const m = /(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(ascii(dt.at, dt.count))
      if (m) {
        const tz = offs ? ascii(offs.at, offs.count) : ''
        const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${/^[+-]\d\d:\d\d$/.test(tz) ? tz : ''}`
        const t = Date.parse(iso)
        if (!Number.isNaN(t)) out.takenAt = t
      }
    }
  }
  const gpsPtr = ifd0.get(0x8825)
  if (gpsPtr) {
    const gps = ifd(u32(gpsPtr.at))
    const dms = (tag: number) => {
      const t = gps.get(tag)
      return t ? rational(t.at) + rational(t.at + 8) / 60 + rational(t.at + 16) / 3600 : null
    }
    const lat = dms(2)
    const lng = dms(4)
    const latRef = gps.get(1) ? ascii(gps.get(1)!.at, 1) : 'N'
    const lngRef = gps.get(3) ? ascii(gps.get(3)!.at, 1) : 'E'
    if (lat != null && lng != null && (lat !== 0 || lng !== 0)) {
      out.lat = latRef === 'S' ? -lat : lat
      out.lng = lngRef === 'W' ? -lng : lng
      const err = gps.get(31) // GPSHPositioningError
      if (err) out.acc = rational(err.at)
    }
  }
  return out
}
