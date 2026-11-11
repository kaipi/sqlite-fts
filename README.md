# @kaipi/sqlite-fts

SQLite FTS5 search as a library. Run the engine **in-process** (for example inside Firebase Functions) with an optional Cloud Storage copy of each index file. An HTTP server and typed client are included when you want a remote service instead.

Each index is one SQLite file. Words are AND-ed as prefixes; accents are ignored. Extra `fields` are exact string filters. `ranges` compare those strings lexicographically (4-digit years work). `offset` pages the rank order, capped at 1000. `IndexDb.clear()` drops every row.

## Install

```bash
yarn add github:kaipi/sqlite-fts
# or after publish: yarn add @kaipi/sqlite-fts
```

Requires Node 22+. `better-sqlite3` is a native dependency.

## In-process (primary)

```ts
import { IndexStore, gcsObjectStore } from '@kaipi/sqlite-fts'

const store = new IndexStore('/tmp/sqlite-fts', gcsObjectStore('YOUR_BUCKET'), {
  uploadDebounceMs: 5 * 60 * 1000, // omit or 0 to upload on every persisted write
})
// pass null instead of gcsObjectStore to keep indexes on local disk only

await store.withIndex(
  'products',
  (db) => {
    db.upsert({
      id: '1',
      text: 'Café Latte Roast',
      fields: { category: 'coffee', status: 'published', birthYear: '2012' },
    })
  },
  true, // upload when due; call store.flush('products') to upload now
)

const hits = await store.withIndex(
  'products',
  (db) =>
    db.search({
      q: 'cafe roast',
      filters: { status: 'published' },
      ranges: { birthYear: { gte: '2000', lte: '2020' } },
      limit: 20,
      offset: 0,
    }),
  false,
)
```

Master data stays in your app. On each write, upsert or delete the matching document. For a first load, walk your source rows and upsert them once.

Index names: lowercase letters, digits, `_`, `-`.

## HTTP client

When a server is already running:

```ts
import { FtsClient } from '@kaipi/sqlite-fts/client'

const client = new FtsClient({
  baseUrl: 'https://fts.example.com',
  apiKey: process.env.FTS_API_KEY,
})

await client.upsert('products', '1', {
  text: 'Café Latte Roast',
  fields: { category: 'coffee' },
})
const hits = await client.query('products', { q: 'cafe', filters: { category: 'coffee' } })
```

## Optional Cloud Run server

Same package, process entry that listens on `PORT`:

```
PUT    /indexes/{name}/documents/{id}
DELETE /indexes/{name}/documents/{id}
POST   /indexes/{name}/query
POST   /indexes/{name}/flush
GET    /health
```

`API_KEY` empty means local dev is open. Set it in production. `Authorization: Bearer …`.

```bash
yarn
yarn build
yarn test
yarn dev          # local server via tsx
```

```bash
gcloud run deploy sqlite-fts \
  --source . \
  --region europe-west1 \
  --max-instances 1 \
  --memory 512Mi \
  --set-env-vars GCS_BUCKET=YOUR_BUCKET,API_KEY=YOUR_KEY
```

Use `--max-instances 1`: SQLite has one writer, and this process both queries and updates the file. The runtime service account needs `storage.objectAdmin` on the bucket. Objects land at `indexes/{name}.sqlite`.

Without `GCS_BUCKET`, indexes stay under `DATA_DIR` (default `/tmp/sqlite-fts`).

## Package exports

| Import | Contents |
|--------|----------|
| `@kaipi/sqlite-fts` | `IndexDb`, `IndexStore`, `gcsObjectStore`, query helpers, types |
| `@kaipi/sqlite-fts/client` | `FtsClient` |
| `@kaipi/sqlite-fts/server` | `createApp` |
