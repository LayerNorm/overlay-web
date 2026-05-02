#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Sync shared chat UI primitives from overlay-landing into @overlay/chat-ui.
 *
 * The shared-as-duplicate strategy: we physically copy files from overlay-landing
 * into this extension's @overlay/chat-ui package, applying a small set of
 * transforms (next/* imports, @/ path aliases, Image/Link shims) so they run
 * inside the side panel without Next.js.
 *
 * Source of truth lives in overlay-landing; this script recomputes a content
 * hash per synced file and writes it to sync-manifest.json. `verify-chat-ui.mjs`
 * re-hashes the current tree and fails CI if drift is detected without the
 * corresponding landing-side change.
 *
 * Usage:
 *   OVERLAY_LANDING_PATH=../overlay-landing node scripts/sync-chat-ui.mjs [--check]
 *     --check   Dry-run; exit 1 if any synced target differs from expected output.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const landingRoot = resolve(repoRoot, process.env.OVERLAY_LANDING_PATH ?? '../overlay-landing')
const targetRoot = resolve(repoRoot, 'packages/overlay-chat-ui/src')
const manifestPath = resolve(repoRoot, 'packages/overlay-chat-ui/sync-manifest.json')

const CHECK_MODE = process.argv.includes('--check')

/**
 * Files to sync verbatim (after transforms). Paths are relative to their roots.
 * Targets that need deeper adaptation (MarkdownMessage, ChatInterface tool
 * blocks, etc.) are owned locally and listed under `tracked` instead — we hash
 * the *landing* original so drift still surfaces in CI.
 */
const SYNC_FILES = [
  {
    from: 'src/lib/markdown-table-fix.ts',
    to: 'lib/markdown-table-fix.ts',
  },
  {
    from: 'src/lib/shim-incomplete-markdown.ts',
    to: 'lib/shim-incomplete-markdown.ts',
  },
  {
    from: 'src/lib/agent-assistant-text.ts',
    to: 'lib/agent-assistant-text.ts',
  },
  {
    from: 'src/lib/web-sources.ts',
    to: 'lib/web-sources.ts',
  },
]

/**
 * Files we own a locally-adapted fork of. We still hash the landing original
 * so `verify` can flag upstream changes that the extension has not yet picked
 * up.
 */
const TRACKED_FILES = [
  'src/components/app/MarkdownMessage.tsx',
  'src/components/app/ChatInterface.tsx',
  'src/components/app/AppSettingsProvider.tsx',
  'src/components/app/WebSourceTooltip.tsx',
  'src/components/app/SlashMenu.tsx',
  'src/components/app/DelayedTooltip.tsx',
  'src/components/app/GenerationModeToggle.tsx',
  'src/app/globals.css',
]

/** Lightweight AST-free transforms. Conservative: only rewrite common patterns. */
function transformSource(code) {
  let out = code
  // 'use client' is a no-op outside Next.js.
  out = out.replace(/^['"]use client['"]\s*\n/, '')
  // `next/image` → local shim with same (src,width,height,alt,className) surface.
  out = out.replace(
    /import\s+(\w+)\s+from\s+['"]next\/image['"]/g,
    "import $1 from '../shims/next-image'",
  )
  out = out.replace(
    /import\s+(\w+)\s+from\s+['"]next\/link['"]/g,
    "import $1 from '../shims/next-link'",
  )
  out = out.replace(
    /import\s+\{([^}]+)\}\s+from\s+['"]next\/navigation['"]/g,
    "import {$1} from '../shims/next-navigation'",
  )
  // @/ path alias → package-local. Kept narrow: only the modules we ship in the
  // package mirror. Callers that need something unavailable will get a clear
  // "Cannot find module" failure rather than a silent typing hole.
  out = out.replace(/from\s+['"]@\/lib\/markdown-table-fix['"]/g, "from '../lib/markdown-table-fix'")
  out = out.replace(
    /from\s+['"]@\/lib\/agent-assistant-text['"]/g,
    "from '../lib/agent-assistant-text'",
  )
  out = out.replace(/from\s+['"]@\/lib\/web-sources['"]/g, "from '../lib/web-sources'")
  out = out.replace(
    /from\s+['"]@\/lib\/shim-incomplete-markdown['"]/g,
    "from '../lib/shim-incomplete-markdown'",
  )
  out = out.replace(
    /from\s+['"]@\/lib\/ask-knowledge-context['"]/g,
    "from '../lib/source-citations'",
  )
  out = out.replace(
    /from\s+['"]\.\/AppSettingsProvider['"]/g,
    "from '../context/chat-settings'",
  )
  return out
}

function sha256(input) {
  return createHash('sha256').update(input).digest('hex').slice(0, 16)
}

function loadManifest() {
  if (!existsSync(manifestPath)) return { files: {} }
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    return { files: {} }
  }
}

function writeIfDifferent(target, content) {
  const full = resolve(targetRoot, target)
  mkdirSync(dirname(full), { recursive: true })
  const existing = existsSync(full) ? readFileSync(full, 'utf8') : ''
  if (existing === content) return false
  if (CHECK_MODE) {
    console.error(`[sync:check] would rewrite ${relative(repoRoot, full)}`)
    return true
  }
  writeFileSync(full, content)
  console.log(`[sync] wrote ${relative(repoRoot, full)}`)
  return true
}

function main() {
  if (!existsSync(landingRoot)) {
    console.error(`OVERLAY_LANDING_PATH does not exist: ${landingRoot}`)
    process.exit(1)
  }

  const manifest = loadManifest()
  const nextFiles = {}
  let drift = false

  for (const entry of SYNC_FILES) {
    const src = join(landingRoot, entry.from)
    if (!existsSync(src)) {
      console.error(`missing source: ${src}`)
      process.exit(1)
    }
    const raw = readFileSync(src, 'utf8')
    const transformed = transformSource(raw)
    const changed = writeIfDifferent(entry.to, transformed)
    if (changed && CHECK_MODE) drift = true
    nextFiles[entry.to] = {
      kind: 'synced',
      source: entry.from,
      sourceHash: sha256(raw),
      outputHash: sha256(transformed),
    }
  }

  for (const rel of TRACKED_FILES) {
    const src = join(landingRoot, rel)
    if (!existsSync(src)) {
      console.error(`missing tracked source: ${src}`)
      process.exit(1)
    }
    const raw = readFileSync(src, 'utf8')
    nextFiles[rel] = {
      kind: 'tracked',
      sourceHash: sha256(raw),
    }
    const prev = manifest.files?.[rel]
    if (prev && prev.kind === 'tracked' && prev.sourceHash !== sha256(raw)) {
      console.warn(
        `[sync] tracked file drifted upstream (manual review required): ${rel}`,
      )
    }
  }

  // The manifest is content-addressed on the file hashes; `generatedAt` is
  // informational only and excluded from drift comparison so `--check` is
  // stable across CI runs.
  const nextManifestBody = {
    landingRoot: relative(repoRoot, landingRoot),
    files: nextFiles,
  }
  const prevManifest = loadManifest()
  const prevManifestBody = {
    landingRoot: prevManifest.landingRoot,
    files: prevManifest.files ?? {},
  }
  const bodyChanged =
    JSON.stringify(prevManifestBody) !== JSON.stringify(nextManifestBody)
  if (bodyChanged) {
    if (CHECK_MODE) {
      console.error('[sync:check] manifest out of date')
      drift = true
    } else {
      const withTimestamp = {
        generatedAt: new Date().toISOString(),
        ...nextManifestBody,
      }
      writeFileSync(manifestPath, `${JSON.stringify(withTimestamp, null, 2)}\n`)
      console.log(`[sync] wrote ${relative(repoRoot, manifestPath)}`)
    }
  }

  if (drift) process.exit(1)
}

main()
