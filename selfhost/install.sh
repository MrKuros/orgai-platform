#!/usr/bin/env sh
# OrgAI self-host installer — run once from inside the unpacked bundle:
#   ./install.sh
set -eu
cd "$(dirname "$0")"

command -v docker >/dev/null 2>&1 || {
  echo "Docker is required. Install it from https://docs.docker.com/get-docker/ and re-run."
  exit 1
}

if [ -f orgai-images.tar.gz ]; then
  echo "==> Loading application images (one-time, ~2 min)"
  docker load -i orgai-images.tar.gz
fi

if [ ! -f .env ]; then
  echo "==> Generating configuration (.env) with random secrets"
  cp .env.example .env
  JWT=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
  PG=$(openssl rand -hex 16 2>/dev/null || head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')
  sed -i.bak "s|^JWT_SECRET=.*|JWT_SECRET=$JWT|; s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$PG|" .env
  rm -f .env.bak
fi

echo "==> Starting OrgAI"
docker compose up -d

echo ""
echo "Done. Open http://localhost:3000 and sign up — the first signup creates"
echo "your organization. Full guide: README.md"
