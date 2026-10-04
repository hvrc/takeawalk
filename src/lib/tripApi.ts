import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytesResumable, type FirebaseStorage } from 'firebase/storage'
import { makeJoinCode, pickColor } from './identity'
import { pathDistance } from './geo'
import type { GeoPoint, Member, Polaroid, Segment, Trip, TripStatus } from './types'

export interface Me {
  id: string
  name: string
}

/** A segment document holds at most this many points before we roll over. */
export const SEGMENT_MAX_POINTS = 1500

function tripsCol(db: Firestore) {
  return collection(db, 'trips')
}

function toTrip(id: string, data: Record<string, unknown>): Trip {
  return {
    id,
    name: (data.name as string) ?? 'Untitled walk',
    code: (data.code as string) ?? '',
    status: (data.status as TripStatus) ?? 'active',
    createdBy: (data.createdBy as string) ?? '',
    createdAt: (data.createdAt as number) ?? 0,
    updatedAt: (data.updatedAt as number) ?? 0,
    members: (data.members as Record<string, Member>) ?? {},
    pointCount: (data.pointCount as number) ?? 0,
    polaroidCount: (data.polaroidCount as number) ?? 0,
    distanceM: (data.distanceM as number) ?? 0,
    coverUrl: (data.coverUrl as string | null) ?? null,
  }
}

export async function createTrip(db: Firestore, name: string, me: Me): Promise<Trip> {
  let code = makeJoinCode()
  // Avoid handing out a code that is still live on another trip.
  for (let i = 0; i < 5; i++) {
    const existing = await getDocs(query(tripsCol(db), where('code', '==', code), limit(1)))
    if (existing.empty) break
    code = makeJoinCode()
  }
  const now = Date.now()
  const member: Member = { name: me.name, color: pickColor([]), joinedAt: now, lastSeenAt: now, lastPos: null, tracking: false }
  const data = {
    name: name.trim() || 'Untitled walk',
    code,
    status: 'active' as TripStatus,
    createdBy: me.id,
    createdAt: now,
    updatedAt: now,
    members: { [me.id]: member },
    pointCount: 0,
    polaroidCount: 0,
    distanceM: 0,
    coverUrl: null,
  }
  const refDoc = await addDoc(tripsCol(db), data)
  return toTrip(refDoc.id, data)
}

export async function findTripByCode(db: Firestore, code: string): Promise<Trip | null> {
  const snap = await getDocs(query(tripsCol(db), where('code', '==', code), limit(10)))
  if (snap.empty) return null
  const trips = snap.docs.map((d) => toTrip(d.id, d.data()))
  trips.sort((a, b) => b.createdAt - a.createdAt)
  return trips[0]
}

export async function joinTrip(db: Firestore, tripId: string, me: Me): Promise<void> {
  const tripRef = doc(db, 'trips', tripId)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(tripRef)
    if (!snap.exists()) throw new Error('Trip not found')
    const members = (snap.data().members ?? {}) as Record<string, Member>
    const now = Date.now()
    if (members[me.id]) {
      tx.update(tripRef, { [`members.${me.id}.name`]: me.name, [`members.${me.id}.lastSeenAt`]: now, updatedAt: now })
      return
    }
    const taken = Object.values(members).map((m) => m.color)
    const member: Member = { name: me.name, color: pickColor(taken), joinedAt: now, lastSeenAt: now, lastPos: null, tracking: false }
    tx.update(tripRef, { [`members.${me.id}`]: member, updatedAt: now })
  })
}

export async function renameMember(db: Firestore, tripId: string, me: Me): Promise<void> {
  await updateDoc(doc(db, 'trips', tripId), { [`members.${me.id}.name`]: me.name })
}

export function subscribeTrips(db: Firestore, cb: (trips: Trip[]) => void, onError?: (e: Error) => void): Unsubscribe {
  const q = query(tripsCol(db), orderBy('updatedAt', 'desc'), limit(100))
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => toTrip(d.id, d.data()))), onError)
}

export function subscribeTrip(db: Firestore, tripId: string, cb: (trip: Trip | null) => void, onError?: (e: Error) => void): Unsubscribe {
  return onSnapshot(doc(db, 'trips', tripId), (snap) => cb(snap.exists() ? toTrip(snap.id, snap.data()) : null), onError)
}

export function subscribeSegments(db: Firestore, tripId: string, cb: (segments: Segment[]) => void): Unsubscribe {
  const q = query(collection(db, 'trips', tripId, 'segments'), orderBy('startedAt', 'asc'))
  return onSnapshot(q, (snap) =>
    cb(
      snap.docs.map((d) => {
        const data = d.data()
        return {
          id: d.id,
          memberId: data.memberId,
          color: data.color,
          startedAt: data.startedAt,
          endedAt: data.endedAt ?? null,
          points: (data.points ?? []) as GeoPoint[],
        }
      }),
    ),
  )
}

