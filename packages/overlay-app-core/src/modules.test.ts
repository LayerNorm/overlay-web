import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildProjectTree,
  buildTree,
  buildSettingsRegistrySummary,
  collectProjectDescendantIds,
  filterExtensionCatalog,
  normalizeTopUpDraft,
  noteEditorState,
  resolveSettingsPanel,
  resolveSettingsSection,
  settingsPanelsForSection,
} from './modules'

test('buildTree creates sorted nested nodes', () => {
  const tree = buildTree([
    { _id: 'b', name: 'B', parentId: null },
    { _id: 'a2', name: 'A child', parentId: 'a' },
    { _id: 'a', name: 'A', parentId: null },
  ])

  assert.deepEqual(tree.map((node) => node.item._id), ['a', 'b'])
  assert.deepEqual(tree[0]!.children.map((node) => node.item._id), ['a2'])
})

test('noteEditorState normalizes title and detects dirty drafts', () => {
  assert.deepEqual(
    noteEditorState({
      note: { title: 'Old', content: 'Body' },
      draftTitle: '  New  ',
      draftContent: 'Body',
    }),
    { title: 'New', isDirty: true, canSave: true },
  )
})

test('project helpers collect descendants', () => {
  const projects = [
    { _id: 'root', name: 'Root', parentId: null, createdAt: 1, updatedAt: 1 },
    { _id: 'child', name: 'Child', parentId: 'root', createdAt: 1, updatedAt: 1 },
    { _id: 'grand', name: 'Grand', parentId: 'child', createdAt: 1, updatedAt: 1 },
  ]
  assert.equal(buildProjectTree(projects).length, 1)
  assert.deepEqual(collectProjectDescendantIds(projects, 'root'), ['child', 'grand'])
})

test('extension catalog filter handles kind and query', () => {
  const items = [
    {
      kind: 'integration' as const,
      slug: 'gmail',
      providerKey: 'gmail',
      provider: 'composio' as const,
      capabilities: {
        provider: 'composio' as const,
        hosted: true,
        selfHosted: false,
        oauthOwnership: 'provider-managed' as const,
        connectionSetup: 'in-app-oauth' as const,
        connectionLifecycle: 'overlay-managed' as const,
        supportsApprovals: false,
        supportsDisconnect: true,
        supportedSchemas: ['native' as const],
      },
      name: 'Gmail',
      description: 'Mail',
      logoUrl: null,
      isConnected: true,
    },
    { kind: 'skill' as const, _id: 's1', name: 'Reporter', description: 'Daily reports', instructions: '', enabled: true },
  ]
  assert.deepEqual(filterExtensionCatalog(items, { query: 'report' }).map((item) => item.kind), ['skill'])
  assert.deepEqual(
    filterExtensionCatalog(items, { kind: 'integration', enabledOnly: true })
      .map((item) => (item.kind === 'integration' ? item.name : '')),
    ['Gmail'],
  )
})

test('resolveSettingsSection falls back to first registered section', () => {
  assert.equal(resolveSettingsSection('missing', [{ id: 'general' }, { id: 'models' }]), 'general')
  assert.equal(resolveSettingsSection('models', [{ id: 'general' }, { id: 'models' }]), 'models')
})

test('settings panel helpers resolve section-scoped panels by order', () => {
  const panels = [
    { id: 'security', sectionId: 'account', label: 'Security', componentKey: 'security', order: 20 },
    { id: 'billing', sectionId: 'account', label: 'Billing', componentKey: 'billing', order: 10 },
    { id: 'general', sectionId: 'general', label: 'General', componentKey: 'general' },
  ]

  assert.deepEqual(settingsPanelsForSection(panels, 'account').map((panel) => panel.id), ['billing', 'security'])
  assert.equal(resolveSettingsPanel(panels, 'account', 'security')?.id, 'security')
  assert.equal(resolveSettingsPanel(panels, 'account', 'missing')?.id, 'billing')
  assert.equal(resolveSettingsPanel(panels, 'missing'), null)
})

test('normalizeTopUpDraft keeps billing controls stable across response variants', () => {
  assert.deepEqual(normalizeTopUpDraft(null), { topUpAmountCents: 800, autoTopUpEnabled: false })
  assert.deepEqual(
    normalizeTopUpDraft({
      topUpAmountCents: 1200,
      autoTopUpAmountCents: 900,
      topUpMinAmountCents: 800,
      autoTopUpEnabled: true,
    }),
    { topUpAmountCents: 1200, autoTopUpEnabled: true },
  )
})

test('settings registry summary sorts extension metadata predictably', () => {
  const summary = buildSettingsRegistrySummary({
    featureModules: [
      { id: 'b', label: 'B', routePatterns: ['/b'], componentKey: 'b', order: 20 },
      { id: 'a', label: 'A', routePatterns: ['/a'], componentKey: 'a', order: 10 },
    ],
    settingsPanels: [
      { id: 'models', sectionId: 'models', label: 'Models', componentKey: 'models', order: 30 },
      { id: 'general', sectionId: 'general', label: 'General', componentKey: 'general', order: 10 },
    ],
    tools: [{ id: 'z', label: 'Zed' }, { id: 'alpha', label: 'Alpha' }],
    integrations: [{ id: 'slack', label: 'Slack', providerKey: 'slack' }],
    modelProviders: [{ id: 'openai', label: 'OpenAI', providerKey: 'openai' }],
    policyGates: [{ id: 'browser', label: 'Browser', defaultEnabled: true, enforcement: 'disable' }],
  })

  assert.deepEqual(summary.featureModules.map((item) => item.id), ['a', 'b'])
  assert.deepEqual(summary.settingsPanels.map((item) => item.id), ['general', 'models'])
  assert.deepEqual(summary.tools.map((item) => item.id), ['alpha', 'z'])
})
