#!/usr/bin/env bash
#
# Vercel "Ignored Build Step" guard.
#
# Two Vercel projects are connected to this one repository:
#
#   overlay-landing      production branch main    -> www.getoverlay.io
#   overlay-web-staging  production branch staging -> staging.getoverlay.io
#
# The existing release lanes remain branch-gated. The staging project can opt
# into isolated internal PR previews with PREVIEW_BUILDS=pr and
# OVERLAY_RELEASE_LANE=staging. Trusted automation provisions each canonical PR
# origin first; previews use sandbox secrets and their own Convex deployment.
#
# Configure per project (Settings -> Environment Variables, all environments):
#
#   overlay-landing      DEPLOY_BRANCH=main
#   overlay-web-staging  DEPLOY_BRANCH=staging
#
# Then set Settings -> Git -> Ignored Build Step to:
#
#   bash scripts/vercel-ignore-build.sh
#
# Vercel's exit contract is inverted, which is why this is a script and not an
# inline one-liner: exit 0 SKIPS the build, exit 1 RUNS it.
set -uo pipefail

branch="${VERCEL_GIT_COMMIT_REF:-}"
target="${DEPLOY_BRANCH:-}"
environment="${VERCEL_ENV:-unknown}"

run_build() {
  echo "vercel-ignore-build: building — $1"
  exit 1
}

skip_build() {
  echo "vercel-ignore-build: skipping — $1"
  exit 0
}

# Fail closed when the project has not been configured. A missing target must
# never silently re-enable the preview builds this guard exists to prevent.
if [ -z "$target" ]; then
  skip_build "DEPLOY_BRANCH is unset (VERCEL_ENV=$environment)"
fi

# Preview credentials are configured only in the staging project. PR lifecycle
# automation sets the canonical app URL before requesting the first build.
if [ "$environment" = "preview" ] && [ "${PREVIEW_BUILDS:-}" = "pr" ]; then
  if [ "${OVERLAY_RELEASE_LANE:-}" != "staging" ]; then
    skip_build "PR previews are only enabled in the staging project"
  fi
  if [ "${VERCEL_GIT_REPO_OWNER:-}" != "LayerNorm" ] || [ "${VERCEL_GIT_REPO_SLUG:-}" != "overlay-web" ]; then
    skip_build "PR source is not the internal Overlay repository"
  fi
  case "${VERCEL_GIT_PULL_REQUEST_ID:-}" in
    ''|*[!0-9]*|0) skip_build "no valid open pull request id" ;;
  esac
  expected_url="https://pr-${VERCEL_GIT_PULL_REQUEST_ID}.preview.getoverlay.io"
  if [ "${NEXT_PUBLIC_APP_URL:-}" != "$expected_url" ]; then
    skip_build "PR origin is not provisioned yet"
  fi
  run_build "provisioned PR ${VERCEL_GIT_PULL_REQUEST_ID} preview"
fi

if [ -z "$branch" ]; then
  # A deploy with no branch reference is a manual or hook-triggered deploy.
  # The staging project is intentionally branch-only, so do not allow a manual
  # or hook-triggered deployment to bypass the staging-branch gate. Other
  # explicitly configured targets retain their deliberate manual-release path.
  if [ "$target" = "staging" ]; then
    skip_build "no VERCEL_GIT_COMMIT_REF (manual or deploy-hook build)"
  fi
  run_build "no VERCEL_GIT_COMMIT_REF (manual or deploy-hook build; target=$target)"
fi

if [ "$branch" = "$target" ]; then
  run_build "$branch matches DEPLOY_BRANCH"
fi

skip_build "$branch does not match DEPLOY_BRANCH=$target"
