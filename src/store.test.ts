import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { IndexStore, type ObjectStore } from './store.js'

const stores: IndexStore[] = []

afterEach(() => {
  for (const store of stores.splice(0)) store.close()
})

describe('IndexStore', () => {
  it('upserts and searches in-process without object storage', async () => {
    const store = new IndexStore(mkdtempSync(join(tmpdir(), 'fts-store-')), null)
    stores.push(store)

    await store.withIndex(
      'products',
      (db) => {
        db.upsert({ id: '1', text: 'Café Latte Roast', fields: { category: 'coffee' } })
      },
      true,
    )

    const hits = await store.withIndex(
      'products',
      (db) => db.search({ q: 'cafe', filters: { category: 'coffee' } }),
      false,
    )
    expect(hits).toEqual([{ id: '1', fields: { category: 'coffee' } }])
  })

  it('uploads immediately when debounce is zero', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fts-store-'))
    const objects = memoryStore()
    const store = new IndexStore(dir, objects, { uploadDebounceMs: 0 })
    stores.push(store)

    await store.withIndex('products', (db) => db.upsert({ id: '1', text: 'One' }), true)
    await store.withIndex('products', (db) => db.upsert({ id: '2', text: 'Two' }), true)
    expect(objects.uploads).toEqual(['indexes/products.sqlite', 'indexes/products.sqlite'])
  })

  it('holds uploads for the debounce window and flush writes them', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fts-store-'))
    const objects = memoryStore()
    const store = new IndexStore(dir, objects, { uploadDebounceMs: 60_000 })
    stores.push(store)

    await store.withIndex('products', (db) => db.upsert({ id: '1', text: 'Café' }), true)
    expect(objects.uploads).toHaveLength(1)
    await store.withIndex('products', (db) => db.upsert({ id: '2', text: 'Latte' }), true)
    expect(objects.uploads).toHaveLength(1)

    await store.flush('products')
    expect(objects.uploads).toHaveLength(2)

    store.close()
    const reloaded = new IndexStore(mkdtempSync(join(tmpdir(), 'fts-store-')), objects)
    stores.push(reloaded)
    const hits = await reloaded.withIndex('products', (db) => db.search({ q: 'latte' }), false)
    expect(hits.map((hit) => hit.id)).toEqual(['2'])
  })

  it('flush on a clean index does not upload again', async () => {
    const objects = memoryStore()
    const store = new IndexStore(mkdtempSync(join(tmpdir(), 'fts-store-')), objects)
    stores.push(store)
    await store.withIndex('products', (db) => db.upsert({ id: '1', text: 'One' }), true)
    await store.flush('products')
    expect(objects.uploads).toHaveLength(1)
  })
})

function memoryStore(): ObjectStore & { uploads: string[] } {
  const files = new Map<string, Buffer>()
  const uploads: string[] = []
  return {
    uploads,
    async download(objectName, dest) {
      const buf = files.get(objectName)
      if (!buf) return false
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, buf)
      return true
    },
    async upload(objectName, src) {
      uploads.push(objectName)
      files.set(objectName, readFileSync(src))
    },
  }
}
