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

export class IndexStore {
  private readonly open = new Map<string, IndexDb>()
  private readonly chains = new Map<string, Promise<unknown>>()

  constructor(
    private readonly dir: string,
    private readonly objects: ObjectStore | null,
  ) {
    mkdirSync(dir, { recursive: true })
  }

  async withIndex<T>(name: string, fn: (db: IndexDb) => T, persist: boolean): Promise<T> {
    const previous = this.chains.get(name) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(async () => {
      const db = await this.load(name)
      const result = fn(db)
      if (persist && this.objects) {
        await this.objects.upload(objectName(name), fileName(this.dir, name))
      }
      return result
    })
    this.chains.set(name, run)
    return run
  }

  close(): void {
    for (const db of this.open.values()) db.close()
    this.open.clear()
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
