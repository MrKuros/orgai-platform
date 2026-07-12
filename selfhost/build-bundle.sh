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
# API_PROXY_URL bakes the /v1 rewrite into the image (Next rewrites are build-time);
# NEXT_PUBLIC_API_URL empty so the browser calls same-origin /v1/*.
docker build --build-arg NEXT_PUBLIC_API_URL= --build-arg API_PROXY_URL=http://api:8080 \
  -t "orgai-dashboard:$VERSION" dashboard/
docker pull postgres:16-alpine

echo "==> Saving images (this is the slow part)"
mkdir -p "$STAGE/$OUT"
docker save "orgai-api:$VERSION" "orgai-dashboard:$VERSION" postgres:16-alpine \
  | gzip > "$STAGE/$OUT/orgai-images.tar.gz"

# Ship a compose with no `build:` blocks — the bundle has no build context (.., ../dashboard),
# and podman-compose would otherwise try to build when a pinned image tag is missing.
awk '/^    build:/{skip=1; next} skip && /^    [a-z]/{skip=0} skip{next} {print}' \
  selfhost/docker-compose.yml > "$STAGE/$OUT/docker-compose.yml"
cp selfhost/README.md selfhost/install.sh selfhost/install.ps1 "$STAGE/$OUT/"
mkdir -p "$STAGE/$OUT/hooks" && cp selfhost/hooks/pre-commit "$STAGE/$OUT/hooks/"
# pin the version so `docker compose up` uses exactly these images
sed "s/^#*ORGAI_VERSION=.*//" selfhost/.env.example > "$STAGE/$OUT/.env.example"
printf '\n# Pinned by build-bundle.sh — do not change\nORGAI_VERSION=%s\n' "$VERSION" \
  >> "$STAGE/$OUT/.env.example"

tar -C "$STAGE" -czf "orgai-selfhost-$VERSION.tar.gz" "$OUT"
rm -rf "$STAGE"

echo "==> Done: orgai-selfhost-$VERSION.tar.gz"
echo "    Hand this single file to the client. Install steps are inside (README.md)."
