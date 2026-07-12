#!/usr/bin/env sh
# Build the client-deliverable self-host bundle.
# Usage: ./selfhost/build-bundle.sh [version]   (default: short git sha)
# Output: orgai-selfhost-<version>.tar.gz in the repo root.
set -eu
cd "$(dirname "$0")/.."

VERSION=${1:-$(git rev-parse --short HEAD)}
OUT=orgai-selfhost-$VERSION
STAGE=$(mktemp -d)

echo "==> Building images (version $VERSION)"
docker build -f api/Dockerfile -t "orgai-api:$VERSION" .
docker build --build-arg NEXT_PUBLIC_API_URL= -t "orgai-dashboard:$VERSION" dashboard/
docker pull postgres:16-alpine

echo "==> Saving images (this is the slow part)"
mkdir -p "$STAGE/$OUT"
docker save "orgai-api:$VERSION" "orgai-dashboard:$VERSION" postgres:16-alpine \
  | gzip > "$STAGE/$OUT/orgai-images.tar.gz"

cp selfhost/docker-compose.yml selfhost/README.md selfhost/install.sh selfhost/install.ps1 "$STAGE/$OUT/"
mkdir -p "$STAGE/$OUT/hooks" && cp selfhost/hooks/pre-commit "$STAGE/$OUT/hooks/"
# pin the version so `docker compose up` uses exactly these images
sed "s/^#*ORGAI_VERSION=.*//" selfhost/.env.example > "$STAGE/$OUT/.env.example"
printf '\n# Pinned by build-bundle.sh — do not change\nORGAI_VERSION=%s\n' "$VERSION" \
  >> "$STAGE/$OUT/.env.example"

tar -C "$STAGE" -czf "orgai-selfhost-$VERSION.tar.gz" "$OUT"
rm -rf "$STAGE"

echo "==> Done: orgai-selfhost-$VERSION.tar.gz"
echo "    Hand this single file to the client. Install steps are inside (README.md)."
