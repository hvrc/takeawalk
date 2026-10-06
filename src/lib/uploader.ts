import { getDownloadURL, ref } from 'firebase/storage'
import type { Services } from '../firebase'
import { polaroidStoragePath, savePolaroid, uploadPolaroidImage } from './tripApi'
import { uploadQueue, type PendingUpload } from './uploadQueue'

/**
 * App-wide photo uploader. Every photo goes into the on-device queue first and
 * only leaves it once the image is in Cloud Storage AND its record is in
 * Firestore. Runs for all walks (not just the open one), retries on its own,
 * and every step is safe to repeat, so a retry after a half-finished attempt
 * never duplicates or loses anything.
 */

export interface UploadStatus {
  item: PendingUpload
  progress: number
  failed: boolean
}

const RETRY_MS = 30_000

class Uploader {
  private services: Services | null = null
  private inFlight = new Set<string>()
  private status = new Map<string, UploadStatus>()
  // Photos we couldn't write to IndexedDB; uploaded from memory as a last resort.
  private memoryOnly = new Map<string, PendingUpload>()
  private listeners = new Set<() => void>()
  private uid: string | null = null

  /** The signed-in account. Photos queued before accounts existed are filed under it. */
  setUser(uid: string) {
    this.uid = uid
    void this.drain()
  }

  start(services: Services) {
    if (this.services) return
    this.services = services
    // Ask the browser not to evict our storage (and the queued photos) under pressure.
    void navigator.storage?.persist?.().catch(() => undefined)
    const drain = () => void this.drain()
    window.addEventListener('online', drain)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') drain()
    })
    setInterval(drain, RETRY_MS)
    drain()
  }

  /**
   * Queue a photo and start uploading it. Resolves to true once the photo is
   * safely on disk, false if it only lives in memory (keep the app open).
   */
  async enqueue(item: PendingUpload): Promise<boolean> {
    let persisted = true
    try {
      await uploadQueue.put(item)
    } catch (e) {
      console.warn('could not persist photo to the device queue', e)
      persisted = false
      this.memoryOnly.set(item.id, item)
    }
    this.setStatus(item, { progress: 0, failed: false })
    void this.process(item)
    return persisted
  }

  async drain() {
    const items = [...(await uploadQueue.all()), ...this.memoryOnly.values()]
    items.forEach((item) => void this.process(item))
  }

  /** Photos not yet confirmed in the cloud, for one walk. */
  pendingFor(tripId: string): UploadStatus[] {
    return [...this.status.values()].filter((s) => s.item.tripId === tripId)
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    this.listeners.forEach((fn) => fn())
  }

  private setStatus(item: PendingUpload, patch: Partial<Omit<UploadStatus, 'item'>>) {
    const prev = this.status.get(item.id)
    this.status.set(item.id, { item, progress: prev?.progress ?? 0, failed: prev?.failed ?? false, ...patch })
    this.emit()
  }

  private async process(item: PendingUpload) {
    if (!this.services || !this.uid || this.inFlight.has(item.id)) return
    if (item.memberId !== this.uid) item = { ...item, memberId: this.uid }
    this.inFlight.add(item.id)
    const { db } = this.services
    this.setStatus(item, { failed: false })
    try {
      const path = polaroidStoragePath(item.tripId, item.id)
      const url = await this.ensureUploaded(item, path)
      // Idempotent: writes the record once, no-op if it's already there.
      await savePolaroid(db, item.tripId, {
        id: item.id,
        memberId: item.memberId,
        memberName: item.memberName,
        color: item.color,
        lat: item.lat,
        lng: item.lng,
        acc: item.acc,
        takenAt: item.takenAt,
        caption: item.caption,
        description: item.description,
        imagePath: path,
        imageUrl: url,
      })
      // Only now is it safe to forget the local copy.
      await uploadQueue.remove(item.id)
      this.memoryOnly.delete(item.id)
      this.status.delete(item.id)
      this.emit()
    } catch (e) {
      console.warn('photo upload failed, will retry', e)
      this.setStatus(item, { failed: true })
    } finally {
      this.inFlight.delete(item.id)
    }
  }

  // If an earlier attempt already got the file up (e.g. the app closed before
  // the record was written), reuse it instead of uploading again. Storage rules
  // forbid overwriting, so a blind re-upload would be refused anyway.
  private async ensureUploaded(item: PendingUpload, path: string): Promise<string> {
    const { storage } = this.services!
    try {
      return await getDownloadURL(ref(storage, path))
    } catch (e) {
      if ((e as { code?: string }).code !== 'storage/object-not-found') throw e
    }
    return uploadPolaroidImage(storage, path, item.blob, (f) => this.setStatus(item, { progress: f }))
  }
}

export const uploader = new Uploader()
