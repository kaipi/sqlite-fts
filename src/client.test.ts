import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { FtsClient } from './client.js'
import { createApp } from './server.js'
import { IndexStore } from './store.js'

const closers: Array<() => void> = []

async function listen(apiKey?: string) {
  const store = new IndexStore(mkdtempSync(join(tmpdir(), 'fts-client-')), null)
  const server = createApp(store, apiKey)
  return new Promise<{ base: string; close: () => void }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      const close = () => {
        server.close()
        store.close()
      }
      closers.push(close)
      resolve({ base: `http://127.0.0.1:${port}`, close })
    })
  })
}

afterEach(() => {
  for (const close of closers.splice(0)) close()
})

describe('FtsClient', () => {
  it('upserts, queries, and removes over HTTP', async () => {
    const { base } = await listen('secret')
    const client = new FtsClient({ baseUrl: base, apiKey: 'secret' })

    await client.upsert('products', '1', {
      text: 'Café Latte Roast',
      fields: { category: 'coffee' },
    })
    expect(await client.query('products', { q: 'cafe', filters: { category: 'coffee' } })).toEqual([
      { id: '1', fields: { category: 'coffee' } },
    ])
    expect(await client.remove('products', '1')).toBe(true)
    expect(await client.query('products', { q: 'cafe' })).toEqual([])
    expect(await client.health()).toEqual({ ok: true })
    await client.flush('products')
  })
})
