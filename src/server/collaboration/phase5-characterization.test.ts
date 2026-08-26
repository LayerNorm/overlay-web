import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import overlayAppConfig from '@/overlay.config'
import { AUTHORIZATION_ROUTE_POLICIES } from '@/server/authorization/authorization-route-policy'
import { resolveMentionFirstInvocations } from '@/server/agents/mention-policy'

const root = process.cwd()

test('Phase 5 enables the named Agents product surface', () => {
  const flags = new Map(overlayAppConfig.featureFlags?.map((feature) => [feature.id, feature.enabled]))
  assert.equal(flags.get('workspaces'), true)
  assert.equal(flags.get('channels'), true)
  assert.equal(flags.get('agents'), true)
  assert.equal(overlayAppConfig.navigation?.some((item) => item.id === 'agents' && item.href === '/app/agents'), true)
})

test('Phase 5 protects the agent directory and lifecycle API', () => {
  const routes = new Map(AUTHORIZATION_ROUTE_POLICIES.map((rule) => [rule.path, rule]))
  assert.ok(routes.get('/api/v1/agents'))
  assert.ok(routes.get('/api/v1/agents/:agentId'))
})

test('Phase 5 persists identity, runtime configuration, public-room enrollment, and resource scope', async () => {
  const migration = await readFile(`${root}/migrations/app-data/0035_workspace_agents.sql`, 'utf8')
  for (const invariant of [
    'workspace_agent_definitions',
    'principal_id',
    'instructions',
    'harness',
    'allowed_tool_ids',
    'invocation_policy',
    "'mention'",
  ]) assert.match(migration, new RegExp(invariant))
})

test('Phase 5 invocation is implicit only in a one-human one-agent DM', () => {
  const participants = [
    { principalId: 'human', principalType: 'human' as const },
    { principalId: 'agent', principalType: 'agent' as const },
  ]
  assert.deepEqual(resolveMentionFirstInvocations({
    authorKind: 'human', conversationType: 'dm', participants,
  }), ['agent'])
  assert.deepEqual(resolveMentionFirstInvocations({
    authorKind: 'agent', conversationType: 'dm', participants,
  }), [])
})

test('Phase 5 group and channel invocation is human mention or agent-thread reply only', () => {
  const participants = [
    { principalId: 'human', principalType: 'human' as const },
    { principalId: 'human2', principalType: 'human' as const },
    { principalId: 'agent', principalType: 'agent' as const },
    { principalId: 'agent2', principalType: 'agent' as const },
  ]
  assert.deepEqual(resolveMentionFirstInvocations({
    authorKind: 'human', conversationType: 'channel', participants,
  }), [])
  assert.deepEqual(resolveMentionFirstInvocations({
    authorKind: 'human', conversationType: 'channel', participants,
    mentionedPrincipalIds: ['agent2'],
  }), ['agent2'])
  assert.deepEqual(resolveMentionFirstInvocations({
    authorKind: 'human', conversationType: 'dm', participants,
    repliedToAgentPrincipalId: 'agent',
  }), ['agent'])
})

test('Phase 5 ships the Buzz-inspired directory and explicit mention-first copy', async () => {
  const [directory, editor] = await Promise.all([
    readFile(`${root}/src/features/agents/components/AgentsDirectory.tsx`, 'utf8'),
    readFile(`${root}/src/features/agents/components/AgentEditorDialog.tsx`, 'utf8'),
  ])
  assert.doesNotMatch(directory, /Agent teams/)
  assert.match(directory, /New agent/)
  assert.match(editor, /Create agent/)
  assert.match(editor, /Bring your own agent/)
  assert.match(editor, /Create connection command/)
  assert.match(editor, /Create Overlay Cloud environment/)
  assert.match(editor, /Mention-first is enforced/)
})
