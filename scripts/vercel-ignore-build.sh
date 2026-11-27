#!/usr/bin/env bash
# Ignored Build Step for the overlay-landing (web) Vercel project.
# Exit 0 = skip the build; exit 1 = build.
# Production skips a commit only when everything it changed belongs to the
# desktop, mobile or Chrome apps (plus the shared changelog). Anything else,
# including shared packages and the backend, builds. Preview builds always run.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

if [ "${VERCEL_ENV:-}" != "production" ]; then
  echo "ignore-build: ${VERCEL_ENV:-unknown} deployment; building"
  exit 1
fi

PREV="${VERCEL_GIT_PREVIOUS_SHA:-}"
CUR="${VERCEL_GIT_COMMIT_SHA:-HEAD}"

# No previous deploy or unreachable history: build.
if [ -z "$PREV" ] || ! git cat-file -e "$PREV^{commit}" 2>/dev/null; then
  echo "ignore-build: no previous commit ($PREV); building"
  exit 1
fi

if git diff --quiet "$PREV" "$CUR" -- . \
  ':(exclude)apps/desktop' \
  ':(exclude)apps/mobile' \
  ':(exclude)apps/chrome' \
  ':(exclude)CHANGELOG.md'; then
  echo "ignore-build: only desktop, mobile or Chrome changed between $PREV and $CUR; skipping web build"
  exit 0
fi

echo "ignore-build: web-relevant changes between $PREV and $CUR; building"
exit 1
