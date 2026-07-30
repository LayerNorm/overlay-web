#!/usr/bin/env bash
# dev-setup.sh — run once per worktree to wire up deps and start the dev server.
# Usage: ./scripts/dev-setup.sh [port]
#
# Symlinks node_modules and .env.local from the canonical overlay-landing repo
# so you don't need a separate npm install in each worktree.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="$SCRIPT_DIR/.."
SOURCE_REPO="$HOME/Downloads/overlay-mono/overlay-landing"
PORT="${1:-3001}"

# ── Validate source repo ─────────────────────────────────────────────────────
if [[ ! -d "$SOURCE_REPO/node_modules" ]]; then
  echo "❌  node_modules not found at $SOURCE_REPO"
  echo "    Run 'npm install' in $SOURCE_REPO first, then retry."
  exit 1
fi

for env_file in .env.local .env.development.local; do
  if [[ ! -f "$SOURCE_REPO/$env_file" ]]; then
    echo "❌  $env_file not found at $SOURCE_REPO"
    exit 1
  fi
done

# ── Symlink node_modules ──────────────────────────────────────────────────────
if [[ -d "$WORKSPACE/node_modules" && ! -L "$WORKSPACE/node_modules" ]]; then
  echo "🗑  Removing existing real node_modules..."
  rm -rf "$WORKSPACE/node_modules"
fi

if [[ ! -L "$WORKSPACE/node_modules" ]]; then
  ln -s "$SOURCE_REPO/node_modules" "$WORKSPACE/node_modules"
  echo "✅  Linked node_modules"
else
  echo "✅  node_modules already linked"
fi

# ── Symlink .env.local ────────────────────────────────────────────────────────
for env_file in .env.local .env.development.local; do
  if [[ ! -L "$WORKSPACE/$env_file" ]]; then
    ln -sf "$SOURCE_REPO/$env_file" "$WORKSPACE/$env_file"
    echo "✅  Linked $env_file"
  else
    echo "✅  $env_file already linked"
  fi
done

# ── Start dev server ──────────────────────────────────────────────────────────
echo ""
echo "🚀  Starting Next.js dev server on http://localhost:$PORT"
echo "    (Ctrl+C to stop)"
echo ""

cd "$WORKSPACE"
exec node_modules/.bin/next dev --port "$PORT"
