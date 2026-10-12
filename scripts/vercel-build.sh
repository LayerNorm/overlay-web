#!/usr/bin/env bash
set -euo pipefail
exec node scripts/release/vercel-build.mjs
