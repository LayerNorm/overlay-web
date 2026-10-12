import assert from 'node:assert/strict'
import test from 'node:test'
import type { OverlayServerContext } from '@/server/bootstrap'
import { AccountDeletionService } from './AccountDeletionService'

function service(options: { providerRefs?: string[]; agentRefs?: string[]; failOn?: string[] } = {}) {
  const deleted: string[] = []
  const ctx = {
    appData: { repositories: {
      providerConnections: { listCredentialRefs: async () => options.providerRefs ?? [] },
      agentProviderAccounts: { listCredentialRefs: async () => options.agentRefs ?? [] },
    } },
    byokCredentialStore: {
      delete: async (ref: string) => {
        if (options.failOn?.includes(ref)) throw new Error('vault unavailable')
        deleted.push(ref)
      },
    },
  } as unknown as OverlayServerContext
  const run = (userId = 'user-1') => (new AccountDeletionService(ctx) as unknown as {
    deleteStoredCredentials(userId: string): Promise<void>
  }).deleteStoredCredentials(userId)
  return { run, deleted }
}

test('account deletion removes every stored credential, model-provider keys and agent accounts alike', async () => {
  const { run, deleted } = service({ providerRefs: ['key-1', 'key-2'], agentRefs: ['agent-1', 'key-2'] })
  await run()
  assert.deepEqual(deleted.sort(), ['agent-1', 'key-1', 'key-2'], 'each distinct reference once')
})

test('a credential that cannot be deleted stops the deletion, so the secret is never orphaned', async () => {
  const { run, deleted } = service({ providerRefs: ['key-1'], agentRefs: ['agent-1', 'agent-2'], failOn: ['agent-1'] })
  await assert.rejects(run(), /Could not delete 1 stored credential\. Nothing else was deleted/)
  // The others were still attempted, so a retry has less to do.
  assert.deepEqual(deleted.sort(), ['agent-2', 'key-1'])
})

test('a person with no stored credentials deletes cleanly', async () => {
  const { run, deleted } = service()
  await run()
  assert.deepEqual(deleted, [])
})
