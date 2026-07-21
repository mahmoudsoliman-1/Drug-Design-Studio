#!/bin/bash
# Start the DDS local docking engine
cd "$(dirname "$0")"
source .venv/bin/activate
# load local secrets (GROQ_API_KEY, etc.) if present
set -a; [ -f .env ] && . ./.env; set +a
exec python -m uvicorn app:app --host 127.0.0.1 --port 8765 --reload
