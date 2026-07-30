import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import overlayAppConfig from '@/overlay.config'
import { AUTHORIZATION_ROUTE_POLICIES } from '@/server/authorization/authorization-route-policy'
import { POSTGRES_APP_DATA_ROUTE_SUPPORT_RULES } from '@/server/app-data/route-support'
import {
  parseWorkspaceSearchKinds,
  WORKSPACE_SEARCH_KINDS,
  workspaceSearchHref,
} from '@/shared/search/workspace-search'

const root = process.cwd()

test('Phase 7 searches every collaboration resource kind', () => {
  assert.deepEqual([...WORKSPACE_SEARCH_KINDS], [
    'conversation',
    'file',
    'project',
    'knowledge_base',
    'automation',
    'agent',
  ])
  // An unknown kind never narrows the search into an unauthorized shortcut.
  assert.deepEqual(parseWorkspaceSearchKinds('file,nonsense'), ['file'])
  assert.deepEqual(parseWorkspaceSearchKinds(''), [...WORKSPACE_SEARCH_KINDS])
})

test('Phase 7 search and shared-with-me are authenticated and workspace scoped', () => {
  const routes = new Map(AUTHORIZATION_ROUTE_POLICIES.map((rule) => [rule.path, rule]))
  assert.ok(routes.get('/api/v1/search'))
  assert.deepEqual(Object.keys(routes.get('/api/v1/search')!.methods), ['GET'])
  assert.ok(routes.get('/api/v1/shares/shared-with-me'))
  assert.ok(routes.get('/api/v1/conversations/:conversationId/reports'))
})

test('Phase 7 search works on the Postgres provider', () => {
  const rule = POSTGRES_APP_DATA_ROUTE_SUPPORT_RULES.find((candidate) => candidate.id === 'workspace-search')
  assert.ok(rule)
  assert.equal(rule.status, 'supported')
})

test('Phase 7 exposes Shared with me only when resource sharing is enabled', () => {
  const nav = overlayAppConfig.navigation?.find((item) => item.id === 'shared')
  assert.ok(nav)
  assert.equal(nav.href, '/app/shared')
  assert.equal(nav.featureFlagId, 'resourceSharing')
  const flags = new Map(overlayAppConfig.featureFlags?.map((flag) => [flag.id, flag.enabled]))
  assert.equal(flags.get('resourceSharing'), true)
})

test('Phase 7 keeps workspace deep links inside the active workspace', () => {
  assert.equal(
    workspaceSearchHref({ kind: 'file', id: 'file_1', title: 'x' }, 'workspace_1'),
    '/app/w/workspace_1/files?file=file_1',
  )
  assert.equal(
    workspaceSearchHref({ kind: 'agent', id: 'agent_1', title: 'x' }, null),
    '/app/agents?agentId=agent_1',
  )
})

test('Phase 7 palette results come from the permission-filtered endpoint', async () => {
  const palette = await readFile(`${root}/src/components/layout/GlobalSearchDialog.tsx`, 'utf8')
  assert.match(palette, /overlayAppClient\.search\.workspace/)
  assert.match(palette, /permission\s*\n?\s*\/\/ filtered|permission/)
  // The palette must not re-implement chat search against an unscoped client.
  assert.doesNotMatch(palette, /searchWorkspaceChats/)
})

test('Phase 7 composer mentions are explicit principal ids, not name substrings', async () => {
  const dm = await readFile(`${root}/src/features/chat/components/DirectMessageExperience.tsx`, 'utf8')
  assert.match(dm, /resolveMentionedPrincipalIds/)
  assert.doesNotMatch(dm, /text\.toLowerCase\(\)\.includes\(`@\$\{/)
})

test('Phase 7 composer is keyboard navigable and announces activity politely', async () => {
  const [dm, suggestions] = await Promise.all([
    readFile(`${root}/src/features/chat/components/DirectMessageExperience.tsx`, 'utf8'),
    readFile(`${root}/src/components/mentions/MentionSuggestionList.tsx`, 'utf8'),
  ])
  assert.match(dm, /role="combobox"/)
  assert.match(dm, /aria-activedescendant/)
  assert.match(dm, /ArrowDown/)
  assert.match(dm, /aria-live="polite"/)
  assert.match(suggestions, /role="listbox"/)
  assert.match(suggestions, /role="option"/)
})

test('Phase 7 drafts survive reopening and cannot crash private browsing', async () => {
  const [dm, drafts] = await Promise.all([
    readFile(`${root}/src/features/chat/components/DirectMessageExperience.tsx`, 'utf8'),
    readFile(`${root}/src/shared/chat/conversation-drafts.ts`, 'utf8'),
  ])
  assert.match(dm, /readDraft/)
  assert.match(dm, /writeDraft/)
  assert.match(dm, /clearDraft/)
  assert.match(drafts, /catch/)
  assert.doesNotMatch(drafts, /throw new/)
})

test('Phase 7 moderation intake records an audit event without visible state', async () => {
  const route = await readFile(
    `${root}/src/server/app-api/v1/conversations/[conversationId]/reports/route.ts`,
    'utf8',
  )
  assert.match(route, /auditService\.record/)
  assert.match(route, /conversation\.message\.reported/)
  assert.match(route, /canAccessConversation/)
  // No moderation queue, hiding, or deletion ships in this phase.
  assert.doesNotMatch(route, /deleteMessage|hideMessage|moderationQueue/)
})

test('Phase 7 keeps one contract for web, desktop, and mobile surfaces', async () => {
  const [searchContract, client] = await Promise.all([
    readFile(`${root}/src/shared/search/workspace-search.ts`, 'utf8'),
    readFile(`${root}/packages/overlay-api-client/src/search/client.ts`, 'utf8'),
  ])
  // The contract is isomorphic: no server-only or DOM dependency.
  assert.doesNotMatch(searchContract, /server-only|window\.|document\./)
  assert.match(client, /\/api\/v1\/search/)
  assert.match(client, /x-overlay-workspace-id/)
})
