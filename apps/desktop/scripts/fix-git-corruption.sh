#!/bin/bash
# fix-git-corruption.sh
# Repairs common git object/ref corruption caused by interrupted fetch/gc operations.
# Safe to run at any time — does not delete commits or modify working tree.

set -e

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$REPO_ROOT" ]; then
  echo "ERROR: Not inside a git repository."
  exit 1
fi

PACK_DIR="$REPO_ROOT/.git/objects/pack"
REFS_HEADS="$REPO_ROOT/.git/refs/heads"

echo "==> Checking for corrupted pack files..."
for pack in "$PACK_DIR"/*.pack; do
  [ -f "$pack" ] || continue
  # A valid pack file starts with the magic bytes "PACK"
  magic=$(head -c 4 "$pack" 2>/dev/null)
  if [ "$magic" != "PACK" ]; then
    base="${pack%.pack}"
    echo "    Removing corrupted pack: $(basename "$pack")"
    rm -f "$pack" "${base}.idx" "${base}.rev" "${base}.bitmap" 2>/dev/null || true
  fi
done

echo "==> Cleaning up leftover tmp_pack / tmp_idx / tmp_rev files..."
find "$PACK_DIR" -maxdepth 1 \( -name "tmp_pack_*" -o -name "tmp_idx_*" -o -name "tmp_rev_*" \) -delete 2>/dev/null || true

echo "==> Removing stale .keep files with no matching pack..."
for keep in "$PACK_DIR"/*.keep; do
  [ -f "$keep" ] || continue
  pack="${keep%.keep}.pack"
  if [ ! -f "$pack" ]; then
    echo "    Removing stale .keep: $(basename "$keep")"
    rm -f "$keep"
  fi
done

echo "==> Checking for invalid ref names (e.g. refs with spaces)..."
while IFS= read -r -d '' ref_file; do
  ref_name=$(basename "$ref_file")
  if echo "$ref_name" | grep -qP '\s'; then
    echo "    Removing invalid ref: '$ref_name'"
    rm -f "$ref_file"
  fi
done < <(find "$REFS_HEADS" -maxdepth 1 -type f -print0)

echo "==> Running git fetch --prune..."
git -C "$REPO_ROOT" fetch --prune

echo "==> Running git gc --prune=now..."
git -C "$REPO_ROOT" gc --prune=now

echo ""
echo "==> Git status:"
git -C "$REPO_ROOT" status

echo ""
echo "Done. Git repository repaired."
