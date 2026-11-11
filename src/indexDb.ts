import Database from 'better-sqlite3'
import { assertFieldName, toFtsMatch } from './ftsQuery.js'

export type DocumentInput = {
  id: string
  text: string
  fields?: Record<string, string>
}

export type SearchHit = {
  id: string
  fields: Record<string, string>
}

export type FieldRange = {
  gte?: string
  lte?: string
}

export type SearchInput = {
  q?: string
  filters?: Record<string, string>
  /** Lexicographic compare on the stored field string. Missing fields do not match. */
  ranges?: Record<string, FieldRange>
  limit?: number
  offset?: number
}

const MAX_OFFSET = 1000

const SCHEMA = `
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  fields TEXT NOT NULL DEFAULT '{}'
);

CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  body,
  content='documents',
  content_rowid='rowid',
  tokenize="unicode61 remove_diacritics 2"
);

CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
  INSERT INTO documents_fts(rowid, body) VALUES (new.rowid, new.body);
END;

CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
END;

CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
  INSERT INTO documents_fts(rowid, body) VALUES (new.rowid, new.body);
END;
`

export class IndexDb {
  private readonly db: Database.Database

  constructor(filename: string) {
    this.db = new Database(filename)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(SCHEMA)
  }

  close(): void {
    this.db.close()
  }

  upsert(doc: DocumentInput): void {
    const id = doc.id.trim()
    if (!id || id.length > 256) throw new Error('Document id is required.')
    const text = doc.text ?? ''
    const fields = normalizeFields(doc.fields)
    this.db
      .prepare(
        `INSERT INTO documents (id, body, fields) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET body = excluded.body, fields = excluded.fields`,
      )
      .run(id, text, JSON.stringify(fields))
  }

  remove(id: string): boolean {
    const result = this.db.prepare('DELETE FROM documents WHERE id = ?').run(id)
    return result.changes > 0
  }

  /** Delete every document. FTS triggers drop the corresponding index rows. */
  clear(): void {
    this.db.prepare('DELETE FROM documents').run()
  }

  /** Merge the WAL into the main file so a copy of the database is complete. */
  checkpoint(): void {
    this.db.pragma('wal_checkpoint(TRUNCATE)')
  }

  search(input: SearchInput): SearchHit[] {
    const limit = clampLimit(input.limit)
    const offset = clampOffset(input.offset)
    const match = input.q ? toFtsMatch(input.q) : ''
    const filters = normalizeFields(input.filters)
    const ranges = normalizeRanges(input.ranges)
    const where: string[] = []
    const params: unknown[] = []

    if (match) {
      where.push('documents_fts MATCH ?')
      params.push(match)
    }
    for (const [key, value] of Object.entries(filters)) {
      where.push(`json_extract(documents.fields, ?) = ?`)
      params.push(`$.${key}`)
      params.push(value)
    }
    for (const range of ranges) {
      const path = `$.${range.key}`
      if (range.gte !== undefined) {
        where.push(`json_extract(documents.fields, ?) >= ?`)
        params.push(path, range.gte)
      }
      if (range.lte !== undefined) {
        where.push(`json_extract(documents.fields, ?) <= ?`)
        params.push(path, range.lte)
      }
    }
    if (where.length === 0) return []

    const from = match
      ? `documents_fts JOIN documents ON documents.rowid = documents_fts.rowid`
      : 'documents'
    const order = match ? 'ORDER BY rank' : 'ORDER BY documents.id'
    const sql = `
      SELECT documents.id AS id, documents.fields AS fields
      FROM ${from}
      WHERE ${where.join(' AND ')}
      ${order}
      LIMIT ?
      OFFSET ?
    `
    const rows = this.db.prepare(sql).all(...params, limit, offset) as { id: string; fields: string }[]
    return rows.map((row) => ({ id: row.id, fields: parseFields(row.fields) }))
  }
}

function normalizeFields(fields: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(fields ?? {})) {
    if (typeof value !== 'string') continue
    out[assertFieldName(key)] = value
  }
  return out
}

function parseFields(raw: string): Record<string, string> {
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  return normalizeFields(parsed as Record<string, string>)
}

function normalizeRanges(
  ranges: Record<string, FieldRange> | undefined,
): Array<{ key: string; gte?: string; lte?: string }> {
  const out: Array<{ key: string; gte?: string; lte?: string }> = []
  for (const [key, value] of Object.entries(ranges ?? {})) {
    if (!value || typeof value !== 'object') continue
    const gte = typeof value.gte === 'string' ? value.gte : undefined
    const lte = typeof value.lte === 'string' ? value.lte : undefined
    if (gte === undefined && lte === undefined) continue
    out.push({ key: assertFieldName(key), gte, lte })
  }
  return out
}

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || !limit || limit < 1) return 20
  return Math.min(100, Math.floor(limit))
}

function clampOffset(offset: number | undefined): number {
  if (!Number.isFinite(offset) || !offset || offset < 0) return 0
  return Math.min(MAX_OFFSET, Math.floor(offset))
}
