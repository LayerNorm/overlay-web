import assert from 'node:assert/strict'
import test from 'node:test'
import {
  computerDiagnosticsBatches,
  computerLspLanguage,
  parseComputerDiagnostics,
  summarizeComputerDiagnostics,
  type ComputerFileDiagnostics,
} from './computer-diagnostics'

const error = (message: string, line = 1, code: string | number = 2322) => ({ line, column: 1, severity: 'error' as const, message, code })
const warning = (message: string, line = 1) => ({ line, column: 1, severity: 'warning' as const, message })

test('languages come from the extension and declaration files are skipped', () => {
  assert.equal(computerLspLanguage('/r/a.tsx'), 'typescript')
  assert.equal(computerLspLanguage('/r/a.MJS'), 'typescript')
  assert.equal(computerLspLanguage('/r/m.py'), 'python')
  assert.equal(computerLspLanguage('/r/types.d.ts'), null)
  assert.equal(computerLspLanguage('/r/main.rs'), null)
})

test('batches group by language, drop duplicates and cap file counts', () => {
  const many = Array.from({ length: 30 }, (_, index) => `/r/f${index}.ts`)
  const batches = computerDiagnosticsBatches(['/r/a.py', '/r/a.py', '/r/readme.md', ...many])
  assert.deepEqual(batches.map(batch => batch.language).sort(), ['python', 'typescript'])
  assert.equal(batches.find(batch => batch.language === 'python')!.paths.length, 1)
  assert.equal(batches.find(batch => batch.language === 'typescript')!.paths.length, 20)
})

test('only problems the edit introduced are reported, even when lines shift', () => {
  const before: ComputerFileDiagnostics[] = [{ path: '/r/a.ts', total: 2, diagnostics: [error('old', 3), warning('unused', 9)] }]
  const after: ComputerFileDiagnostics[] = [{
    path: '/r/a.ts',
    total: 4,
    diagnostics: [error('old', 5), warning('unused', 11), error('new one', 2), { line: 1, column: 1, severity: 'hint', message: 'ignored' }],
  }]
  const summary = summarizeComputerDiagnostics(before, after)
  assert.deepEqual(summary.introduced.map(item => item.message), ['new one'])
  assert.equal(summary.errorCount, 2)
  assert.equal(summary.warningCount, 1)
  assert.equal(summary.resolvedCount, 0)
  assert.equal(summary.compared, true)
})

test('fixed problems count as resolved, and duplicates are matched one for one', () => {
  const before: ComputerFileDiagnostics[] = [{ path: '/r/a.ts', total: 3, diagnostics: [error('dup'), error('dup'), error('gone')] }]
  const after: ComputerFileDiagnostics[] = [{ path: '/r/a.ts', total: 3, diagnostics: [error('dup'), error('dup'), error('dup')] }]
  const summary = summarizeComputerDiagnostics(before, after)
  assert.equal(summary.introduced.length, 1)
  assert.equal(summary.resolvedCount, 1)
})

test('without a baseline every current problem is listed, errors first, and pending files are named', () => {
  const after: ComputerFileDiagnostics[] = [
    { path: '/r/a.py', total: 2, diagnostics: [warning('w'), error('e')] },
    { path: '/r/b.py', total: 0, diagnostics: [], pending: true },
  ]
  const summary = summarizeComputerDiagnostics(null, after)
  assert.equal(summary.compared, false)
  assert.deepEqual(summary.introduced.map(item => item.severity), ['error', 'warning'])
  assert.deepEqual(summary.pending, ['/r/b.py'])
})

test('long lists are capped', () => {
  const after: ComputerFileDiagnostics[] = [{ path: '/r/a.ts', total: 40, diagnostics: Array.from({ length: 40 }, (_, index) => error(`e${index}`)) }]
  const summary = summarizeComputerDiagnostics([], after)
  assert.equal(summary.introduced.length, 30)
  assert.equal(summary.truncated, true)
  assert.equal(summary.errorCount, 40)
})

test('driver payloads are parsed defensively', () => {
  const parsed = parseComputerDiagnostics({
    files: [
      { path: '/r/a.ts', total: 1, diagnostics: [{ line: 2, column: 7, severity: 'error', message: 'bad', code: 2322, source: 'typescript' }, { nope: true }] },
      { path: 5 },
      { path: '/r/b.ts', diagnostics: [], pending: true },
    ],
  })
  assert.equal(parsed.length, 2)
  assert.equal(parsed[0]!.diagnostics.length, 1)
  assert.equal(parsed[0]!.diagnostics[0]!.code, 2322)
  assert.equal(parsed[1]!.pending, true)
  assert.deepEqual(parseComputerDiagnostics(null), [])
})
