import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { assertIndexName } from './ftsQuery.js'
import type { DocumentInput, SearchInput } from './indexDb.js'
import { IndexStore } from './store.js'

const MAX_BODY = 1_000_000

export function createApp(store: IndexStore, apiKey: string | undefined) {
  return createServer(async (req, res) => {
    try {
      if (!authorized(req, apiKey)) return send(res, 401, { error: 'Unauthorized.' })
      const url = new URL(req.url ?? '/', 'http://localhost')
      const parts = url.pathname.split('/').filter(Boolean)

      if (req.method === 'GET' && url.pathname === '/health') {
        return send(res, 200, { ok: true })
      }

      if (parts[0] !== 'indexes' || !parts[1]) return send(res, 404, { error: 'Not found.' })
      const index = assertIndexName(parts[1])

      if (req.method === 'PUT' && parts[2] === 'documents' && parts[3]) {
        const body = await readJson<DocumentInput>(req)
        const doc = { id: decodeURIComponent(parts[3]), text: body.text ?? '', fields: body.fields }
        await store.withIndex(index, (db) => db.upsert(doc), true)
        return send(res, 204, null)
      }

      if (req.method === 'DELETE' && parts[2] === 'documents' && parts[3]) {
        const id = decodeURIComponent(parts[3])
        const removed = await store.withIndex(index, (db) => db.remove(id), true)
        return send(res, removed ? 204 : 404, removed ? null : { error: 'Not found.' })
      }

      if (req.method === 'POST' && parts[2] === 'query' && parts.length === 3) {
        const body = await readJson<SearchInput>(req)
        const hits = await store.withIndex(index, (db) => db.search(body), false)
        return send(res, 200, { hits })
      }

      return send(res, 404, { error: 'Not found.' })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Request failed.'
      const status = message.startsWith('Invalid') || message.startsWith('Document') ? 400 : 500
      return send(res, status, { error: message })
    }
  })
}

function authorized(req: IncomingMessage, apiKey: string | undefined): boolean {
  if (!apiKey) return true
  const header = req.headers.authorization ?? ''
  return header === `Bearer ${apiKey}`
}

function send(res: ServerResponse, status: number, body: unknown): void {
  if (body == null) {
    res.writeHead(status)
    res.end()
    return
  }
  const json = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(json)
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buf.length
    if (size > MAX_BODY) throw new Error('Invalid body: larger than 1 MB.')
    chunks.push(buf)
  }
  if (chunks.length === 0) return {} as T
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
}
