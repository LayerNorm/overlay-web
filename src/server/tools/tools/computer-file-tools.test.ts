import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  COMPUTER_READ_MAX_LINE_CHARS,
  computerContentSha,
  computerGlobArgs,
  computerGrepArgs,
  parseComputerGlobOutput,
  parseComputerGrepOutput,
  ripgrepFailed,
  sliceComputerLines,
} from './computer-file-tools'

test('line slices are numbered, 1-based and say where to continue', () => {
  const text = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
  const slice = sliceComputerLines(text, { offset: 3, limit: 4 })
  assert.equal(slice.content, '3\tline 3\n4\tline 4\n5\tline 5\n6\tline 6')
  assert.equal(sliceComputerLines(text, { offset: 9, limit: 2 }).content, ' 9\tline 9\n10\tline 10')
  assert.equal(slice.totalLines, 12)
  assert.equal(slice.endLine, 6)
  assert.equal(slice.truncated, true)
  assert.match(slice.note!, /offset 7/)
  const all = sliceComputerLines(text)
  assert.equal(all.truncated, false)
  assert.equal(all.note, undefined)
  assert.match(sliceComputerLines(text, { offset: 50 }).note!, /past the end/)
  assert.equal(sliceComputerLines('a\nb', { numbered: false }).content, 'a\nb')
})

test('very long lines are cut off instead of flooding context', () => {
  const slice = sliceComputerLines('x'.repeat(COMPUTER_READ_MAX_LINE_CHARS * 3))
  assert.ok(slice.content.length < COMPUTER_READ_MAX_LINE_CHARS + 100)
  assert.match(slice.content, /line cut off/)
})

test('content sha is stable and changes with content', () => {
  assert.equal(computerContentSha('abc'), computerContentSha(new TextEncoder().encode('abc')))
  assert.notEqual(computerContentSha('abc'), computerContentSha('abd'))
  assert.equal(computerContentSha('abc').length, 16)
})

test('grep patterns that look like flags stay patterns', () => {
  const args = computerGrepArgs({ pattern: '--files', path: '-rf' }, '/home/user')
  assert.deepEqual(args.slice(-4), ['-e', '--files', '--', '-rf'])
})

const hasRipgrep = spawnSync('rg', ['--version']).status === 0

function fixtureRepo() {
  const root = mkdtempSync(join(tmpdir(), 'computer-grep-'))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'old.ts'), 'export const alpha = 1\nconst beta = alpha + 1\n')
  writeFileSync(join(root, 'src', 'new.ts'), 'import { alpha } from "./old"\nconsole.log(alpha)\nconsole.log(alpha)\n')
  writeFileSync(join(root, 'README.md'), 'alpha docs\n')
  const past = new Date(Date.now() - 60_000)
  utimesSync(join(root, 'src', 'old.ts'), past, past)
  return root
}

function rg(args: string[]) {
  const result = spawnSync('rg', args, { encoding: 'utf8' })
  assert.equal(ripgrepFailed(result.status ?? 2), false, result.stderr)
  return result.stdout
}

test('grep finds files newest first, content with context, and counts', { skip: !hasRipgrep }, () => {
  const root = fixtureRepo()
  const files = parseComputerGrepOutput(rg(computerGrepArgs({ pattern: 'alpha', type: 'ts' }, root)), { pattern: 'alpha' })
  assert.equal(files.mode, 'files_with_matches')
  assert.deepEqual('files' in files ? files.files.map(f => f.slice(root.length)) : [], ['/src/new.ts', '/src/old.ts'])

  const input = { pattern: 'beta', output_mode: 'content' as const, context: 1 }
  const content = parseComputerGrepOutput(rg(computerGrepArgs(input, root)), input)
  assert.ok('matches' in content)
  assert.deepEqual(content.matches.map(m => [m.line, m.text, Boolean(m.context)]), [[1, 'export const alpha = 1', true], [2, 'const beta = alpha + 1', false]])
  assert.equal(content.totalMatches, 1)

  const countInput = { pattern: 'alpha', output_mode: 'count' as const, glob: '*.ts' }
  const counts = parseComputerGrepOutput(rg(computerGrepArgs(countInput, root)), countInput)
  assert.ok('counts' in counts)
  assert.equal(counts.totalMatches, 5)
  assert.match(counts.counts[0]!.path, /new\.ts$/)

  const capped = { pattern: 'alpha', output_mode: 'content' as const, max_results: 2 }
  const limited = parseComputerGrepOutput(rg(computerGrepArgs(capped, root)), capped)
  assert.ok('matches' in limited)
  assert.equal(limited.matches.length, 2)
  assert.equal(limited.truncated, true)
})

test('no match is not a failure', { skip: !hasRipgrep }, () => {
  const root = fixtureRepo()
  const result = spawnSync('rg', computerGrepArgs({ pattern: 'zzz-not-here' }, root), { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.equal(ripgrepFailed(1), false)
  assert.deepEqual(parseComputerGrepOutput(result.stdout, { pattern: 'x' }), { mode: 'files_with_matches', files: [], totalFiles: 0, truncated: false })
})

test('glob lists matching files newest first and skips .git', { skip: !hasRipgrep }, () => {
  const root = fixtureRepo()
  execFileSync('git', ['init', '-q'], { cwd: root })
  const output = parseComputerGlobOutput(rg(computerGlobArgs({ pattern: '**/*.ts' }, root)), { pattern: '**/*.ts' })
  assert.deepEqual(output.files.map(f => f.slice(root.length)), ['/src/new.ts', '/src/old.ts'])
  const one = parseComputerGlobOutput(rg(computerGlobArgs({ pattern: '*' }, root)), { pattern: '*', max_results: 1 })
  assert.equal(one.files.length, 1)
  assert.equal(one.truncated, true)
  assert.ok(!one.files.some(f => f.includes('/.git/')))
})
