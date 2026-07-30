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

# Without an explicit target, fall back to the conservative reading of intent:
# build only this project's own production branch, never previews. A missing
# variable must not silently re-enable the preview builds this guard exists to
# prevent.
if [ -z "$target" ]; then
  if [ "$environment" = "production" ]; then
    run_build "DEPLOY_BRANCH is unset and VERCEL_ENV=production"
  fi
  skip_build "DEPLOY_BRANCH is unset and VERCEL_ENV=$environment is not production"
fi

if [ -z "$branch" ]; then
  # A deploy with no branch reference is a manual or hook-triggered deploy.
  # Those are deliberate, so they are allowed through.
  run_build "no VERCEL_GIT_COMMIT_REF (manual or deploy-hook build)"
fi

if [ "$branch" = "$target" ]; then
  run_build "$branch matches DEPLOY_BRANCH"
fi

skip_build "$branch does not match DEPLOY_BRANCH=$target"
