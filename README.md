# sqlite-fts

Small full-text search service. Each index is one SQLite FTS5 file. Cloud Run keeps a local copy and stores the file in Cloud Storage. Scale to zero is fine: the next request downloads the file and serves it.

The dog database is a future client. This service does not know about dogs.

## API

`API_KEY` empty means local dev is open. Set it on Cloud Run.

```
PUT    /indexes/{name}/documents/{id}
DELETE /indexes/{name}/documents/{id}
POST   /indexes/{name}/query
GET    /health
```

```json
{ "text": "Järvinen Matti", "fields": { "breed": "BC", "sex": "uros" } }
```

```json
{ "q": "jarvinen", "filters": { "sex": "uros" }, "limit": 20 }
```

`q` is free text. Words are combined with AND and matched as prefixes. Letters with accents match without them. `filters` are exact string equality. An empty `q` with filters lists matching documents.

Index names are lowercase letters, digits, `_`, and `-`.

## Local

```
yarn
yarn test
yarn dev
```

Without `GCS_BUCKET` the index stays in `DATA_DIR` (default `/tmp/sqlite-fts`).

## Cloud Run

One instance. SQLite has one writer, and this process both queries and updates the file.

```
gcloud run deploy sqlite-fts \
  --source . \
  --region europe-west1 \
  --max-instances 1 \
  --memory 512Mi \
  --set-env-vars GCS_BUCKET=YOUR_BUCKET,API_KEY=YOUR_KEY
```

The runtime service account needs `storage.objectAdmin` on that bucket. Objects are written at `indexes/{name}.sqlite`.
