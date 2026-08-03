import assert from 'node:assert/strict'
import test from 'node:test'
import { AccountDeletionService } from './AccountDeletionService'
import type { OverlayServerContext } from '@/server/bootstrap'
import { logger } from '@/server/observability/logger'

test('Postgres account deletion removes every BYOK credential before account metadata', async (t) => {
  t.mock.method(logger, 'error', () => undefined)
  const previousProvider = process.env.OVERLAY_PROVIDER_INTEGRATIONS
  process.env.OVERLAY_PROVIDER_INTEGRATIONS = 'none'
  t.after(() => {
    if (previousProvider === undefined) delete process.env.OVERLAY_PROVIDER_INTEGRATIONS
    else process.env.OVERLAY_PROVIDER_INTEGRATIONS = previousProvider
  })
  const calls: string[] = []
  const service = new AccountDeletionService({
    appDataCapabilities: { provider: 'postgres' },
    appData: {
      repositories: {
        providerConnections: {
          listCredentialRefs: async () => ['arn:secret/a', 'arn:secret/a', 'arn:secret/b'],
        },
        accountDeletion: {
          deleteUserAccount: async () => {
            calls.push('database')
            return {
              deletedRowCount: 1,
              r2Keys: [],
              storageIds: [],
              userExisted: true,
              verification: { orphanedRowCount: 0, remainingRowsByTable: {} },
            }
          },
        },
      },
    },
    byokCredentialStore: {
      delete: async (credentialRef: string) => { calls.push(`secret:${credentialRef}`) },
    },
    auth: {
      deleteUser: async () => { calls.push('auth') },
    },
    objectStore: { deleteObject: async () => {} },
  } as unknown as OverlayServerContext)

  await service.deleteAccount({ userId: 'user_1' })
  assert.deepEqual(calls, ['secret:arn:secret/a', 'secret:arn:secret/b', 'auth', 'database'])
})

test('Postgres account deletion fails closed when BYOK credential cleanup fails', async (t) => {
  t.mock.method(logger, 'error', () => undefined)
  const previousProvider = process.env.OVERLAY_PROVIDER_INTEGRATIONS
  process.env.OVERLAY_PROVIDER_INTEGRATIONS = 'none'
  t.after(() => {
    if (previousProvider === undefined) delete process.env.OVERLAY_PROVIDER_INTEGRATIONS
    else process.env.OVERLAY_PROVIDER_INTEGRATIONS = previousProvider
  })
  const calls: string[] = []
  const service = new AccountDeletionService({
    appDataCapabilities: { provider: 'postgres' },
    appData: {
      repositories: {
        providerConnections: { listCredentialRefs: async () => ['arn:secret/a'] },
        accountDeletion: {
          deleteUserAccount: async () => {
            calls.push('database')
            throw new Error('must not run')
          },
        },
      },
    },
    byokCredentialStore: {
      delete: async () => { throw new Error('AWS denied DeleteSecret') },
    },
    auth: {
      deleteUser: async () => { calls.push('auth') },
    },
    objectStore: { deleteObject: async () => {} },
  } as unknown as OverlayServerContext)

  await assert.rejects(service.deleteAccount({ userId: 'user_1' }), /AWS denied DeleteSecret/)
  assert.deepEqual(calls, [])
})
