import assert from 'node:assert/strict'
import test from 'node:test'
import type { SlackAdapter } from '@chat-adapter/slack'
import { SurfaceService } from './SurfaceService'
import { listSlackChannels } from './slack-directory'

test('binding verifies public non-shared metadata and paginates the Slack channel directory', async () => {
  const publicChannel = { id: 'C1', name: 'general', is_channel: true, is_private: false, is_shared: false }
  const unsupported = [
    { ...publicChannel, id: 'D1', is_channel: false, is_im: true },
    { ...publicChannel, id: 'G1', is_private: true },
    { ...publicChannel, id: 'Cshared', is_shared: true },
    { ...publicChannel, id: 'Cext', is_ext_shared: true },
    { ...publicChannel, id: 'Corg', is_org_shared: true },
    { ...publicChannel, id: 'Cpending', pending_shared: ['T2'] },
  ]
  const adapter = {
    getInstallation: async () => ({ botToken: 'fixture-token' }),
    withBotToken: async (_token: string, callback: () => Promise<unknown>) => await callback(),
    webClient: { conversations: { list: async (args: { types: string; cursor?: string }) => {
      assert.equal(args.types, 'public_channel')
      return args.cursor ? { channels: [{ ...publicChannel, id: 'C2' }] }
        : { channels: [publicChannel, ...unsupported], response_metadata: { next_cursor: 'page2' } }
    } } },
  } as unknown as SlackAdapter
  let created = 0
  const service = new SurfaceService({
    repository: { getConnection: async () => ({ id: 'connection', workspaceId: 'workspace', status: 'active', externalTeamId: 'T1' }),
      listBindingsByChannel: async () => [], createBinding: async (row: unknown) => { created++; return row } } as never,
    agents: { list: async () => [{ id: 'chief', workspaceId: 'workspace', agentRole: 'workspace_chief', harness: 'overlay', principalId: 'chief' }] } as never,
    channelLister: (connection, value) => listSlackChannels(connection, value as SlackAdapter),
  })
  const actor = { userId: 'user', principalId: 'human', workspaceRole: 'admin' as const }
  for (const channel of unsupported) {
    await assert.rejects(service.createBinding({ actor, workspaceId: 'workspace', connectionId: 'connection', channelId: channel.id, adapter }), /Only public, non-shared/)
  }
  assert.equal(created, 0)
  assert.equal((await service.createBinding({ actor, workspaceId: 'workspace', connectionId: 'connection', channelId: 'C2', adapter })).agentId, 'chief')
  assert.equal(created, 1)
})
