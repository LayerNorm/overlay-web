import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { AUTHORIZATION_ROUTE_POLICIES } from '@/server/authorization/authorization-route-policy'
import { POSTGRES_APP_DATA_ROUTE_SUPPORT_RULES } from '@/server/app-data/route-support'
import { APP_DATA_SCHEMA_VERSION } from '@/server/database/postgres/schema-compatibility'
import { WORKSPACE_SHARE_RESOURCE_TYPES } from '@overlay/workspace-contracts'
import overlayAppConfig from '@/overlay.config'

const root = process.cwd()

test('Phase 6 exposes one sharing surface for every shareable resource type', () => {
  assert.deepEqual([...WORKSPACE_SHARE_RESOURCE_TYPES], [
    'conversation',
    'file',
    'project',
    'knowledge_base',
    'automation',
    'agent',
  ])
})

test('Phase 6 enables the resource-sharing rollout flag', () => {
  const flags = new Map(overlayAppConfig.featureFlags?.map((feature) => [feature.id, feature.enabled]))
  assert.equal(flags.get('resourceSharing'), true)
  // Shared multi-tenant deployment stays gated until Phase 8.
  assert.notEqual(flags.get('sharedMultiTenant'), true)
})

test('Phase 6 protects sharing, disclosure, and policy routes', () => {
  const routes = new Map(AUTHORIZATION_ROUTE_POLICIES.map((rule) => [rule.path, rule]))
  assert.ok(routes.get('/api/v1/shares'))
  assert.ok(routes.get('/api/v1/shares/impact'))
  assert.ok(routes.get('/api/v1/workspaces/:workspaceId/policies'))
  const impact = routes.get('/api/v1/shares/impact')!
  assert.deepEqual(Object.keys(impact.methods), ['GET'])
})

test('Phase 6 routes resource reads and automation runs through resource authorization', () => {
  const routes = new Map(AUTHORIZATION_ROUTE_POLICIES.map((rule) => [rule.path, rule]))
  const automations = routes.get('/api/v1/automations')!
  assert.equal(automations.methods.GET?.resource?.type, 'automation')
  assert.equal(automations.methods.PATCH?.resource?.action, 'edit')
  assert.equal(automations.methods.DELETE?.resource?.action, 'delete')
  const automationTest = routes.get('/api/v1/automations/test')!
  assert.equal(automationTest.methods.POST?.resource?.action, 'execute')
  const knowledge = routes.get('/api/v1/knowledge-bases')!
  assert.equal(knowledge.methods.GET?.resource?.type, 'knowledge_base')
  assert.equal(knowledge.methods.GET?.resource?.optional, true)
})

test('Phase 6 sharing works on the Postgres provider without Convex', () => {
  const rule = POSTGRES_APP_DATA_ROUTE_SUPPORT_RULES
    .find((candidate) => candidate.id === 'workspace-sharing')
  assert.ok(rule)
  assert.equal(rule.status, 'supported')
  assert.deepEqual([...rule.prefixes ?? []], ['/api/v1/shares'])
})

test('Phase 6 persists grants scoped to a workspace and a bound resource', async () => {
  const migration = await readFile(`${root}/migrations/app-data/0036_workspace_resource_sharing.sql`, 'utf8')
  for (const invariant of [
    'workspace_resource_grants',
    'workspace_resource_grants_scope_fk',
    'workspace_resource_grants_target_unique',
    "'viewer', 'operator', 'editor'",
    "'principal', 'team', 'room'",
  ]) assert.match(migration, new RegExp(invariant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})

test('Phase 6 stores public-link policy per workspace and bumps the schema version', async () => {
  const migration = await readFile(`${root}/migrations/app-data/0037_workspace_sharing_policy.sql`, 'utf8')
  assert.match(migration, /workspace_sharing_policies/)
  assert.match(migration, /public_links_enabled/)
  assert.match(migration, /'schema_version', '37'/)
  assert.equal(APP_DATA_SCHEMA_VERSION, 37)
  const journal = JSON.parse(
    await readFile(`${root}/migrations/app-data/meta/_journal.json`, 'utf8'),
  ) as { entries: Array<{ tag: string }> }
  assert.equal(journal.entries.at(-1)?.tag, '0037_workspace_sharing_policy')
})

test('Phase 6 replaces resource-specific sharing menus with the universal dialog', async () => {
  const surfaces = await Promise.all([
    'src/features/files/components/FileShareMenu.tsx',
    'src/features/files/components/ExportMenu.tsx',
    'src/features/projects/components/ProjectsView.tsx',
    'src/features/knowledge-bases/components/KnowledgeBaseWorkspace.tsx',
    'src/features/agents/components/AgentsDirectory.tsx',
    'src/features/chat/components/DirectMessageExperience.tsx',
  ].map((path) => readFile(`${root}/${path}`, 'utf8')))
  for (const source of surfaces) assert.match(source, /ShareDialog/)
})

test('Phase 6 discloses inherited access and warns before revoking', async () => {
  const dialog = await readFile(`${root}/src/components/share/ShareDialog.tsx`, 'utf8')
  assert.match(dialog, /describeTargetInheritance/)
  assert.match(dialog, /share-dialog-confirmation/)
  assert.match(dialog, /Losing access/)
  assert.match(dialog, /including open downloads, streams, and agent tool calls/)
  // Native confirm() cannot disclose who is affected, so it must not come back.
  assert.doesNotMatch(dialog, /window\.confirm/)
})

test('Phase 6 prompts for a room grant when a restricted resource is attached', async () => {
  const attach = await readFile(`${root}/src/components/share/AttachResourceDialog.tsx`, 'utf8')
  assert.match(attach, /cannot open it yet/)
  assert.match(attach, /Share with this room and post/)
  assert.match(attach, /Post link only/)
  assert.match(attach, /request access/)
})

test('Phase 6 keeps public links as workspace-governed General access', async () => {
  const [dialog, policy, filesRoute, conversationsRoute] = await Promise.all([
    readFile(`${root}/src/components/share/ShareDialog.tsx`, 'utf8'),
    readFile(`${root}/src/server/sharing/public-link-policy.ts`, 'utf8'),
    readFile(`${root}/src/server/app-api/v1/files/share/route.ts`, 'utf8'),
    readFile(`${root}/src/server/app-api/v1/conversations/share/route.ts`, 'utf8'),
  ])
  assert.match(dialog, /General access/)
  assert.match(dialog, /Public links are off for this workspace/)
  assert.match(policy, /assertPublicLinksAllowed/)
  for (const route of [filesRoute, conversationsRoute]) {
    assert.match(route, /assertPublicLinkPolicy\(context\)/)
    assert.match(route, /publicLinkPolicyResponse/)
  }
})
