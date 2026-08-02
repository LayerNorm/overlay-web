import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { AUTHORIZATION_ROUTE_POLICIES } from '@/server/authorization/authorization-route-policy'
import { APP_DATA_SCHEMA_VERSION } from '@/server/database/postgres/schema-compatibility'
import { DEFAULT_WORKSPACE_POLICY, WORKSPACE_ROLLOUT_STAGES } from '@overlay/workspace-contracts'
import {
  describeRolloutStage,
  isWorkspaceInRollout,
  parseDeploymentRolloutStage,
} from '@/shared/workspaces/collaboration-rollout'
import {
  isForbiddenByLimit,
  resolveCollaborationLimits,
} from '@/shared/workspaces/collaboration-limits'
import { WORKSPACE_AUDIT_EXPORT_ACTIONS } from '@/server/governance'

const root = process.cwd()

test('Phase 8 defaults keep existing workspaces behaving as they did', () => {
  assert.equal(DEFAULT_WORKSPACE_POLICY.publicLinksEnabled, true)
  assert.equal(DEFAULT_WORKSPACE_POLICY.memberCanCreateChannels, true)
  assert.equal(DEFAULT_WORKSPACE_POLICY.memberCanCreateAgents, true)
  // Inviting is the one member right that starts closed: it reaches outsiders.
  assert.equal(DEFAULT_WORKSPACE_POLICY.memberCanInvite, false)
  assert.equal(DEFAULT_WORKSPACE_POLICY.legalHold, false)
  assert.equal(DEFAULT_WORKSPACE_POLICY.rolloutStage, 'general')
})

test('Phase 8 rollout widens from dogfood to invited to general', () => {
  assert.deepEqual([...WORKSPACE_ROLLOUT_STAGES], ['dogfood', 'invited', 'general'])
  assert.equal(isWorkspaceInRollout({ deploymentStage: 'dogfood', workspaceStage: 'dogfood' }), true)
  assert.equal(isWorkspaceInRollout({ deploymentStage: 'dogfood', workspaceStage: 'invited' }), false)
  assert.equal(isWorkspaceInRollout({ deploymentStage: 'invited', workspaceStage: 'dogfood' }), true)
  assert.equal(isWorkspaceInRollout({ deploymentStage: 'invited', workspaceStage: 'general' }), false)
  assert.equal(isWorkspaceInRollout({ deploymentStage: 'general', workspaceStage: 'general' }), true)
  // An unknown or missing deployment setting must not silently hide the product.
  assert.equal(parseDeploymentRolloutStage(undefined), 'general')
  assert.equal(parseDeploymentRolloutStage('nonsense'), 'general')
  assert.equal(parseDeploymentRolloutStage('dogfood'), 'dogfood')
  assert.match(describeRolloutStage('dogfood'), /Internal/)
})

test('Phase 8 limits cover workspace, principal, room, agent, and guest scopes', () => {
  const message = resolveCollaborationLimits('message.send', {
    workspaceId: 'w1',
    principalId: 'p1',
    conversationId: 'c1',
  })
  assert.deepEqual(message.map((entry) => entry.key.split(':')[2]), ['workspace', 'principal', 'narrow'])
  const agent = resolveCollaborationLimits('agent.invoke', {
    workspaceId: 'w1',
    principalId: 'p1',
    agentId: 'a1',
  })
  assert.equal(agent.some((entry) => entry.key.endsWith('a1')), true)
  const guest = resolveCollaborationLimits('invitation.create', {
    workspaceId: 'w1',
    principalId: 'p_guest',
    guest: true,
  })
  const guestBucket = guest.find((entry) => entry.key.includes(':guest:'))!
  assert.equal(isForbiddenByLimit(guestBucket.limits), true)
})

test('Phase 8 governance routes are registered and authenticated', () => {
  const routes = new Map(AUTHORIZATION_ROUTE_POLICIES.map((rule) => [rule.path, rule]))
  assert.ok(routes.get('/api/v1/workspaces/:workspaceId/governance'))
  assert.ok(routes.get('/api/v1/workspaces/:workspaceId/audit-export'))
  assert.deepEqual(
    Object.keys(routes.get('/api/v1/workspaces/:workspaceId/audit-export')!.methods),
    ['GET'],
  )
})

