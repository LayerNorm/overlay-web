/**
 * Point this repository at the tracked hooks in `.githooks`.
 *
 * Git hooks in `.git/hooks` are untracked and per clone, so a shared guard has
 * to be installed. `core.hooksPath` is the dependency-free way to do that: the
 * hooks stay in the repository, get reviewed like any other file, and apply to
 * every worktree because the setting lives in the shared config.
 *
 * Wired to the `prepare` lifecycle so `npm install` installs the hooks. It never
 * fails the install: a missing hook is an inconvenience, a failed `npm install`
 * is a blocked developer or a broken deployment.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HOOKS_PATH = '.githooks'

function skip(reason) {
  // Quiet by default: this runs on every `npm install`, including on build
  // machines where hooks are meaningless.
  if (process.env.OVERLAY_HOOKS_VERBOSE) console.log(`install-git-hooks: skipped — ${reason}`)
  process.exit(0)
}

// Build machines clone the repository but never push from it.
if (process.env.CI || process.env.VERCEL) skip('running in CI or on Vercel')
if (!existsSync(path.join(projectRoot, HOOKS_PATH))) skip(`${HOOKS_PATH} is missing`)

const inside = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
  cwd: projectRoot,
  encoding: 'utf8',
})
if (inside.status !== 0) skip('not a git working tree')

const current = spawnSync('git', ['config', '--get', 'core.hooksPath'], {
  cwd: projectRoot,
  encoding: 'utf8',
})
if (current.stdout.trim() === HOOKS_PATH) skip('already installed')

const set = spawnSync('git', ['config', 'core.hooksPath', HOOKS_PATH], {
  cwd: projectRoot,
  encoding: 'utf8',
})
if (set.status !== 0) skip(`git config failed: ${set.stderr.trim()}`)

console.log(`install-git-hooks: core.hooksPath -> ${HOOKS_PATH} (pre-push lints the commits being pushed)`)
