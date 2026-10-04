// Read-only integrity check for production photos.
//   node scripts/check-photos.mjs
// Uses your gcloud login. Confirms every polaroid record in Firestore has its
// image in Cloud Storage (and the file is a real, non-empty JPEG), every image
// in the bucket has a record, and each walk's polaroidCount matches.
import { execSync } from 'node:child_process'

const PROJECT = 'hvrc-web'
const DB = 'takeawalk'
const BUCKET = 'hvrc-takeawalk'
const token = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim()
const H = { Authorization: `Bearer ${token}`, 'x-goog-user-project': PROJECT, 'Content-Type': 'application/json' }
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DB}/documents`

async function j(url, init) {
  const r = await fetch(url, { ...init, headers: H })
  if (!r.ok) throw new Error(`${r.status} ${url}\n${await r.text()}`)
  return r.json()
}

const val = (f) => f && (f.stringValue ?? f.integerValue ?? f.doubleValue)

// All polaroid records, across every walk.
const rows = await j(`${FS}:runQuery`, {
  method: 'POST',
  body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'polaroids', allDescendants: true }] } }),
})
const polaroids = rows.filter((r) => r.document).map((r) => {
  const f = r.document.fields
  const tripId = r.document.name.split('/trips/')[1].split('/')[0]
  return { name: r.document.name, tripId, imagePath: val(f.imagePath), imageUrl: val(f.imageUrl) }
})

// All objects in the bucket.
const objects = new Map()
let pageToken = ''
do {
  const page = await j(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o?prefix=trips/&maxResults=1000${pageToken ? `&pageToken=${pageToken}` : ''}`)
  for (const o of page.items ?? []) objects.set(o.name, o)
  pageToken = page.nextPageToken ?? ''
} while (pageToken)

const problems = []
for (const p of polaroids) {
  const o = objects.get(p.imagePath)
  if (!o) problems.push(`MISSING IMAGE  ${p.imagePath}  (record ${p.name.split('/documents/')[1]})`)
  else if (Number(o.size) < 1000 || !String(o.contentType).startsWith('image/')) problems.push(`BAD IMAGE  ${p.imagePath}  size=${o.size} type=${o.contentType}`)
  if (!p.imageUrl) problems.push(`NO URL  ${p.name.split('/documents/')[1]}`)
}
const recorded = new Set(polaroids.map((p) => p.imagePath))
const orphans = [...objects.keys()].filter((k) => !recorded.has(k))

// polaroidCount on each walk vs actual records.
const byTrip = Map.groupBy(polaroids, (p) => p.tripId)
const trips = await j(`${FS}/trips?pageSize=300`)
for (const t of trips.documents ?? []) {
  const id = t.name.split('/').pop()
  const count = Number(val(t.fields.polaroidCount) ?? 0)
  const actual = byTrip.get(id)?.length ?? 0
  if (count !== actual) problems.push(`COUNT  walk ${id} "${val(t.fields.name)}" says ${count}, has ${actual}`)
}

console.log(`${polaroids.length} polaroid records, ${objects.size} images in gs://${BUCKET}, ${trips.documents?.length ?? 0} walks`)
if (orphans.length) console.log(`${orphans.length} image(s) with no record (upload finished, record not written yet, or a pending retry):\n  ${orphans.join('\n  ')}`)
if (problems.length) {
  console.log(`PROBLEMS:\n  ${problems.join('\n  ')}`)
  process.exit(1)
}
console.log('OK: every record has its image')
