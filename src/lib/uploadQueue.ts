/**
 * Tiny IndexedDB queue so a photo taken with no signal still makes it up
 * once the phone is back online (or the app is reopened). A photo stays here
 * until it is both in Cloud Storage and recorded in Firestore.
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

// What is actually stored. The photo is kept as raw bytes rather than a Blob:
// Safari has a history of failing to persist Blobs in IndexedDB.
type StoredUpload = Omit<PendingUpload, 'blob'> & { bytes?: ArrayBuffer; type?: string; blob?: Blob }

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

// Resolves when the transaction commits (not just when the request succeeds),
// so a resolved put means the photo is really on disk.
function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = fn(t.objectStore(STORE))
        let result: T
        req.onsuccess = () => (result = req.result)
        t.oncomplete = () => {
          db.close()
          resolve(result)
        }
        t.onerror = () => {
          db.close()
          reject(t.error ?? req.error)
        }
        t.onabort = () => {
          db.close()
          reject(t.error ?? new Error('IndexedDB transaction aborted'))
        }
      }),
  )
}

function fromStored(s: StoredUpload): PendingUpload {
  const { bytes, type, blob, ...rest } = s
  return { ...rest, blob: blob ?? new Blob([bytes ?? new ArrayBuffer(0)], { type: type || 'image/jpeg' }) }
}

export const uploadQueue = {
  put: async (item: PendingUpload) => {
    const { blob, ...rest } = item
    const stored: StoredUpload = { ...rest, bytes: await blob.arrayBuffer(), type: blob.type || 'image/jpeg' }
    await tx('readwrite', (s) => s.put(stored))
  },
  remove: (id: string) => tx('readwrite', (s) => s.delete(id)).then(() => undefined),
  all: () =>
    tx<StoredUpload[]>('readonly', (s) => s.getAll())
      .then((rows) => rows.map(fromStored))
      .catch(() => [] as PendingUpload[]),
}