test('Phase 8 persists policy, directory identity, and export history', async () => {
  const migration = await readFile(
    `${root}/migrations/app-data/0038_workspace_governance_policy.sql`,
    'utf8',
  )
  for (const invariant of [
    'member_can_create_channels',
    'member_can_create_agents',
    'member_can_invite',
    'guest_expiration_days',
    'allowed_agent_harnesses',
    'agent_run_budget_cents',
    'channel_retention_days',
    'legal_hold',
    'data_residency',
    'rollout_stage',
    'workspace_identity_mappings',
    'workspace_audit_exports',
    "'schema_version', '38'",
  ]) assert.match(migration, new RegExp(invariant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  const correctnessMigration = await readFile(
    `${root}/migrations/app-data/0039_conversation_correctness.sql`,
    'utf8',
  )
  for (const invariant of [
    'last_read_sequence',
    'session_id',
    'workspace_presence_principal_idx',
  ]) assert.match(correctnessMigration, new RegExp(invariant))
  assert.equal(APP_DATA_SCHEMA_VERSION, 41)
})

test('Phase 8 audit export covers membership, grants, messages, runs, and approvals', () => {
  for (const action of [
    'workspace.membership',
    'workspace.grant',
    'workspace.message',
    'workspace.agent_run',
    'workspace.approval',
    'workspace.external_action',
  ]) {
    assert.equal((WORKSPACE_AUDIT_EXPORT_ACTIONS as readonly string[]).includes(action), true, action)
  }
})

test('Phase 8 identity mapping is not the authorization source of truth', async () => {
  const service = await readFile(
    `${root}/src/server/governance/WorkspaceGovernanceService.ts`,
    'utf8',
  )
  assert.match(service, /identity, never authorization/)
  // Roles must never be derived from directory groups.
  assert.doesNotMatch(service, /setMembershipRole/)
  assert.match(service, /externalGroupIds/)
})

test('Phase 8 policy enforcement sits on the creation paths, not only in the UI', async () => {
  const [channels, agents, workspaces, message, shares, search] = await Promise.all([
    readFile(`${root}/src/server/app-api/v1/conversations/channels/route.ts`, 'utf8'),
    readFile(`${root}/src/server/agents/WorkspaceAgentService.ts`, 'utf8'),
    readFile(`${root}/src/server/workspaces/WorkspaceService.ts`, 'utf8'),
    readFile(`${root}/src/server/app-api/v1/conversations/message/route.ts`, 'utf8'),
    readFile(`${root}/src/server/app-api/v1/shares/route.ts`, 'utf8'),
    readFile(`${root}/src/server/app-api/v1/search/route.ts`, 'utf8'),
  ])
  assert.match(channels, /assertMemberMayCreate/)
  assert.match(agents, /assertMemberMayCreate/)
  assert.match(agents, /assertAgentHarnessAllowed/)
  assert.match(workspaces, /assertMemberMayCreate\(\{ \.\.\.args, capability: 'invitation' \}\)/)
  assert.match(workspaces, /resolveGuestExpiry/)
  for (const route of [message, shares, search]) assert.match(route, /assertWithinLimits/)
})

test('Phase 8 retention is rehearsed and reversible before it deletes anything', async () => {
  const [sweep, rehearsal] = await Promise.all([
    readFile(`${root}/scripts/workspace-retention-sweep.ts`, 'utf8'),
    readFile(`${root}/scripts/workspaces-rollback-rehearsal.ts`, 'utf8'),
  ])
  // Dry run is the default and legal hold is honored before any delete.
  assert.match(sweep, /dry-run/)
  assert.match(sweep, /legal_hold/)
  assert.match(sweep, /--apply/)
  assert.match(rehearsal, /RollbackRehearsalComplete/)
  assert.match(rehearsal, /seedScratchWorkspace/)
  assert.match(rehearsal, /not restored after rehearsal/)
})

test('Phase 8 documents workspace tenancy decisions for every collaboration table', async () => {
  const tenancy = await readFile(`${root}/docs/deploy-operate/tenancy.mdx`, 'utf8')
  for (const table of ['workspacePrincipals', 'workspaceUserPreferences', 'usageOperations']) {
    assert.match(tenancy, new RegExp(table))
  }
  assert.match(tenancy, /Workspaces Are The In-Deployment Boundary/)
  assert.match(tenancy, /shared multi-tenant deployment/)
})
