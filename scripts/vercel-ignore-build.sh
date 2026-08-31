#!/usr/bin/env bash
#
# Vercel "Ignored Build Step" guard.
#
# Two Vercel projects are connected to this one repository:
#
#   overlay-landing      production branch main    -> www.getoverlay.io
#   overlay-web-staging  production branch staging -> staging.getoverlay.io
#
# By default Vercel builds every branch push in every connected project, so each
# push produces preview deployments in both. Those preview URLs are not
# registered WorkOS redirect URIs, cannot be signed into, and are not part of the
# QA workflow in docs/develop/worktree-staging-qa.mdx. This guard keeps each
# project to the one branch it is responsible for.
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
