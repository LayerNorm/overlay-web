import assert from 'node:assert/strict'
import test from 'node:test'
import type { SlackAdapter } from '@chat-adapter/slack'
import { slackIdentityDisplayName } from './slack-identity-profile'

const identity = { externalTeamId: 'T1', externalUserId: 'U_DANA', displayName: 'Dana Smith' }

test('link-time profile uses the installation bot token and prefers the verified Slack handle', async () => {
  const adapter = {
    getInstallation: async (team: string) => { assert.equal(team, 'T1'); return { botToken: 'fixture' } },
    withBotToken: async (token: string, callback: () => Promise<unknown>, options: unknown) => {
      assert.equal(token, 'fixture'); assert.deepEqual(options, { installationId: 'T1' }); return await callback()
    },
    webClient: { users: { info: async (args: unknown) => {
      assert.deepEqual(args, { user: 'U_DANA' })
      return { ok: true, user: { id: 'U_DANA', team_id: 'T1', name: ' dana ', profile: { display_name: 'Dana Smith' } } }
    } } },
  } as unknown as SlackAdapter
  assert.equal(await slackIdentityDisplayName(identity, async () => adapter), 'dana')
})

test('unavailable, empty or mismatched profiles use the verified OIDC name or leave the ID fallback', async () => {
  const unavailable = async (): Promise<SlackAdapter> => { throw Error('Slack unavailable') }
  assert.equal(await slackIdentityDisplayName(identity, unavailable), 'Dana Smith')
  assert.equal(await slackIdentityDisplayName({ ...identity, displayName: ' ' }, unavailable), undefined)
  for (const user of [{ id: 'OTHER', name: 'wrong' }, { id: 'U_DANA', team_id: 'OTHER', name: 'wrong' }, { id: 'U_DANA', name: ' ' }]) {
    const adapter = { getInstallation: async () => ({ botToken: 'fixture' }),
      withBotToken: async (_token: string, callback: () => Promise<unknown>) => await callback(),
      webClient: { users: { info: async () => ({ ok: true, user }) } },
    } as unknown as SlackAdapter
    assert.equal(await slackIdentityDisplayName(identity, async () => adapter), 'Dana Smith')
  }
})
