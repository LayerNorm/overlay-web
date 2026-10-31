#!/usr/bin/env node
// Advisory only: ordinary CI still executes both exhaustive shards.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { INTEGRATION_TESTS } from './integration-tests.mjs'

export function selectAffected({ changed, tests, dependencies, unknown = false }) {
  const full = reason => ({ mode: 'full', reason, tests: [...tests].sort() })
  if (unknown || !changed.length) return full('Unknown or empty change inventory')
  if (changed.some(file => !dependencies.has(file))) return full('Changed input outside the source graph')
  const impacted = new Set()
  for (const input of changed) {
    const dependents = new Set([input])
    let more = true
    while (more) {
      more = false
      for (const [file, imports] of dependencies) {
        if (!dependents.has(file) && imports.some(source => dependents.has(source))) {
          dependents.add(file); more = true
        }
      }
    }
    if (!tests.some(file => dependents.has(file))) return full(`No covering test for ${input}`)
    for (const file of dependents) impacted.add(file)
  }
  const selected = tests.filter(file => impacted.has(file)).sort()
  return selected.length ? { mode: 'candidate', reason: 'Transitive import graph; shadow only', tests: selected }
    : full('No covering test found; never infer a safe skip')
}

export function analyze(root, changed) {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
  const tests = tracked.filter(file => /\.test\.(ts|tsx|mts|mjs)$/.test(file) && !INTEGRATION_TESTS.has(file))
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile)
  if (config.error) throw new Error('Cannot read TypeScript configuration')
  const { options, errors } = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
  if (errors.length) throw new Error('Cannot resolve TypeScript configuration')
  const dependencies = new Map()
  let unknown = false
  for (const file of tracked.filter(file => /\.(ts|tsx|mts|mjs|js|jsx|cjs)$/.test(file))) {
    const absolute = path.join(root, file)
    const imports = []
    const source = ts.createSourceFile(absolute, fs.readFileSync(absolute, 'utf8'), ts.ScriptTarget.Latest, true)
    const add = specifier => {
      const resolved = ts.resolveModuleName(specifier, absolute, options, ts.sys).resolvedModule?.resolvedFileName
      if (resolved && !resolved.includes('/node_modules/')) imports.push(path.relative(root, resolved).split(path.sep).join('/'))
      else if (!resolved && (specifier.startsWith('.') || specifier.startsWith('@/') || specifier.startsWith('@overlay/'))) unknown = true
    }
    const visit = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) add(node.moduleSpecifier.text)
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
        if (node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) add(node.arguments[0].text)
        else unknown = true
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    dependencies.set(file, imports)
  }
  return selectAffected({ changed, tests, dependencies, unknown })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = process.argv[2]
  if (!/^[a-f0-9]{40}$/.test(base ?? '')) throw new Error('Pass a full base commit SHA')
  const changed = execFileSync('git', ['diff', '--name-only', '-z', base, 'HEAD'], { encoding: 'utf8' }).split('\0').filter(Boolean)
  console.log(JSON.stringify(analyze(process.cwd(), changed), null, 2))
}
