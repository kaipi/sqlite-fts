import type { DocumentInput, SearchHit, SearchInput } from './indexDb.js'
import { assertIndexName } from './ftsQuery.js'

export type FtsClientOptions = {
  baseUrl: string
  apiKey?: string
}

export class FtsClient {
  private readonly baseUrl: string
  private readonly apiKey: string | undefined

  constructor(options: FtsClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.apiKey = options.apiKey
  }

  async health(): Promise<{ ok: true }> {
    return this.request('GET', '/health')
  }

  async upsert(index: string, id: string, doc: Omit<DocumentInput, 'id'>): Promise<void> {
    const name = assertIndexName(index)
    await this.request('PUT', `/indexes/${name}/documents/${encodeURIComponent(id)}`, {
      text: doc.text ?? '',
      fields: doc.fields,
    })
  }

  async remove(index: string, id: string): Promise<boolean> {
    const name = assertIndexName(index)
    const res = await this.fetch(
      'DELETE',
      `/indexes/${name}/documents/${encodeURIComponent(id)}`,
    )
    if (res.status === 204) return true
    if (res.status === 404) return false
    throw await this.error(res)
  }

  async query(index: string, input: SearchInput): Promise<SearchHit[]> {
    const name = assertIndexName(index)
    const body = await this.request<{ hits: SearchHit[] }>('POST', `/indexes/${name}/query`, input)
    return body.hits
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetch(method, path, body)
    if (res.status === 204) return undefined as T
    if (!res.ok) throw await this.error(res)
    return (await res.json()) as T
  }

  private async fetch(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = {}
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`
    if (body !== undefined) headers['content-type'] = 'application/json; charset=utf-8'
    return fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }

  private async error(res: Response): Promise<Error> {
    let message = `HTTP ${res.status}`
    try {
      const json = (await res.json()) as { error?: string }
      if (json.error) message = json.error
    } catch {
      // keep status message
    }
    return new Error(message)
  }
}
