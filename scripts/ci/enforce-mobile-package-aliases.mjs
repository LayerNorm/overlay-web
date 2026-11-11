#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const packages = ['api-client', 'app-core', 'chat-core', 'workspace-contracts']
const options = { moduleResolution: ts.ModuleResolutionKind.Bundler }
const visited = new Set()
const violations = []

function visit(file) {
  file = realpathSync(file)
  if (visited.has(file) || file.includes(`${path.sep}node_modules${path.sep}`)) return
  visited.add(file)
  // Include type-only imports and re-exports, which bundlers erase.
  const { importedFiles } = ts.preProcessFile(readFileSync(file, 'utf8'), true, true)
  for (const { fileName: specifier } of importedFiles) {
    if (specifier.startsWith('@/')) {
      violations.push(`${path.relative(root, file)}: ${specifier}`)
      continue
    }
    const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule
    if (resolved) visit(resolved.resolvedFileName)
    else if (specifier.startsWith('.') || specifier.startsWith('@overlay/')) {
      violations.push(`${path.relative(root, file)}: unresolved ${specifier}`)
    }
  }
}

for (const name of packages) {
  const dir = path.join(root, 'packages', `overlay-${name}`)
  const manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
  for (const entry of Object.values(manifest.exports)) visit(path.resolve(dir, entry))
}

if (violations.length) {
  console.error(`Mobile package portability violations:\n${violations.join('\n')}`)
  process.exitCode = 1
} else {
  console.log(`OK: ${packages.length} mobile packages, ${visited.size} reachable modules, 0 @/ leaks (including type imports).`)
}
