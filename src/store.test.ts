import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { IndexStore } from './store.js'

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
})
