# SwiftSearch

**Smart Search. Lightning Fast.**

A working search engine built on **BSBI** (Blocked Sort-Based Indexing) with **BM25** ranking — and a UI that shows you exactly how its own index is built.

Nothing in the teaching screens is faked. The "How It Works" examples come from the real tokenizer, the live indexing view is driven by real Server-Sent Events emitted by the real pipeline, and every number in the Index Explorer is read straight out of the postings list on disk.

---

## Quick start

```bash
./dev.sh
```

That creates the Python virtualenv, installs both dependency sets on first run, and starts:

| Service  | URL                        |
| -------- | -------------------------- |
| Frontend | http://localhost:5173      |
| Backend  | http://127.0.0.1:8000      |
| API docs | http://127.0.0.1:8000/docs |

Six demo documents are seeded automatically, so you can go straight to **Indexing → Build Index → Search**. No Docker, no database setup, no login.

### Running the halves separately

```bash
# Backend
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend
npm install
npm run dev
```

---

## The screens

| Screen             | Purpose                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------- |
| **Home**           | What SwiftSearch is, plus live corpus statistics                                              |
| **How It Works**   | The six BSBI stages, steppable and auto-playable, with animated real examples                 |
| **Documents**      | Drag-and-drop upload (TXT / PDF / DOCX / MD) and corpus management                            |
| **Indexing**       | Live pipeline over SSE — click any stage to open its detailed live view                       |
| **Search**         | One query box, four search modes, popular and recent searches                                 |
| **Results**        | Ranked results with snippets, highlighting, BM25 score and *"Why this result?"*               |
| **Index Explorer** | Raw inverted index: postings lists, positions, term statistics, document frequency            |
| **Analytics**      | Index composition, indexing cost and search behaviour (Recharts)                              |
| **Settings**       | Theme, indexing parameters, search behaviour                                                  |
| **Presentation**   | Global full-screen 9-step demo — press **P** anywhere                                         |

**Keyboard:** `P` presentation mode · `←` `→` step navigation · `Space` play/pause · `Esc` close.

---

## How the BSBI pipeline works

```
Documents → Tokenization → Block Creation → Sorting → Merging → Inverted Index
```

1. **Documents** — each document gets a stable ID that every posting references.
2. **Tokenization** — split, lowercase, drop stop words, stem (Porter). Positions are kept for phrase search.
3. **Block Creation** — postings accumulate in a fixed-size memory buffer. The instant it fills, the run is flushed to a TSV file on disk and the buffer is cleared. *This is why BSBI exists: the full postings list of a real corpus does not fit in RAM.*
4. **Sorting** — each block is loaded back, sorted by `(term, doc_id, position)` and rewritten. A block is small by construction, so this sort is cheap.
5. **Merging** — all sorted blocks are merged with a k-way merge (`heapq.merge`), holding only one record per block in memory. The merged run is streamed straight to `merged.tsv`; it is never collected into a list.
6. **Inverted Index** — `merged.tsv` is read back sequentially. Because it arrives in term order, each postings list is contiguous and the index is built one record at a time.

**The external-memory property is the point.** At no stage does the pipeline hold more than one block (stages 3–4) or one record per block (stage 5) in memory, whatever the size of the corpus. `test_merge_peak_memory_does_not_scale_with_the_corpus` holds the block count fixed, grows the corpus 10×, and asserts that peak allocation stays flat — it fails if the merge is ever collected into a list.

> **Note on stage 4.** Textbook BSBI sorts each run *before* writing it. SwiftSearch flushes the run first and sorts it in a separate pass so that sorting is a visible, inspectable stage. Both passes do real work on real files and the resulting index is identical.

Blocks are plain TSV (`term<TAB>doc_id<TAB>position`) under `backend/.data/blocks/`, so you can `cat` them during a demo.

### Ranking

Standard Okapi BM25, `k1 = 1.2`, `b = 0.75`:

```
score(q,d) = Σ  idf(t) · (tf · (k1 + 1)) / (tf + k1 · (1 − b + b · |d| / avgdl))
```

