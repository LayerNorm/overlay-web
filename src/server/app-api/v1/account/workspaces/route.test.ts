import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAccountWorkspaceDirectory } from './route'

test('empty account directory does not resolve or create a workspace', async () => {
  let resolveCalls = 0
  let invitationEmail = ''
  const result = await buildAccountWorkspaceDirectory({
    userId: 'user_1',
    email: 'trusted@example.test',
    now: 123,
    service: {
      async listForUser() { return [] },
      async resolveActiveWorkspace() {
        resolveCalls += 1
        throw new Error('must not resolve an empty directory')
      },
      async listReceivedInvitations(args) {
        invitationEmail = args.email
        return []
      },
      async countMemberKinds() { return { memberCount: 0, humanMemberCount: 0 } },
    },
  })
  assert.deepEqual(result, { workspaces: [], activeWorkspaceId: '', invitations: [] })
  assert.equal(resolveCalls, 0)
  assert.equal(invitationEmail, 'trusted@example.test')
})
