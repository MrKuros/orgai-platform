#!/usr/bin/env sh
# OrgAI self-host installer — run once from inside the unpacked bundle:
#   ./install.sh
# Works with Docker or Podman (no Docker Desktop required).
set -eu
cd "$(dirname "$0")"

# Pick a container engine: docker if present and running, else podman.
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  ENGINE=docker
  COMPOSE="docker compose"
  docker compose version >/dev/null 2>&1 || COMPOSE="docker-compose"
elif command -v podman >/dev/null 2>&1; then
  ENGINE=podman
  # rootless podman: compose provider talks to the user socket — make sure it runs
  if command -v systemctl >/dev/null 2>&1; then
    systemctl --user enable --now podman.socket 2>/dev/null || true
  fi
  COMPOSE="podman compose"
  podman compose version >/dev/null 2>&1 || COMPOSE="podman-compose"
else
  echo "Docker or Podman is required."
  echo "  - Docker Engine (Linux, free): https://docs.docker.com/engine/install/"
  echo "  - Podman (free, no license restrictions): https://podman.io/docs/installation"
  exit 1
fi
echo "==> Using $ENGINE"

if [ -f orgai-images.tar.gz ]; then
  echo "==> Loading application images (one-time, ~2 min)"
  $ENGINE load -i orgai-images.tar.gz
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
$COMPOSE up -d

echo ""
echo "Done. Open http://localhost:3000 and sign up — the first signup creates"
echo "your organization. Full guide: README.md"
echo "(Day-to-day commands in README.md use 'docker compose'; substitute"
echo " '$COMPOSE' if you are on Podman.)"