Retrieval modes, applied before BM25 ranking:

| Mode | Candidate set |
| --- | --- |
| **All** | Union — every document containing at least one query term. The default. |
| **OR** | Union — the Boolean OR. Same candidate set as All, named explicitly so the Boolean modes read as a complete set. |
| **AND** | Intersection — a document must contain *every* query term. |
| **Phrase** | Intersection, then an adjacency check against the stored positions. |

So `OR ⊇ All ⊇ AND` always holds. All and OR are deliberately equivalent: "rank everything that matches anything" *is* Boolean OR followed by ranking.

---

## Architecture

```
backend/
  app/
    api/routes.py            HTTP surface
    bsbi/tokenizer.py        tokenization + Porter stemmer (no external deps)
    bsbi/blocks.py           on-disk block files, k-way merge
    bsbi/indexer.py          the six-stage pipeline + event emission
    ranking/bm25.py          BM25 scoring and search modes
    ranking/snippets.py      snippet extraction with match offsets
    services/engine.py       stateful service the API talks to
    services/events.py       SSE fan-out bus
    database/store.py        Supabase, with local JSON fallback
  data/demo/                 bundled corpus
supabase/schema.sql          optional Postgres schema
  tests/                     138 pytest tests

frontend/src/
  components/  ui/ layout/ viz/ search/ presentation/
  pages/       one file per screen
  hooks/       useTheme · useIndexing (SSE) · useSearch · useAsync
  services/    api client
  types/       shared API types
```

### API

| Method | Endpoint                    | Purpose                             |
| ------ | --------------------------- | ----------------------------------- |
| GET    | `/api/health`               | Service and index status            |
| GET    | `/api/documents`            | List the corpus                     |
| POST   | `/api/documents/upload`     | Upload TXT / PDF / DOCX / MD        |
| DELETE | `/api/documents/{id}`       | Remove a document                   |
| POST   | `/api/index/start`          | Run the BSBI pipeline               |
| GET    | `/api/index/status`         | Full pipeline snapshot              |
| GET    | `/api/index/events`         | **SSE** live progress stream        |
| GET    | `/api/index/blocks`         | Blocks on disk                      |
| GET    | `/api/index/block/{id}`     | One block's contents                |
| GET    | `/api/index/term/{term}`    | Postings list for a term            |
| GET    | `/api/index/explain`        | Real per-stage pipeline data        |
| POST   | `/api/search`               | Ranked search                       |
| GET    | `/api/analytics`            | Metrics and time series             |
| GET/PUT| `/api/settings`             | Runtime configuration               |
| GET    | `/api/settings/memory`      | How max_memory_mb caps the block size |
| GET    | `/api/settings/languages`   | Supported languages (English only)  |

SSE frames carry a complete status snapshot, so the UI never guesses at progress:

```json
{
  "stage": "block_creation", "status": "in_progress", "progress": 67,
  "stats": { "documents_processed": 4, "tokens_generated": 512,
             "blocks_created": 2, "memory_used": 78 },
  "blocks": [...], "memory_block": [...], "token_stream": [...]
}
```

---

## Configuration

Copy `.env.example` to `.env`. Everything is optional — with no configuration the app uses local JSON storage under `backend/.data/`.

