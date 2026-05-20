#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
const forbidden = [
  'WORKOS_API_KEY',
  'DEV_WORKOS_API_KEY',
  'SESSION_SECRET',
  'SESSION_TRANSFER_KEY',
  'SESSION_COOKIE_ENCRYPTION_KEY',
  'INTERNAL_API_SECRET',
  'INTERNAL_SERVICE_AUTH_SECRET',
  'PROVIDER_KEYS_SECRET',
  'STRIPE_SECRET_KEY',
  'OPENROUTER_API_KEY',
  'GROQ_API_KEY',
  'NVIDIA_API_KEY',
]

const ignoredDirs = new Set([
  '.git',
  'node_modules',
  'ios',
  'android',
  '.expo',
])

const allowedFiles = new Set([
  'scripts/ensure-no-secret-env.cjs',
])

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.env.local') continue
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) walk(path.join(dir, entry.name), out)
      continue
    }
    if (!/\.(ts|tsx|js|jsx|json|cjs|mjs)$/.test(entry.name)) continue
    out.push(path.join(dir, entry.name))
  }
  return out
}

const violations = []
for (const file of walk(root)) {
  const rel = path.relative(root, file)
  if (allowedFiles.has(rel)) continue
  const text = fs.readFileSync(file, 'utf8')
  for (const key of forbidden) {
    if (text.includes(key)) {
      violations.push(`${rel}: references forbidden server secret ${key}`)
    }
  }
}

if (violations.length > 0) {
  console.error('Forbidden server secret references found in mobile code:')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}

console.log('No forbidden server secret references found.')
