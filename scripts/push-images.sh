#!/usr/bin/env bash
# Build the server and dashboard images and push them to GHCR.
#
# One-time login (write:packages scope):
#   gh auth refresh -s write:packages
#   gh auth token | docker login ghcr.io -u nghoangquan175 --password-stdin
#
# Usage: scripts/push-images.sh [tag]   (default: latest, plus the git sha)
set -euo pipefail

OWNER="${GHCR_OWNER:-nghoangquan175}"
TAG="${1:-latest}"
cd "$(dirname "$0")/.."
SHA="$(git rev-parse --short HEAD)"

for app in server dashboard; do
  image="ghcr.io/$OWNER/loadforge-$app"
  docker build --platform linux/amd64 -f "apps/$app/Dockerfile" -t "$image:$TAG" -t "$image:$SHA" .
  docker push "$image:$TAG"
  docker push "$image:$SHA"
done