**Supabase** is used for documents, search history, index-run metadata and (optionally) uploaded file storage when `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are set. The service key is read by the backend only and is never exposed to the browser.

Apply the schema with:

```bash
psql "$SUPABASE_DB_URL" -f supabase/schema.sql   # or paste it into the SQL editor
```

`supabase/schema.sql` creates `documents`, `search_history` and `index_runs` with primary keys, timestamps, check constraints and indexes, and enables RLS with no permissive policies (the service role bypasses RLS; nothing else can read them).

Failures are never silent. An unreachable project is logged at **error** on startup and the app falls back to local storage; an individual write that fails is logged at **warning**, recorded on the store's `degraded_operations`, and still succeeds against the local mirror.

**`BLOCK_SIZE` defaults to 250** — deliberately small, so the demo corpus produces several real flush/sort/merge cycles and the algorithm is observable. Raise it in Settings for real corpora; the resulting index is identical either way, only the block count changes.

**`MAX_MEMORY_MB` is a real constraint**, not a label. It is converted into a posting ceiling (`max_memory_mb × 1 MB ÷ 120 bytes per posting`) and the effective block size is the smaller of that and `BLOCK_SIZE`, so lowering it genuinely produces more, smaller blocks. The 120 bytes/posting figure is a documented estimate of the in-memory tuple cost — SwiftSearch does not measure process memory and never claims to.

**Settings that do nothing are not shown.** `language` is displayed as a fixed "English" field because the stop word list and the Porter stemmer are English-specific; `case_sensitive`, `results_per_page`, `use_stemming` and `use_stop_words` all change real behaviour, and the UI warns when a change requires rebuilding the index.

---

---

## Deploying

Three pieces: a static frontend, a Python API, and Supabase.

```
Vercel  (React build)   ──VITE_API_URL──▶  FastAPI API  ──▶  Supabase
  frontend/vercel.json                      Render, or                Postgres + Storage
                                            any Docker host
```

The API ships two equivalent targets: a Render blueprint (`render.yaml`) and a
container image (`Dockerfile`). Pick one — they take the same environment
variables and expose the same endpoints.

### 1. Supabase

Run `supabase/schema.sql` (SQL editor, or `psql "$SUPABASE_DB_URL" -f supabase/schema.sql`).
It creates `documents`, `search_history` and `index_runs`, enables RLS with no
permissive policies, and creates the private `swiftsearch-documents` bucket.

From Project Settings → API you need the **project URL** and the **service role
key**. The service key is a backend-only secret — it must never appear in the
frontend, in the repo, or in a `VITE_*` variable.

### 2. Backend on Render

New → Blueprint, pointed at this repo; Render reads `render.yaml`. Or create a
Web Service by hand with:

| Setting | Value |
| --- | --- |
| Root directory | `backend` |
| Build command | `pip install -r requirements.txt` |
| Start command | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Health check | `/api/health` |

`--host 0.0.0.0 --port $PORT` is not optional: uvicorn otherwise binds
`127.0.0.1:8000`, which is unreachable from outside the container.

Environment variables to set in the dashboard:

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | your project URL |
| `SUPABASE_SERVICE_KEY` | service role key (secret) |
| `SUPABASE_BUCKET` | `swiftsearch-documents` |
| `CORS_ORIGINS` | your frontend URL, e.g. `https://swiftsearch.vercel.app` |
| `ADMIN_TOKEN` | `python -c "import secrets; print(secrets.token_urlsafe(32))"` |
| `SEED_DEMO_DOCUMENTS` | `false` |
| `INDEX_STEP_DELAY` | `0` |
| `BLOCK_SIZE` | `10000` |
| `PYTHON_VERSION` | `3.12.13` |

### 2b. Backend in Docker (alternative to Render)

Build context is the repository root; only `backend/` is copied in.

```bash
docker build -t swiftsearch-api .

docker run -d --name swiftsearch-api -p 8000:8000 \
  -e PORT=8000 \
  -e SUPABASE_URL=...            `# your project URL` \
  -e SUPABASE_SERVICE_KEY=...    `# service role key — secret` \
  -e SUPABASE_BUCKET=swiftsearch-documents \
  -e CORS_ORIGINS=https://your-frontend.vercel.app \
  -e ADMIN_TOKEN=...             `# secrets.token_urlsafe(32)` \
  -e SEED_DEMO_DOCUMENTS=false \
  -e INDEX_STEP_DELAY=0 \
  -e AUTO_REBUILD_INDEX=true \
  -e BLOCK_SIZE=10000 \
  swiftsearch-api
