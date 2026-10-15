#!/usr/bin/env bash
# Ignored Build Step for the overlay-admin Vercel project.
# Exit 0 = skip the build; exit 1 = build.
# Builds only when admin-relevant paths changed since the previous deploy.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

PREV="${VERCEL_GIT_PREVIOUS_SHA:-}"
CUR="${VERCEL_GIT_COMMIT_SHA:-HEAD}"

# No previous deploy or unreachable history: build.
if [ -z "$PREV" ] || ! git cat-file -e "$PREV^{commit}" 2>/dev/null; then
  echo "ignore-build-admin: no previous commit ($PREV); building"
  exit 1
fi

PATHS=(
  "apps/admin"
  "packages"
  "convex/admin"
  "convex/lib/auth.ts"
  "convex/schema.ts"
  "package-lock.json"
  "package.json"
  "convex/auth.config.ts"
  "scripts/vercel-ignore-build-admin.sh"
)

if git diff --quiet "$PREV" "$CUR" -- "${PATHS[@]}"; then
  echo "ignore-build-admin: no admin-relevant changes between $PREV and $CUR; skipping build"
  exit 0
fi

echo "ignore-build-admin: admin-relevant changes between $PREV and $CUR; building"
exit 1
