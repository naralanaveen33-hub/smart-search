# Deploying the SwiftSearch API to Railway

Railway reads `backend/railway.json`, so the service **Root Directory must be
`backend`**. With that set, the build and start commands below are applied
automatically — nothing needs typing into the dashboard except the variables.

| Setting | Value | Source |
| --- | --- | --- |
| Root Directory | `backend` | service setting (must be set by hand) |
| Builder | Nixpacks | `railway.json` |
| Python | 3.12.13 | `.python-version` / `runtime.txt` |
| Build | `pip install -r requirements.txt` | `railway.json` |
| Start | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` | `railway.json` |
| Health check | `/api/health` | `railway.json` |

`--host 0.0.0.0` and `$PORT` are both required. Uvicorn's default bind of
`127.0.0.1:8000` is unreachable from outside the container, and Railway assigns
the port at runtime.

## Environment variables

Copy these verbatim:

```
SUPABASE_BUCKET=swiftsearch-documents
CORS_ORIGINS=https://smart-search-five-umber.vercel.app
SEED_DEMO_DOCUMENTS=false
INDEX_STEP_DELAY=0
AUTO_REBUILD_INDEX=true
BLOCK_SIZE=10000
```

Enter these three by hand — they are secrets and must never be committed or
pasted into a chat:

| Variable | Where to get it |
| --- | --- |
| `SUPABASE_URL` | your local `.env`, or Supabase → Project Settings → Data API → Project URL. Bare host only, no `/rest/v1` suffix |
| `SUPABASE_SERVICE_KEY` | your local `.env`, or Supabase → Project Settings → API Keys → `service_role` |
| `ADMIN_TOKEN` | generate: `python -c "import secrets; print(secrets.token_urlsafe(32))"` |

`ADMIN_TOKEN` guards the destructive endpoints (document delete, index reset,
demo seed). Leaving it unset makes them public — acceptable locally, not on an
internet-reachable deployment.

## Why these production values

- `SEED_DEMO_DOCUMENTS=false` — the first boot of an empty store would
  otherwise write six demo documents straight into the live Supabase project.
- `INDEX_STEP_DELAY=0` — the 0.12s pacing exists to make indexing watchable in
  a demo; in production it is pure sleep.
- `AUTO_REBUILD_INDEX=true` — the inverted index lives on the container's
  ephemeral disk and is lost on every deploy and cold start. Document text
  survives in Supabase, so a fresh instance rebuilds rather than serving 409s.
- `CORS_ORIGINS` must be the exact frontend origin, scheme included, no
  trailing slash. `api.ts` sends `Content-Type: application/json` even on GET
  requests, which forces a CORS preflight — an origin mismatch fails the
  preflight and every call dies before it reaches a route.

## After the deploy

Point the frontend at the new API. `VITE_*` variables are inlined by Vite at
**build time**, so this needs a redeploy, not just a variable change:

Vercel → Project → Settings → Environment Variables → `VITE_API_URL` =
`<RAILWAY_URL>/api` (Production and Preview) → Redeploy.

Include the `/api` suffix. No trailing slash.