```

Never bake secrets in: no `.env` file reaches the image (`.dockerignore`
excludes them and the `Dockerfile` never copies one), and every value above is
supplied at runtime. Use your host's secret store rather than `-e` in
production. `--env-file` works locally.

| Property | Value |
| --- | --- |
| Base image | `python:3.12-slim` (multi-stage; deps in a venv) |
| Runs as | non-root `swiftsearch` (uid 10001) |
| Listens on | `0.0.0.0:$PORT` — never a hardcoded port |
| Start command | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Health check | built in, hits `/api/health` |
| Writable state | `/data` (`SWIFTSEARCH_DATA_DIR`) — index, blocks, text cache |
| Image size | ~336 MB |

`/data` is ephemeral by design. The corpus and its extracted text live in
Supabase, so a replaced container rebuilds the index on boot
(`AUTO_REBUILD_INDEX=true`) rather than serving 409s. Mount a volume there only
if you want to skip that rebuild.

Any host that runs a long-lived container works — Fly.io, Railway, Render (as a
Docker service), a VPS. Avoid serverless/function platforms: BSBI indexing is a
long-running background task and `/api/index/events` is a persistent SSE stream,
and request-scoped runtimes cut both off.

### 3. Frontend on Vercel

Import the repo with **root directory `frontend`**. `frontend/vercel.json`
supplies the build settings and the SPA rewrite that keeps `/search` and
`/results` working on refresh.

Set one environment variable, for Production and Preview:

```
VITE_API_URL = https://<your-render-service>.onrender.com/api
```

Vite inlines `VITE_*` at **build time**, so changing it later requires a
redeploy. Without it the bundle requests a relative `/api`, which hits Vercel
instead of your API and 404s.

Deploy the backend first so you have its URL, then set `CORS_ORIGINS` on Render
to the Vercel URL once that exists.

### 4. Finish

Open the site → **Settings → Admin access** → paste the `ADMIN_TOKEN`. It is
kept in that browser's localStorage only; visitors without it can search and
browse but cannot delete documents or reset the index.

### What happens on a restart

Hosting platforms wipe the container filesystem on every deploy, and free tiers
also spin down when idle. The corpus is safe — documents, extracted text,
history and run metadata all live in Supabase — but the inverted index and its
block files do not survive.

On startup, an instance that finds documents and no index rebuilds one in the
background (`AUTO_REBUILD_INDEX=true`, the default). Search reports the index as
missing for the few seconds that takes, then works normally. Roughly 6 seconds
for 3,000 documents with `INDEX_STEP_DELAY=0`.

### Known limits at this scale

- Measured: ~3,000 documents produce a ~17 MB `index.json` and ~90 MB of
  process memory. Comfortable on a 512 MB instance; the index is held in
  memory, so this grows with the corpus.
- Uploads are read fully into memory before the 20 MB limit is checked.
- Only `DELETE /documents/{id}`, `POST /index/reset` and `POST /documents/seed`
  are access-controlled. Reading, searching and uploading are open to anyone
  who can reach the API.

---

## Tests

```bash
cd backend  && .venv/bin/python -m pytest      # 138 tests
cd frontend && npm test                        # 29 tests
cd frontend && npm run typecheck
```

Backend coverage includes tokenizer and case-sensitivity behaviour; that memory-full genuinely flushes a block; that every block on disk is sorted; that the merged run is globally ordered and never materialised; that peak merge memory does not scale with the corpus; that the BSBI index matches a brute-force index and is invariant to block size; that BM25 results are identical whatever the block size; the BM25 formula itself; `OR ⊇ All ⊇ AND`; that block metadata is rebuilt after a restart; that elapsed time freezes on completion and on failure; that the token-stream buffer stays bounded; PDF/DOCX/TXT content validation; server-side pagination; and the full API surface.

Frontend coverage includes formatting and highlighting, theme persistence, the ranking explanation, play/pause/replay semantics of the step visuals, and that pagination really is one request per page.

---

## Accessibility & responsiveness

Semantic HTML, keyboard-navigable throughout, visible focus rings, ARIA on progress bars/tabs/switches/dialogs, and `prefers-reduced-motion` honoured (animations collapse to their end state rather than disappearing). Desktop uses a fixed sidebar, tablet a compact layout, mobile a drawer plus a bottom tab bar for the five demo-critical screens.
