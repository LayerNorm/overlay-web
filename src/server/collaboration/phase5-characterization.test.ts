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
  assert.equal(overlayAppConfig.brand?.homeHref, '/app/agents')
  assert.equal(overlayAppConfig.navigation?.[0]?.id, 'agents')
  assert.equal(overlayAppConfig.navigation?.some((item) => item.id === 'agents' && item.href === '/app/agents'), true)
})

test('Phase 5 protects the agent directory and lifecycle API', () => {
  const routes = new Map(AUTHORIZATION_ROUTE_POLICIES.map((rule) => [rule.path, rule]))
  assert.ok(routes.get('/api/v1/agents'))
  assert.ok(routes.get('/api/v1/agents/:agentId'))
})

test('Phase 5 persists identity, runtime configuration, public-room enrollment, and resource scope', async () => {
  // Convex is the only app-data provider (64b4257ae removed the Postgres
  // migrations this used to read).
  const schema = await readFile(`${root}/convex/schema.ts`, 'utf8')
  const definitions = schema.slice(schema.indexOf('workspaceAgentDefinitions: defineTable'))
  for (const invariant of [
    'principalId',
    'instructions',
    'harness',
    'allowedToolIds',
    "invocationPolicy: v.literal\\('mention'\\)",
  ]) assert.match(definitions, new RegExp(invariant))
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

test('Phase 5 ships agent creation and explicit mention-first copy', async () => {
  // The tile directory was retired for agent-first routing (cd3b0741f);
  // agents are created from the agent conversation workspace.
  const [form, workspace] = await Promise.all([
    readFile(`${root}/src/features/agents/components/AgentEditorForm.tsx`, 'utf8'),
    readFile(`${root}/src/features/agents/components/AgentConversationWorkspace.tsx`, 'utf8'),
  ])
  assert.match(workspace, /Create agent/)
  assert.match(form, /Create connection/)
  assert.match(form, /Bring your own agent/)
  assert.doesNotMatch(form, /Create Overlay Cloud environment/)
  assert.match(form, /computer, VPS, or sandbox/)
  assert.match(form, /Mention-first is enforced/)
})
