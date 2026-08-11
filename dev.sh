#!/usr/bin/env bash
# Start the SwiftSearch backend and frontend together. No Docker required.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d backend/.venv ]; then
  echo "→ Creating Python virtual environment"
  python3 -m venv backend/.venv
  backend/.venv/bin/pip install --quiet --upgrade pip
  backend/.venv/bin/pip install --quiet -r backend/requirements.txt
fi

if [ ! -d frontend/node_modules ]; then
  echo "→ Installing frontend dependencies"
  (cd frontend && npm install)
fi

cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "→ Backend  http://127.0.0.1:8000  (docs at /docs)"
(cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000) &

echo "→ Frontend http://localhost:5173"
(cd frontend && npm run dev) &

wait
