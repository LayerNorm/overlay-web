import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src')
const webImport = /(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*)['"](?:@\/|next\/)/

async function sourceFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map((entry) => {
    const file = path.join(directory, entry.name)
    return entry.isDirectory() ? sourceFiles(file) : [file]
  }))
  return nested.flat()
}

test('shell source has no web-only imports', async () => {
  for (const file of await sourceFiles(sourceRoot)) {
    const source = await fs.readFile(file, 'utf8')
    assert.doesNotMatch(source, webImport, path.relative(sourceRoot, file))
  }
})
