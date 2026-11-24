/**
 * Every Convex cron must point at a function that exists. Targets written as
 * `(internal as any).a.b.fn` escape typechecking, so a removed module would
 * only fail at Convex deploy (or, worse, keep a dead tick in production).
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const convexDir = join(process.cwd(), 'convex')
const crons = readFileSync(join(convexDir, 'crons.ts'), 'utf8')
const code = crons.split('\n').filter(line => !line.trim().startsWith('//')).join('\n')
const targets = [...code.matchAll(/\binternal(?: as any\))?((?:\.\w+)+)/g)]
  .map(match => match[1].slice(1).split('.'))
  .filter(parts => parts.length >= 2)

test('crons.ts registers targets', () => {
  assert.ok(targets.length >= 15, `expected the cron targets to parse, found ${targets.length}`)
})

test('every cron target resolves to an exported Convex function', () => {
  for (const parts of targets) {
    const fn = parts.at(-1)!
    const modulePath = join(convexDir, ...parts.slice(0, -1)) + '.ts'
    assert.ok(existsSync(modulePath), `cron target ${parts.join('.')} has no module ${modulePath}`)
    assert.match(readFileSync(modulePath, 'utf8'), new RegExp(`export const ${fn}\\b`),
      `cron target ${parts.join('.')} is not exported by its module`)
  }
})

test('no cron polls the Workflow SDK for automation runs', () => {
  // Automation runs store `automation-thread:<runId>` owner tokens, not SDK run
  // IDs; the removed projector asked the SDK for them and failed every tick.
  assert.doesNotMatch(crons, /workflowEventProjector|project-events/)
})
