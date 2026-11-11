import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { IndexDb } from './indexDb.js'

const dbs: IndexDb[] = []

function openDb(): IndexDb {
  const dir = mkdtempSync(join(tmpdir(), 'fts-'))
  const db = new IndexDb(join(dir, 'index.sqlite'))
  dbs.push(db)
  return db
}

afterEach(() => {
  for (const db of dbs.splice(0)) db.close()
})

describe('IndexDb', () => {
  it('matches a prefix and ignores diacritics', () => {
    const db = openDb()
    db.upsert({ id: '1', text: 'Café Latte Roast', fields: { category: 'coffee' } })
    expect(db.search({ q: 'caf' }).map((hit) => hit.id)).toEqual(['1'])
    expect(db.search({ q: 'latte café' }).map((hit) => hit.id)).toEqual(['1'])
  })

  it('applies equality filters before the limit', () => {
    const db = openDb()
    db.upsert({ id: 'open', text: 'Blackwood Trail', fields: { status: 'open' } })
    db.upsert({ id: 'closed', text: 'Blackwood Path', fields: { status: 'closed' } })
    const hits = db.search({ q: 'black', filters: { status: 'open' } })
    expect(hits.map((hit) => hit.id)).toEqual(['open'])
  })

  it('can filter without a text query', () => {
    const db = openDb()
    db.upsert({ id: 'a', text: 'Alpha', fields: { category: 'tools' } })
    db.upsert({ id: 'b', text: 'Beta', fields: { category: 'books' } })
    expect(db.search({ filters: { category: 'books' } }).map((hit) => hit.id)).toEqual(['b'])
  })

  it('clears every document', () => {
    const db = openDb()
    db.upsert({ id: '1', text: 'Alpha' })
    db.upsert({ id: '2', text: 'Beta' })
    db.clear()
    expect(db.search({ q: 'alpha' })).toEqual([])
    expect(db.search({ q: 'beta' })).toEqual([])
  })

  it('pages with offset in id order', () => {
    const db = openDb()
    db.upsert({ id: 'a', text: 'Dog', fields: { breed: 'bc' } })
    db.upsert({ id: 'b', text: 'Dog', fields: { breed: 'bc' } })
    db.upsert({ id: 'c', text: 'Dog', fields: { breed: 'bc' } })
    expect(db.search({ filters: { breed: 'bc' }, limit: 1, offset: 1 }).map((hit) => hit.id)).toEqual(['b'])
    expect(db.search({ filters: { breed: 'bc' }, limit: 1, offset: -4 }).map((hit) => hit.id)).toEqual(['a'])
  })

  it('applies lexicographic ranges and skips missing fields', () => {
    const db = openDb()
    db.upsert({ id: 'early', text: 'A', fields: { birthYear: '1998' } })
    db.upsert({ id: 'mid', text: 'B', fields: { birthYear: '2005' } })
    db.upsert({ id: 'late', text: 'C', fields: { birthYear: '2012' } })
    db.upsert({ id: 'none', text: 'D', fields: { breed: 'bc' } })
    expect(
      db.search({ ranges: { birthYear: { gte: '2000', lte: '2010' } } }).map((hit) => hit.id),
    ).toEqual(['mid'])
  })

  it('replaces and deletes a document', () => {
    const db = openDb()
    db.upsert({ id: '1', text: 'Old name' })
    db.upsert({ id: '1', text: 'New name' })
    expect(db.search({ q: 'old' })).toEqual([])
    expect(db.search({ q: 'new' }).map((hit) => hit.id)).toEqual(['1'])
    expect(db.remove('1')).toBe(true)
    expect(db.search({ q: 'new' })).toEqual([])
  })
})
