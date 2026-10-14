import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const SRC_ROOT = path.join(import.meta.dirname)

const SERVER_IMPORT = /(?:from|import)\s+['"](@\/server\/|\.{1,2}\/[^'"]*\bserver\b)/

test('client modules never import server-only code or the Convex secret module', () => {
  const violations: string[] = []
  for (const file of walk(SRC_ROOT)) {
    const source = readFileSync(file, 'utf8')
    if (!/^['"]use client['"]/.test(source)) continue
    for (const line of source.split('\n')) {
      if (SERVER_IMPORT.test(line) || /convex-admin/.test(line)) {
        violations.push(`${path.relative(SRC_ROOT, file)}: ${line.trim()}`)
      }
    }
  }
  assert.deepEqual(violations, [])
})

test('every server module opts into server-only', () => {
  const missing: string[] = []
  const serverRoot = path.join(SRC_ROOT, 'server')
  for (const file of walk(serverRoot)) {
    if (file.endsWith('.test.ts')) continue
    if (!readFileSync(file, 'utf8').includes("'server-only'")) {
      missing.push(path.relative(SRC_ROOT, file))
    }
  }
  assert.deepEqual(missing, [])
})

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      yield* walk(full)
    } else if (/\.(ts|tsx)$/.test(entry)) {
      yield full
    }
  }
}
