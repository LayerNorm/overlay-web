import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPlatformIdentities } from './slack-identity-display'

function mapping(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mapping-1',
    workspaceId: 'workspace-1',
    principalId: 'principal-1',
    directory: 'slack',
    externalId: 'U123',
    externalGroupIds: [],
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as never
}

test('identity list enriches principal and Slack display names', async () => {
  const identities = await buildPlatformIdentities(
    [mapping(), mapping({ id: 'mapping-2', principalId: 'principal-2', externalId: 'U456' })],
    {
      resolvePrincipalName: async (principalId: string) => (principalId === 'principal-1' ? 'Maya' : null),
      fetchSlackProfiles: async (externalIds: string[]) => new Map(
        externalIds.map((externalId) => [externalId, externalId === 'U123'
          ? { displayName: 'maya-slack', avatarUrl: 'https://example.com/maya.png' }
          : {}]),
      ),
    },
  )
  assert.deepEqual(identities, [
    {
      directory: 'slack',
      externalId: 'U123',
      principalId: 'principal-1',
      principalDisplayName: 'Maya',
      status: 'active',
      platformDisplayName: 'maya-slack',
      platformAvatarUrl: 'https://example.com/maya.png',
    },
    {
      directory: 'slack',
      externalId: 'U456',
      principalId: 'principal-2',
      status: 'active',
    },
  ])
})

test('identity list survives enrichment failures with raw ids', async () => {
  const identities = await buildPlatformIdentities(
    [mapping({ directory: 'msteams', externalId: 'teams-user-1' })],
    {
      resolvePrincipalName: async () => { throw new Error('directory unavailable') },
      fetchSlackProfiles: async () => { throw new Error('slack unreachable') },
    },
  )
  assert.deepEqual(identities, [{
    directory: 'msteams',
    externalId: 'teams-user-1',
    principalId: 'principal-1',
    status: 'active',
  }])
})
