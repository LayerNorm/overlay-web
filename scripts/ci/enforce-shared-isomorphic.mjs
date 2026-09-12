#!/usr/bin/env node
/**
 * Phase 1.4 guard: src/shared must stay isomorphic (safe for client + server bundles).
 * Excludes *.test.ts (Node test runner) and src/shared/env/public-env.ts (sole env reader).
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..')
const sharedRoot = path.join(root, 'src/shared')

const EXEMPT = new Set([
  path.join(sharedRoot, 'env/public-env.ts'),
])

const FORBIDDEN_PATTERNS = [
  { name: 'process.env', re: /\bprocess\.env\b/ },
  { name: 'node: builtin import', re: /from\s+['"]node:/ },
  { name: 'node: require', re: /require\s*\(\s*['"]node:/ },
  { name: 'fs import', re: /from\s+['"]fs['"]/ },
  { name: 'server-only', re: /['"]server-only['"]/ },
  { name: '@sentry/nextjs', re: /from\s+['"]@sentry\/nextjs['"]/ },
  { name: 'NextRequest in shared', re: /from\s+['"]next\/server['"]/ },
  { name: '@/server import', re: /from\s+['"]@\/server\// },
]

async function walk(dir, out = []) {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(full, out)
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
      out.push(full)
    }
  }
  return out
}

const files = await walk(sharedRoot)
const violations = []

for (const file of files) {
  if (EXEMPT.has(file)) continue
  const text = await readFile(file, 'utf8')
  for (const { name, re } of FORBIDDEN_PATTERNS) {
    if (re.test(text)) {
      violations.push({ file: path.relative(root, file), rule: name })
    }
  }
  if (text.includes("'use client'") || text.includes('"use client"')) {
    violations.push({
      file: path.relative(root, file),
      rule: 'use client (move to src/components or src/features)',
    })
  }
}

if (violations.length > 0) {
  console.error('shared isomorphic boundary violations:\n')
  for (const v of violations) {
    console.error(`  ${v.file}: ${v.rule}`)
  }
  process.exit(1)
}

console.log(`OK: ${files.length} shared modules pass isomorphic checks (excluding tests + public-env).`)
