import {
  addDoc,
  arrayUnion,
  collection,
  doc,
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
import type { GeoPoint, Member, Polaroid, Segment, Trip, TripStatus, Visibility } from './types'

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
    finishedAt: (data.finishedAt as number | null) ?? null,
    deleted: !!data.deleted,
    visibility: (data.visibility as Visibility) ?? 'private',
    memberUids: (data.memberUids as string[]) ?? [],
  }
}

export async function createTrip(db: Firestore, name: string, me: Me): Promise<Trip> {
  // Walks are joined from the list or a link now; the code is kept only as a label.
  const code = makeJoinCode()
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
    memberUids: [me.id],
    visibility: 'public' as Visibility,
    pointCount: 0,
    polaroidCount: 0,
    distanceM: 0,
    coverUrl: null,
  }
  const refDoc = await addDoc(tripsCol(db), data)
  return toTrip(refDoc.id, data)
}

/** Ends a walk for everyone. Finished walks can't be resumed, joined or added to. */
export async function finishTrip(db: Firestore, tripId: string): Promise<void> {
  const now = Date.now()
  await updateDoc(doc(db, 'trips', tripId), { status: 'published', finishedAt: now, updatedAt: now })
}

/** Where a walk is (or ended): the most recent position anyone on it reported. */
export function walkLocation(trip: Trip, segments: Segment[] = []): { lat: number; lng: number } | null {
  let best: { lat: number; lng: number; t: number } | null = null
  for (const m of Object.values(trip.members)) if (m.lastPos && (!best || m.lastPos.t > best.t)) best = m.lastPos
  for (const s of segments) {
    const last = s.points[s.points.length - 1]
    if (last && (!best || last.t > best.t)) best = last
  }
  return best
}

export async function renameMember(db: Firestore, tripId: string, me: Me): Promise<void> {
  await updateDoc(doc(db, 'trips', tripId), { [`members.${me.id}.name`]: me.name })
}

/**
 * The walks you can see: the ones you're on, plus public ones. (Two queries,
 * because the database rules only allow lists they can prove are readable.)
 * Walks flagged `hidden` (admin) or `deleted` stay out of the list.
 */
export function subscribeTrips(db: Firestore, uid: string, cb: (trips: Trip[]) => void, onError?: (e: Error) => void): Unsubscribe {
  const mine = new Map<string, Trip>()
  const pub = new Map<string, Trip>()
  let gotMine = false
  let gotPub = false
  const emit = () => {
    if (!gotMine || !gotPub) return
    const all = new Map([...pub, ...mine])
    cb([...all.values()].filter((t) => !(t as Trip & { hidden?: boolean }).hidden && !t.deleted).sort((a, b) => b.updatedAt - a.updatedAt))
  }
  const fill = (into: Map<string, Trip>) => (snap: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }) => {
    into.clear()
    for (const d of snap.docs) into.set(d.id, { ...toTrip(d.id, d.data()), hidden: !!d.data().hidden } as Trip)
  }
  const u1 = onSnapshot(query(tripsCol(db), where('memberUids', 'array-contains', uid), limit(200)), (snap) => {
    fill(mine)(snap)
    gotMine = true
    emit()
  }, onError)
  const u2 = onSnapshot(query(tripsCol(db), where('visibility', '==', 'public'), limit(200)), (snap) => {
    fill(pub)(snap)
    gotPub = true
    emit()
  }, onError)
  return () => {
    u1()
    u2()
  }
}

/**
 * Anyone on a walk can delete it. That only hides it: the route and photos are
 * kept and an admin can restore it from /admin.
 */
export async function deleteWalk(db: Firestore, tripId: string, uid: string): Promise<void> {
  await updateDoc(doc(db, 'trips', tripId), { deleted: true, deletedAt: Date.now(), deletedBy: uid })
}

/** Members can make a walk public (anyone can see it) or private (just the people on it). */
export async function setVisibility(db: Firestore, tripId: string, visibility: Visibility): Promise<void> {
  await updateDoc(doc(db, 'trips', tripId), { visibility })
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
    // A private walk you're not on: nothing to show.
    () => cb([]),
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
    // A private walk you're not on: nothing to show.
    () => cb([]),
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