export function subscribePolaroids(db: Firestore, tripId: string, cb: (polaroids: Polaroid[]) => void): Unsubscribe {
  const q = query(collection(db, 'trips', tripId, 'polaroids'), orderBy('takenAt', 'asc'))
  return onSnapshot(q, (snap) =>
    cb(
      snap.docs.map((d) => {
        const data = d.data()
        return {
          id: d.id,
          memberId: data.memberId,
          memberName: data.memberName ?? '',
          color: data.color ?? '#333',
          lat: data.lat,
          lng: data.lng,
          acc: data.acc ?? 0,
          takenAt: data.takenAt,
          caption: data.caption ?? '',
          description: data.description ?? '',
          imagePath: data.imagePath ?? '',
          imageUrl: data.imageUrl ?? '',
        }
      }),
    ),
  )
}

export async function startSegment(db: Firestore, tripId: string, me: Me, color: string): Promise<string> {
  const now = Date.now()
  const segRef = await addDoc(collection(db, 'trips', tripId, 'segments'), {
    memberId: me.id,
    color,
    startedAt: now,
    endedAt: null,
    points: [],
  })
  await updateDoc(doc(db, 'trips', tripId), {
    status: 'active',
    updatedAt: now,
    [`members.${me.id}.tracking`]: true,
    [`members.${me.id}.lastSeenAt`]: now,
  })
  return segRef.id
}

export async function appendPoints(
  db: Firestore,
  tripId: string,
  segId: string,
  me: Me,
  points: GeoPoint[],
  prevPoint: GeoPoint | null,
): Promise<void> {
  if (points.length === 0) return
  const now = Date.now()
  const last = points[points.length - 1]
  const added = pathDistance(prevPoint ? [prevPoint, ...points] : points)
  const batch = writeBatch(db)
  batch.update(doc(db, 'trips', tripId, 'segments', segId), { points: arrayUnion(...points) })
  batch.update(doc(db, 'trips', tripId), {
    updatedAt: now,
    pointCount: increment(points.length),
    distanceM: increment(added),
    [`members.${me.id}.lastPos`]: last,
    [`members.${me.id}.lastSeenAt`]: now,
    [`members.${me.id}.tracking`]: true,
  })
  await batch.commit()
}

export async function endSegment(db: Firestore, tripId: string, segId: string | null, me: Me): Promise<void> {
  const now = Date.now()
  const batch = writeBatch(db)
  if (segId) batch.update(doc(db, 'trips', tripId, 'segments', segId), { endedAt: now })
  batch.update(doc(db, 'trips', tripId), {
    updatedAt: now,
    [`members.${me.id}.tracking`]: false,
    [`members.${me.id}.lastSeenAt`]: now,
  })
  await batch.commit()
}

export async function setTripStatus(db: Firestore, tripId: string, status: TripStatus): Promise<void> {
  await updateDoc(doc(db, 'trips', tripId), { status, updatedAt: Date.now() })
}

export async function renameTrip(db: Firestore, tripId: string, name: string): Promise<void> {
  await updateDoc(doc(db, 'trips', tripId), { name: name.trim() || 'Untitled walk', updatedAt: Date.now() })
}

export function newPolaroidId(db: Firestore, tripId: string): string {
  return doc(collection(db, 'trips', tripId, 'polaroids')).id
}

export function polaroidStoragePath(tripId: string, polaroidId: string): string {
  return `trips/${tripId}/polaroids/${polaroidId}.jpg`
}

export function uploadPolaroidImage(
  storage: FirebaseStorage,
  path: string,
  blob: Blob,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(ref(storage, path), blob, {
      contentType: 'image/jpeg',
      cacheControl: 'public, max-age=31536000, immutable',
    })
    task.on(
      'state_changed',
      (snap) => onProgress?.(snap.totalBytes ? snap.bytesTransferred / snap.totalBytes : 0),
      reject,
      async () => {
        try {
          resolve(await getDownloadURL(task.snapshot.ref))
        } catch (e) {
          reject(e)
        }
      },
    )
  })
}

export interface NewPolaroid {
  id: string
  memberId: string
  memberName: string
  color: string
  lat: number
  lng: number
  acc: number
  takenAt: number
  caption: string
  description: string
  imagePath: string
  imageUrl: string
}

/**
 * Records an uploaded polaroid. Safe to call again for the same id (a retry
 * after a half-finished attempt): if the record already exists nothing is
 * written, so the count is never bumped twice. Needs a server round trip, so
 * it fails offline and the uploader retries later.
 */
export async function savePolaroid(db: Firestore, tripId: string, p: NewPolaroid): Promise<void> {
  const { id, ...data } = p
  const tripRef = doc(db, 'trips', tripId)
  const polRef = doc(db, 'trips', tripId, 'polaroids', id)
  await runTransaction(db, async (tx) => {
    const [polSnap, tripSnap] = await Promise.all([tx.get(polRef), tx.get(tripRef)])
    if (polSnap.exists()) return
    const now = Date.now()
    tx.set(polRef, { ...data, createdAt: now })
    if (tripSnap.exists()) {
      tx.update(tripRef, {
        polaroidCount: increment(1),
        updatedAt: now,
        // First photo becomes the cover.
        ...(tripSnap.data().coverUrl ? {} : { coverUrl: p.imageUrl }),
      })
    }
  })
}

export async function updatePolaroidText(db: Firestore, tripId: string, id: string, caption: string, description: string) {
  await updateDoc(doc(db, 'trips', tripId, 'polaroids', id), { caption, description })
}

