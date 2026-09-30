#!/usr/bin/env node
/**
 * Runs every tracked test file in the repository with the runner it needs.
 *
 * The repo mixes several test styles, and no single runner can execute all of
 * them. This orchestrator discovers tests from `git ls-files`, classifies each
 * file, and runs one command per group so nothing is silently skipped:
 *
 *   node-esm   top-level `await import(...)` / `import.meta` suites that must run
 *              as native ES modules (`node --experimental-strip-types`)
 *   node-mjs   plain `.test.mjs` files
 *   tsx        everything else under the root tsconfig (default)
 *   package:*  published host packages whose `test` script builds first run
 *              their own `npm test`; other package tests join the tsx group
 *   vitest     Convex `*.convex.test.ts` suites (root `vitest.config.mts`) and
 *              other vitest suites (`vitest.unit.config.mts`)
 *
 * Usage:
 *   node scripts/ci/run-all-tests.mjs              # run every group
 *   node scripts/ci/run-all-tests.mjs --list       # print the classification
 *   node scripts/ci/run-all-tests.mjs --only tsx   # run groups whose name starts with a prefix
 */
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const args = process.argv.slice(2)
const listOnly = args.includes('--list')
const onlyIndex = args.indexOf('--only')
const onlyPrefix = onlyIndex >= 0 ? args[onlyIndex + 1] : undefined

const TEST_FILE = /\.test\.(?:ts|tsx|mts|mjs)$/
// A top-level await cannot be compiled to CommonJS, which is what tsx emits for
// `.ts` files in this non-module package, so those suites run as native ESM.
// Prefer static imports in new tests: native ESM cannot resolve `@/` aliases.
const NATIVE_ESM = /^(?:\} = \(?await |\(?await |(?:export )?(?:const|let|var) [^\n]*= \(?await )/m
const VITEST = /from ['"]vitest['"]/
const PRELOADS = [
  '--require=./scripts/ci/register-server-only.cjs',
  '--require=./scripts/ci/register-style-noop.cjs',
]
// Deterministic placeholders for modules that read config at import time.
// Tests never reach these endpoints.
const TEST_ENV = {
  NEXT_PUBLIC_CONVEX_URL: 'https://fixture.convex.cloud',
  INTERNAL_API_SECRET: 'test-internal-secret',
  NEXT_TELEMETRY_DISABLED: '1',
}

function trackedTestFiles() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter((file) => TEST_FILE.test(file))
    .sort()
}

function readPackageTestScript(packageDir) {
  const manifest = path.join(root, packageDir, 'package.json')
  if (!fs.existsSync(manifest)) return undefined
  return JSON.parse(fs.readFileSync(manifest, 'utf8')).scripts?.test
}

function classify(files) {
  const groups = new Map()
  const add = (key, spec, file) => {
    if (!groups.has(key)) groups.set(key, { ...spec, files: [] })
    groups.get(key).files.push(file)
  }

  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    const packageMatch = /^packages\/([^/]+)\//.exec(file)

    if (VITEST.test(source)) {
      const convex = file.endsWith('.convex.test.ts')
      add(convex ? 'vitest:convex' : 'vitest:unit', {
        kind: 'vitest',
        config: convex ? 'vitest.config.mts' : 'vitest.unit.config.mts',
        cwd: '.',
      }, file)
      continue
    }

    if (file.endsWith('.mjs')) {
      add('node-mjs', { kind: 'node', cwd: '.', esm: true }, file)
      continue
    }

    if (packageMatch) {
      // Published packages build before testing (their suites import `dist`).
      const packageDir = `packages/${packageMatch[1]}`
      if (readPackageTestScript(packageDir)?.includes('npm run build')) {
        add(`package:${packageMatch[1]}`, { kind: 'npm-test', cwd: packageDir }, file)
        continue
      }
    }

    if (NATIVE_ESM.test(source)) {
      add('node-esm', { kind: 'node', cwd: '.', esm: true, reactServer: true }, file)
      continue
    }

    add('tsx', { kind: 'tsx', cwd: '.' }, file)
  }
  return groups
}

function commandFor(group) {
  const env = { ...process.env, ...TEST_ENV }
  if (group.kind === 'vitest') {
    // Files are passed as filters so the config's include glob never pulls in
    // node:test suites that live beside vitest ones.
    return {
      cmd: 'npx',
      argv: ['vitest', 'run', '--config', group.config, '--reporter=dot', ...group.files],
      env,
    }
  }
  if (group.kind === 'npm-test') {
    return { cmd: 'npm', argv: ['test', '--silent'], env }
  }
  if (group.kind === 'node') {
    env.NODE_OPTIONS = [process.env.NODE_OPTIONS, group.reactServer ? '--conditions=react-server' : '']
      .filter(Boolean).join(' ')
    return {
      cmd: 'node',
      argv: ['--test', '--experimental-strip-types', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
        '--disable-warning=ExperimentalWarning', '--test-reporter=dot', ...group.files],
      env,
    }
  }
  env.NODE_OPTIONS = [process.env.NODE_OPTIONS, ...PRELOADS].filter(Boolean).join(' ')
  return {
    cmd: 'node',
    argv: ['--import', 'tsx', '--test', '--test-reporter=dot', ...group.files],
    env,
  }
}

const groups = classify(trackedTestFiles())
const selected = [...groups.entries()]
  .filter(([name]) => !onlyPrefix || name.startsWith(onlyPrefix))

if (listOnly) {
  for (const [name, group] of selected) {
    console.log(`${name} (${group.files.length}) [${group.kind}, cwd=${group.cwd}]`)
    for (const file of group.files) console.log(`  ${file}`)
  }
  process.exit(0)
}

const results = []
for (const [name, group] of selected) {
  const { cmd, argv, env } = commandFor(group)
  console.log(`\n▶ ${name}: ${group.files.length} file(s)`)
  const started = Date.now()
  const run = spawnSync(cmd, argv, {
    cwd: path.join(root, group.cwd),
    env,
    stdio: 'inherit',
  })
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  results.push({ name, ok: run.status === 0, seconds, files: group.files.length })
}

console.log('\nTest groups:')
for (const result of results) {
  console.log(`  ${result.ok ? '✔' : '✖'} ${result.name} (${result.files} files, ${result.seconds}s)`)
}
const failed = results.filter((result) => !result.ok)
if (failed.length > 0) {
  console.error(`\n${failed.length} test group(s) failed: ${failed.map(({ name }) => name).join(', ')}`)
  process.exit(1)
}
console.log(`\nAll ${results.length} test groups passed.`)
