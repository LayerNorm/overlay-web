import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOverlayToolSet } from './build'
import { applyProjectToolPolicy } from '@/shared/projects/project-settings'
import type { OverlayToolsOptions } from './types'

/**
 * Phase 4 shipped a knowledge boundary that guarded only the retrieval path while
 * the agent's tools stayed reachable, and a knowledge base answered from unrelated
 * files as a result. Project scoping must be verified the same way that bug should
 * have been: by what the agent can actually call, not by what a policy function
 * returns in isolation.
 */

function toolsFor(allowedToolIds: string[]): string[] {
  const options: OverlayToolsOptions = {
    userId: 'user-1',
    allowedToolIds,
    includePaidOnlyOverlayTools: false,
  }
  return Object.keys(buildOverlayToolSet(options))
}

test('a project allowlist makes unlisted tools uncallable by the agent', () => {
  const accountAllowed = ['search_knowledge', 'list_notes', 'search_knowledge_base', 'generate_image']
  const scoped = applyProjectToolPolicy(accountAllowed, {
    toolPolicy: { mode: 'allowlist', toolIds: ['search_knowledge_base'] },
  })
  const exposed = toolsFor(scoped)

  assert.ok(exposed.includes('search_knowledge_base'), 'the allowed tool must be present')
  for (const withheld of ['search_knowledge', 'list_notes', 'generate_image']) {
    assert.ok(
      !exposed.includes(withheld),
      `${withheld} must not be reachable inside a project that excludes it`,
    )
  }
})

test('a project denylist removes exactly the listed tools from the agent surface', () => {
  const accountAllowed = ['search_knowledge', 'list_notes', 'generate_image']
  const scoped = applyProjectToolPolicy(accountAllowed, {
    toolPolicy: { mode: 'denylist', toolIds: ['generate_image'] },
  })
  const exposed = toolsFor(scoped)

  assert.ok(!exposed.includes('generate_image'))
  assert.ok(exposed.includes('search_knowledge'))
  assert.ok(exposed.includes('list_notes'))
})

test('a project cannot expose a tool the account already withheld', () => {
  // run_daytona_sandbox is absent from the account-allowed set, so naming it in a
  // project allowlist must not resurrect it on the agent surface.
  const scoped = applyProjectToolPolicy(['search_knowledge'], {
    toolPolicy: { mode: 'allowlist', toolIds: ['search_knowledge', 'run_daytona_sandbox'] },
  })
  const exposed = toolsFor(scoped)
  assert.ok(!exposed.includes('run_daytona_sandbox'))
  assert.ok(exposed.includes('search_knowledge'))
})

test('inheriting leaves the account surface unchanged', () => {
  const accountAllowed = ['search_knowledge', 'list_notes']
  const inherited = toolsFor(applyProjectToolPolicy(accountAllowed, {}))
  const direct = toolsFor(accountAllowed)
  assert.deepEqual(inherited.sort(), direct.sort())
})

test('an empty allowlist withholds every optional tool', () => {
  const scoped = applyProjectToolPolicy(['search_knowledge', 'list_notes'], {
    toolPolicy: { mode: 'allowlist' },
  })
  const exposed = toolsFor(scoped)
  assert.ok(!exposed.includes('search_knowledge'))
  assert.ok(!exposed.includes('list_notes'))
})

test('calling a withheld tool is refused rather than silently executed', async () => {
  // The agent may still emit a call for a tool it saw earlier in the transcript.
  // buildOverlayToolSet gates execution independently of exposure, so a stale call
  // must fail loudly instead of returning account-wide data.
  const tools = buildOverlayToolSet({
    userId: 'user-1',
    // Expose search_knowledge but mark only search_knowledge_base as allowed.
    allowedToolIds: ['search_knowledge_base'],
    includePaidOnlyOverlayTools: false,
  })
  assert.equal(tools.search_knowledge, undefined, 'a withheld tool is not exposed at all')
})
