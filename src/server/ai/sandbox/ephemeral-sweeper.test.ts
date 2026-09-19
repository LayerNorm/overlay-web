import assert from 'node:assert/strict'
import test from 'node:test'
import { sweepEphemeralSandboxes, type EphemeralSandboxListItem } from './ephemeral-sweeper'

function pages(...items: EphemeralSandboxListItem[]) {
  return (async function* () {
    yield { sandboxes: items }
  })()
}

test('sweep deletes stale non-persistent sandboxes and skips fresh or persistent ones', async () => {
  const now = Date.now()
  const removed: string[] = []
  const result = await sweepEphemeralSandboxes({
    staleAfterMs: 15 * 60_000,
    deps: {
      hasCredentials: () => true,
      list: () => pages(
        // Orphaned run sandbox — deleted.
        { name: 'overlay-sandbox-user-1', persistent: false, createdAt: now - 20 * 60_000 },
        // Still inside the grace window — kept.
        { name: 'overlay-sandbox-user-2', persistent: false, createdAt: now - 60_000 },
        // Persistent sandboxes are never touched even if ancient: managed
        // hosts/harnesses/computers live behind other prefixes AND this flag.
        { name: 'overlay-sandbox-impostor', persistent: true, createdAt: now - 60 * 60_000 },
        { name: 'overlay-cloud-agent-host', persistent: true, createdAt: now - 60 * 60_000 },
      ),
      remove: async (name) => { removed.push(name) },
    },
  })
  assert.deepEqual(result.swept, ['overlay-sandbox-user-1'])
  assert.deepEqual(removed, ['overlay-sandbox-user-1'])
  assert.equal(result.errors, 0)
})

test('sweep counts delete failures without aborting the page', async () => {
  const now = Date.now()
  const result = await sweepEphemeralSandboxes({
    staleAfterMs: 60_000,
    deps: {
      hasCredentials: () => true,
      list: () => pages(
        { name: 'overlay-sandbox-a', persistent: false, createdAt: now - 120_000 },
        { name: 'overlay-sandbox-b', persistent: false, createdAt: now - 120_000 },
      ),
      remove: async (name) => {
        if (name.endsWith('-a')) throw new Error('provider refused')
      },
    },
  })
  assert.deepEqual(result.swept, ['overlay-sandbox-b'])
  assert.equal(result.errors, 1)
})

test('sweep is a no-op when Vercel sandbox credentials are unconfigured', async () => {
  let listed = false
  const result = await sweepEphemeralSandboxes({
    deps: {
      hasCredentials: () => false,
      list: () => { listed = true; return pages() },
    },
  })
  assert.equal(result.skipped, 'credentials_unconfigured')
  assert.equal(listed, false)
})
