/**
 * Turn free text into an FTS5 prefix query.
 * Words are AND-ed. FTS operators in the input are quoted away.
 */
export function toFtsMatch(raw: string): string {
  const words = raw
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2)
  if (words.length === 0) return ''
  return words.map((word) => `"${word.replaceAll('"', '')}"*`).join(' AND ')
}

const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/

export function assertFieldName(name: string): string {
  if (!FIELD_NAME.test(name)) {
    throw new Error(`Invalid filter field "${name}".`)
  }
  return name
}

export const INDEX_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/

export function assertIndexName(name: string): string {
  if (!INDEX_NAME.test(name)) {
    throw new Error(`Invalid index name "${name}".`)
  }
  return name
}
