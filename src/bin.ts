import { IndexStore, gcsObjectStore } from './store.js'
import { createApp } from './server.js'

const port = Number(process.env.PORT ?? 8080)
const dataDir = process.env.DATA_DIR ?? '/tmp/sqlite-fts'
const bucket = process.env.GCS_BUCKET
const apiKey = process.env.API_KEY

const uploadDebounceMs = Number(process.env.UPLOAD_DEBOUNCE_MS ?? 0)
const store = new IndexStore(dataDir, bucket ? gcsObjectStore(bucket) : null, {
  uploadDebounceMs: Number.isFinite(uploadDebounceMs) ? uploadDebounceMs : 0,
})
const server = createApp(store, apiKey)

server.listen(port, () => {
  console.log(`sqlite-fts listening on ${port}${bucket ? ` (gs://${bucket})` : ' (local only)'}`)
})
