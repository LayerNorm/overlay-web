/**
 * Workflow bundle hygiene — the Workflow builder's fast-discovery pass
 * regex-scans the RAW SOURCE of every project file (comments included) for
 * import specifiers, walks the graph, and inlines every reachable
 * serde-registered package into the vm-serialized workflow bundle, where it
 * is evaluated eagerly at runInContext time.
 *
 * The `chat` package ships serde classes whose module scope touches globals
 * the vm does not provide (`new AbortController()`), so a single literal
 * specifier resolving to it — a static import, type import, or dynamic
 * import of the SDK in ANY source file — kills every workflow run in the
 * deployment with `ReferenceError: AbortController is not defined`.
 * (This comment intentionally avoids writing an actual dynamic-import
 * literal — the scanner does not strip comments before matching.)
 *
 * `surfaces/chat.ts` itself is safe to import: it loads the SDK through a
 * specifier that is deliberately invisible to the scan (see the inline
 * comment in that file — it is load-bearing).
 */

import assert from 'node:assert/strict'
import { existsSync, globSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

// Mirrors @workflow/builders fast-discovery IMPORT_SPECIFIER_PATTERNS — these
// match raw text, including inside comments and type-only imports.
const SPECIFIER_PATTERNS = [
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /(?:^|[;\n])\s*import\s+['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
]

function literalSpecifiers(source: string): string[] {
  const specifiers = new Set<string>()
  for (const pattern of SPECIFIER_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) specifiers.add(match[1])
    }
  }
  return [...specifiers]
}

function resolveBarePackage(importer: string, specifier: string): string | null {
  const packageName = specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0]
  let dir = path.dirname(importer)
  while (dir !== '/') {
    const packageDir = path.join(dir, 'node_modules', packageName)
    if (existsSync(packageDir)) {
      try {
        const subpath = specifier.slice(packageName.length) || '/'
        const manifest = JSON.parse(
          readFileSync(path.join(packageDir, 'package.json'), 'utf8'),
        )
        const exportsEntry =
          manifest.exports?.[subpath === '/' ? '.' : `.${subpath}`]
        const file =
          (typeof exportsEntry === 'object'
            ? exportsEntry.import ??
              exportsEntry.default ??
              exportsEntry.require ??
              exportsEntry.types
            : exportsEntry) ??
          (subpath === '/' ? manifest.module ?? manifest.main : `.${subpath}`)
        if (!file) return null
        const resolved = path.join(packageDir, file)
        return existsSync(resolved) ? realpathSync(resolved) : resolved
      } catch {
        return null
      }
    }
    dir = path.dirname(dir)
  }
  return null
}

function sourceFiles(): string[] {
  // The real discovery scans the whole project; scanning the code dirs covers
  // every file an application author can add a specifier to.
  const dirs = ['src', 'packages', 'convex', 'scripts', 'e2e', 'tests']
  return dirs.flatMap((dir) => {
    const cwd = path.join(ROOT, dir)
    if (!existsSync(cwd)) return []
    return globSync('**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}', {
      cwd,
      absolute: true,
      exclude: [
        '**/node_modules/**',
        '**/.next/**',
        '**/.well-known/workflow/**',
        '**/dist/**',
      ],
    })
  })
}

test('no source file contains a literal specifier resolving to the chat SDK', () => {
  const offenders: string[] = []
  for (const file of sourceFiles()) {
    let source: string
    try {
      source = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const specifier of literalSpecifiers(source)) {
      if (specifier === 'chat' || specifier.startsWith('chat/')) {
        offenders.push(`${path.relative(ROOT, file)} -> ${specifier}`)
        continue
      }
      if (specifier.startsWith('.') || specifier.startsWith('@/')) continue
      const resolved = resolveBarePackage(file, specifier)
      if (resolved && resolved.includes('/node_modules/chat/')) {
        offenders.push(`${path.relative(ROOT, file)} -> ${specifier}`)
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'The chat SDK must never be reachable via a literal import specifier: ' +
      'its serde chunk is auto-serialized into the workflow vm bundle and ' +
      'throws `AbortController is not defined` at init, killing every ' +
      'workflow run. Use the evaded specifier pattern in surfaces/chat.ts ' +
      'or surface-agent-turn.ts instead.',
  )
})
