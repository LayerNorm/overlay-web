/**
 * ESLint over the files a change actually touched.
 *
 * `next build` runs ESLint, so a lint error is otherwise only discovered by a
 * multi-minute Vercel build. A full `npm run lint` takes ~30s over the whole
 * repository; the handful of files in a typical change takes a few seconds.
 *
 * What this does and does not cover: every rule ESLint applies is evaluated per
 * file, so linting the changed files is sufficient for them — including React
 * Compiler's `react-hooks/preserve-manual-memoization`, which fails a build when
 * a component's manual `useCallback`/`useMemo` dependencies stop matching what
 * the compiler infers. It does not cover whole-program checks: run
 * `npm run typecheck` for types and the boundary scripts it wraps.
 *
 * Usage:
 *   node scripts/lint-changed.mjs                      # staged files, else the working tree vs HEAD
 *   node scripts/lint-changed.mjs --staged             # staged files only (pre-commit)
 *   node scripts/lint-changed.mjs --range a1b2c3..HEAD # an explicit push or merge range
 *   node scripts/lint-changed.mjs src/a.tsx src/b.ts   # explicit files
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Extensions the ESLint flat config actually has rules for. */
const LINTABLE = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

/**
 * Past this many files, linting them individually costs more than the whole
 * repository, and a big merge push should not look like a hung hook.
 */
const FULL_LINT_THRESHOLD = 150

/**
 * `ok` is reported separately from the file list because "git could not resolve
 * that revision" and "nothing changed" both produce no output, and treating the
 * first as the second would silently lint nothing — exactly the failure this
 * script exists to prevent. An unresolvable range falls back to a full lint.
 */
function git(args) {
  const result = spawnSync('git', args, { cwd: projectRoot, encoding: 'utf8' })
  const lines = (result.stdout ?? '').split('\n').map((line) => line.trim()).filter(Boolean)
  return { ok: result.status === 0, lines, stderr: (result.stderr ?? '').trim() }
}

function readOption(name) {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function changedFiles() {
  const explicit = process.argv.slice(2).filter((arg) => !arg.startsWith('-'))
  const range = readOption('--range')
  // `--range` takes its value as the next argv entry, which would otherwise be
  // mistaken for an explicit path.
  const paths = range ? explicit.filter((arg) => arg !== range) : explicit
  if (paths.length > 0) return { files: paths, source: 'the files named on the command line' }

  if (range) {
    const diff = git(['diff', '--name-only', '--diff-filter=ACMR', range])
    if (!diff.ok) return { files: [], source: range, unresolved: diff.stderr || 'unknown revision' }
    return { files: diff.lines, source: range }
  }

  const staged = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
  if (staged.ok && (staged.lines.length > 0 || process.argv.includes('--staged'))) {
    return { files: staged.lines, source: 'the staged changes' }
  }

  // Unstaged edits plus new files, so a file that has never been committed is
  // still checked before it reaches a build.
  const tracked = git(['diff', '--name-only', '--diff-filter=ACMR', 'HEAD'])
  const untracked = git(['ls-files', '--others', '--exclude-standard'])
  if (!tracked.ok) {
    return { files: [], source: 'the working tree vs HEAD', unresolved: tracked.stderr || 'no HEAD commit' }
  }
  return { files: [...tracked.lines, ...untracked.lines], source: 'the working tree vs HEAD' }
}

const { files, source, unresolved } = changedFiles()
const lintable = [...new Set(files)]
  .filter((file) => LINTABLE.has(path.extname(file)))
  // A deleted or renamed-away path is still listed by some diff filters, and
  // ESLint treats a missing file as a hard error.
  .filter((file) => existsSync(path.join(projectRoot, file)))

if (lintable.length === 0 && !unresolved) {
  console.log(`lint-changed: no lintable files in ${source} — nothing to check.`)
  process.exit(0)
}

// An unresolvable range means the changed set is unknown, not empty — lint
// everything rather than reporting a pass nobody verified.
const full = Boolean(unresolved) || lintable.length > FULL_LINT_THRESHOLD
console.log(
  unresolved
    ? `lint-changed: could not resolve ${source} (${unresolved}); running the full lint instead.`
    : full
      ? `lint-changed: ${lintable.length} files changed in ${source}; running the full lint instead.`
      : `lint-changed: linting ${lintable.length} file${lintable.length === 1 ? '' : 's'} from ${source}.`,
)

// Resolved from the package root rather than `eslint/bin/eslint.js`, which
// ESLint 9 does not list in its `exports` map.
const eslintBin = path.join(path.dirname(require.resolve('eslint/package.json')), 'bin', 'eslint.js')
const result = spawnSync(
  process.execPath,
  // Explicit paths make ESLint complain about anything its config ignores;
  // those files are ignored on purpose, so the notice is noise.
  full ? [eslintBin] : [eslintBin, '--no-warn-ignored', ...lintable],
  { cwd: projectRoot, stdio: 'inherit' },
)

if (result.error) {
  console.error(`lint-changed: could not run ESLint — ${result.error.message}`)
  process.exit(1)
}
process.exit(result.status ?? 1)
