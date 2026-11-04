#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
UPSTREAM_SHA=01b24f1f95dc9b309765212c52b25b25e005ff01
UPSTREAM_URL=https://github.com/router-for-me/CLIProxyAPI.git
UPSTREAM_DIR=${UPSTREAM_DIR:-"$ROOT/.build/CLIProxyAPI"}
OUTPUT=${1:-"$ROOT/.build/overlay-subscriptions"}

mkdir -p "$ROOT/.build"
if [ ! -d "$UPSTREAM_DIR/.git" ]; then
  git init "$UPSTREAM_DIR"
  git -C "$UPSTREAM_DIR" remote add origin "$UPSTREAM_URL"
fi
git -C "$UPSTREAM_DIR" fetch --depth=1 origin "$UPSTREAM_SHA"
git -C "$UPSTREAM_DIR" checkout --detach FETCH_HEAD
ACTUAL_SHA=$(git -C "$UPSTREAM_DIR" rev-parse HEAD)
if [ "$ACTUAL_SHA" != "$UPSTREAM_SHA" ]; then
  echo "Pinned CLIProxyAPI revision mismatch" >&2
  exit 1
fi

for PATCH in "$ROOT"/patches/*.patch; do
  if git -C "$UPSTREAM_DIR" apply --recount --unidiff-zero --reverse --check "$PATCH" >/dev/null 2>&1; then
    continue
  fi
  git -C "$UPSTREAM_DIR" apply --recount --unidiff-zero --check "$PATCH"
  git -C "$UPSTREAM_DIR" apply --recount --unidiff-zero "$PATCH"
done

mkdir -p "$UPSTREAM_DIR/cmd/overlay-subscriptions"
cp "$ROOT"/src/*.go "$UPSTREAM_DIR/cmd/overlay-subscriptions/"
cd "$UPSTREAM_DIR"
go test ./sdk/auth
go test ./internal/auth/claude ./internal/auth/xai ./internal/auth/kimi ./internal/auth/meta
go test ./cmd/overlay-subscriptions
mkdir -p "$(dirname "$OUTPUT")"
go build -o "$OUTPUT" ./cmd/overlay-subscriptions
