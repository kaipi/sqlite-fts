import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from './server.js'
import { IndexStore } from './store.js'

const closers: Array<() => void> = []

function listen(apiKey?: string) {
  const store = new IndexStore(mkdtempSync(join(tmpdir(), 'fts-http-')), null)
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

describe('http', () => {
  it('indexes a document and queries it', async () => {
    const { base } = await listen()
    const put = await fetch(`${base}/indexes/products/documents/1`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Café Latte Roast', fields: { category: 'coffee' } }),
    })
    expect(put.status).toBe(204)

    const queried = await fetch(`${base}/indexes/products/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q: 'cafe', filters: { category: 'coffee' } }),
    })
    expect(queried.status).toBe(200)
    await expect(queried.json()).resolves.toEqual({
      hits: [{ id: '1', fields: { category: 'coffee' } }],
    })
  })

  it('requires the configured bearer token', async () => {
    const { base } = await listen('secret')
    const res = await fetch(`${base}/health`)
    expect(res.status).toBe(401)
    const ok = await fetch(`${base}/health`, { headers: { authorization: 'Bearer secret' } })
    expect(ok.status).toBe(200)
  })

  it('flush loads the index and returns 204', async () => {
    const { base } = await listen()
    const put = await fetch(`${base}/indexes/products/documents/1`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Latte' }),
    })
    expect(put.status).toBe(204)
    const flushed = await fetch(`${base}/indexes/products/flush`, { method: 'POST' })
    expect(flushed.status).toBe(204)
    const queried = await fetch(`${base}/indexes/products/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q: 'latte' }),
    })
    await expect(queried.json()).resolves.toEqual({
      hits: [{ id: '1', fields: {} }],
    })
  })
})
