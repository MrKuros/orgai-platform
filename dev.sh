#!/usr/bin/env bash
# One-command local dev stack: postgres (docker) + API (hot reload) + dashboard (hot reload).
#   ./dev.sh          start everything
#   ./dev.sh --down   stop and remove the dev database container too
# API http://localhost:8080 · Dashboard http://localhost:3000
set -euo pipefail
cd "$(dirname "$0")"

DB_CONTAINER=orgai-dev-db

# Podman fallback — same CLI surface as docker for what we use.
if command -v docker >/dev/null 2>&1; then DOCKER=docker
elif command -v podman >/dev/null 2>&1; then DOCKER=podman
else echo "error: need docker or podman for the dev database" >&2; exit 1; fi

if [ "${1:-}" = "--down" ]; then
  $DOCKER rm -f "$DB_CONTAINER" >/dev/null 2>&1 || true
  echo "dev database removed."
  exit 0
fi

# 1. Postgres — matches api/.env (postgresql://orgai:orgai@localhost:5432/orgai)
if ! $DOCKER ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
  # Port already taken by something that isn't our container → bail with a hint,
  # or migrations would silently target a stranger's postgres.
  if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q ':5432 '; then
    echo "error: port 5432 is already in use (a local postgres?). Stop it or remove it, then re-run." >&2
    exit 1
  fi
  if $DOCKER ps -a --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
    $DOCKER start "$DB_CONTAINER" >/dev/null
  else
    $DOCKER run -d --name "$DB_CONTAINER" \
      -e POSTGRES_USER=orgai -e POSTGRES_PASSWORD=orgai -e POSTGRES_DB=orgai \
      -p 5432:5432 postgres:16-alpine >/dev/null
  fi
fi
printf "waiting for postgres"
DB_UP=0
for _ in $(seq 1 30); do
  if $DOCKER exec "$DB_CONTAINER" pg_isready -U orgai -q 2>/dev/null; then DB_UP=1; break; fi
  printf "."; sleep 1
done
if [ "$DB_UP" != "1" ]; then
  echo " FAILED — postgres did not come up in 30s. Check: $DOCKER logs $DB_CONTAINER" >&2
  exit 1
fi
echo " up."

# 2. Dependencies (workspace root install covers api + dashboard + core)
[ -d node_modules ] || npm install

# 3. Prisma client + migrations
(cd api && npx prisma generate >/dev/null && npx prisma migrate deploy)

# 4. Run both dev servers; ctrl-c kills the lot (db container stays for fast restarts)
trap 'kill 0' EXIT INT TERM
(cd api && npm run dev) &
(cd dashboard && npm run dev) &

echo ""
echo "──────────────────────────────────────────"
echo "  API        http://localhost:8080"
echo "  Dashboard  http://localhost:3000"
echo "  Stop:      ctrl-c   ·   DB off: ./dev.sh --down"
echo "──────────────────────────────────────────"
wait
