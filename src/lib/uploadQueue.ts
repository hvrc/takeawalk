/**
 * Tiny IndexedDB queue so a photo taken with no signal still makes it up
 * once the phone is back online (or the app is reopened).
 */

export interface PendingUpload {
  id: string
  tripId: string
  blob: Blob
  memberId: string
  memberName: string
  color: string
  lat: number
  lng: number
  acc: number
  takenAt: number
  caption: string
  description: string
  createdAt: number
}

const DB_NAME = 'takeawalk'
const STORE = 'pendingUploads'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = fn(t.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        t.oncomplete = () => db.close()
      }),
  )
}

export const uploadQueue = {
  put: (item: PendingUpload) => tx('readwrite', (s) => s.put(item)).then(() => undefined),
  remove: (id: string) => tx('readwrite', (s) => s.delete(id)).then(() => undefined),
  all: () => tx<PendingUpload[]>('readonly', (s) => s.getAll()).catch(() => [] as PendingUpload[]),
  forTrip: async (tripId: string) => (await uploadQueue.all()).filter((p) => p.tripId === tripId),
}
