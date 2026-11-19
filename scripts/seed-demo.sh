#!/usr/bin/env bash
# Load demo data into the LOCAL Supabase database only. Refuses anything else.
set -euo pipefail
cd "$(dirname "$0")/.."
CONTAINER=supabase_db_hardcode-ops
if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then echo "Local database container $CONTAINER is not running. Start it with: npx supabase start" >&2; exit 1; fi
docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 < supabase/seed-demo.sql
echo "Demo data loaded. Sign in as demo-founder@hardcode.local / demo-password-123"
