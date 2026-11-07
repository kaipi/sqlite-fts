import { describe, expect, it } from 'vitest'
import { assertFieldName, assertIndexName, toFtsMatch } from './ftsQuery.js'

describe('toFtsMatch', () => {
  it('AND-s words and prefixes them', () => {
    expect(toFtsMatch('Black Wood')).toBe('"black"* AND "wood"*')
  })

  it('drops one-character tokens and punctuation', () => {
    expect(toFtsMatch('a FI-123')).toBe('"fi"* AND "123"*')
  })

  it('returns empty when nothing is searchable', () => {
    expect(toFtsMatch('  a  ')).toBe('')
  })
})

describe('names', () => {
  it('rejects unsafe field and index names', () => {
    expect(() => assertFieldName('status;drop')).toThrow(/filter field/)
    expect(() => assertIndexName('../etc')).toThrow(/index name/)
    expect(assertIndexName('products')).toBe('products')
  })
})
