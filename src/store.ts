import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { Storage } from '@google-cloud/storage'
import { IndexDb } from './indexDb.js'

export type ObjectStore = {
  download(objectName: string, dest: string): Promise<boolean>
  upload(objectName: string, src: string): Promise<void>
}

export function gcsObjectStore(bucketName: string): ObjectStore {
  const bucket = new Storage().bucket(bucketName)
  return {
    async download(objectName, dest) {
      const file = bucket.file(objectName)
      const [exists] = await file.exists()
      if (!exists) return false
      mkdirSync(dirname(dest), { recursive: true })
      await file.download({ destination: dest })
      return true
    },
    async upload(objectName, src) {
      await bucket.upload(src, { destination: objectName, resumable: false })
    },
  }
}

export type IndexStoreOptions = {
  /**
   * When 0, every persisted write uploads immediately.
   * When positive, a persisted write marks the index dirty and uploads only
   * after this many milliseconds since the last upload. Call {@link IndexStore.flush}
   * to upload sooner. There is no background timer: the check runs on the next
   * persist or flush, which matters when CPU is throttled between requests.
   */
  uploadDebounceMs?: number
}

export class IndexStore {
  private readonly open = new Map<string, IndexDb>()
  private readonly chains = new Map<string, Promise<unknown>>()
  private readonly dirty = new Set<string>()
  private readonly lastUpload = new Map<string, number>()
  private readonly uploadDebounceMs: number

  constructor(
    private readonly dir: string,
    private readonly objects: ObjectStore | null,
    options: IndexStoreOptions = {},
  ) {
    mkdirSync(dir, { recursive: true })
    const debounce = options.uploadDebounceMs ?? 0
    this.uploadDebounceMs = Number.isFinite(debounce) && debounce > 0 ? debounce : 0
  }

  async withIndex<T>(name: string, fn: (db: IndexDb) => T | Promise<T>, persist: boolean): Promise<T> {
    return this.enqueue(name, async () => {
      const db = await this.load(name)
      const result = await fn(db)
      if (persist) await this.persist(name, db, false)
      return result
    })
  }

  /** Load the index (downloading it when missing) and upload now if it is dirty. */
  async flush(name: string): Promise<void> {
    await this.enqueue(name, async () => {
      const db = await this.load(name)
      await this.persist(name, db, true)
    })
  }

  close(): void {
    for (const db of this.open.values()) db.close()
    this.open.clear()
  }

  private enqueue<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(name) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(fn)
    this.chains.set(name, run)
    return run
  }

  private async persist(name: string, db: IndexDb, force: boolean): Promise<void> {
    if (!this.objects) return
    if (!force) this.dirty.add(name)
    const last = this.lastUpload.get(name) ?? 0
    const due = this.uploadDebounceMs === 0 || Date.now() - last >= this.uploadDebounceMs
    if (!force && !due) return
    if (force && !this.dirty.has(name)) return
    db.checkpoint()
    await this.objects.upload(objectName(name), fileName(this.dir, name))
    this.dirty.delete(name)
    this.lastUpload.set(name, Date.now())
  }

  private async load(name: string): Promise<IndexDb> {
    const existing = this.open.get(name)
    if (existing) return existing
    const path = fileName(this.dir, name)
    if (this.objects) await this.objects.download(objectName(name), path)
    const db = new IndexDb(path)
    this.open.set(name, db)
    return db
  }
}

function objectName(index: string): string {
  return `indexes/${index}.sqlite`
}

function fileName(dir: string, index: string): string {
  return `${dir}/${index}.sqlite`
}
