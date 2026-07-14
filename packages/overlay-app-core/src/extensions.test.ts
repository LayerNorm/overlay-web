import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createMcpCreateRequest,
  createMcpSummaryFromForm,
  createMcpTestRequest,
  createSkillCreateRequest,
  createSkillSummaryFromForm,
  filterConnectorCatalog,
  filterExtensionCatalog,
  filterMcpServers,
  filterSkillSummaries,
  formatMcpTestResult,
  getAvailableConnectorRows,
  getConnectedConnectorRows,
  integrationRegistryToConnectorCatalog,
  mergeConnectorCatalogEntries,
  policyDisabledExtensionIds,
  resolveConnectorForSlug,
  setMcpServerEnabled,
  setSkillEnabled,
  upsertSkillSummary,
} from './extensions'

test('integration catalog helpers merge defaults, api rows, and registries', () => {
  const registry = integrationRegistryToConnectorCatalog([
    {
      id: 'custom-crm',
      label: 'Custom CRM',
      providerKey: 'custom_crm',
      description: 'CRM records',
      componentKey: 'enterprise.integrations.crm',
    },
  ])
  assert.deepEqual(registry[0], {
    id: 'custom-crm',
    providerKey: 'custom_crm',
    slug: 'custom_crm',
    name: 'Custom CRM',
    description: 'CRM records',
    icon: '🔌',
    logoUrl: null,
    componentKey: 'enterprise.integrations.crm',
    policyGateId: undefined,
  })

  const merged = mergeConnectorCatalogEntries(registry, [{
    id: 'custom_crm',
    providerKey: 'custom_crm',
    slug: 'custom_crm',
    name: 'Custom_crm',
    description: '',
    icon: '🔌',
    logoUrl: 'https://example.test/logo.png',
  }])
  assert.equal(merged[0]!.name, 'Custom crm')
  assert.equal(merged[0]!.description, 'CRM records')
  assert.equal(resolveConnectorForSlug('custom_crm', merged).logoUrl, 'https://example.test/logo.png')
})

test('integration rows split connected and available lists without changing search semantics', () => {
  const catalog = [
    { id: 'gmail', providerKey: 'gmail', slug: 'gmail', name: 'Gmail', description: 'Mail', icon: '📧' },
    { id: 'github', providerKey: 'github', slug: 'github', name: 'GitHub', description: 'Repos', icon: '🔌' },
  ]
  const connected = new Set(['gmail'])
  assert.deepEqual(getConnectedConnectorRows(connected, catalog).map((item) => item.name), ['Gmail'])
  assert.equal(getAvailableConnectorRows(connected, catalog).some((item) => item.slug === 'gmail'), false)
  assert.deepEqual(filterConnectorCatalog(catalog, 'repo').map((item) => item.slug), ['github'])
})

test('skill helpers create, upsert, filter, and toggle typed state', () => {
  const created = createSkillSummaryFromForm('skill_1', {
    name: '',
    description: 'Brief',
    instructions: 'Do it',
    enabled: true,
  }, 10)
  assert.equal(created.name, 'New Skill')
  assert.deepEqual(createSkillCreateRequest({
    name: '',
    description: 'Brief',
    instructions: 'Do it',
    enabled: true,
  }), {
    name: 'New Skill',
    description: 'Brief',
    instructions: 'Do it',
  })
  assert.equal(upsertSkillSummary([], created)[0]!._id, 'skill_1')
  assert.equal(setSkillEnabled(created, false, 20).updatedAt, 20)
  assert.deepEqual(filterSkillSummaries([created], 'brief').map((skill) => skill._id), ['skill_1'])
})

test('mcp helpers preserve request bodies, filtering, test messages, and local summaries', () => {
  const values = {
    name: ' Docs ',
    description: ' Docs tools ',
    transport: 'streamable-http' as const,
    url: ' https://mcp.example.test ',
    enabled: true,
    authType: 'bearer' as const,
    bearerToken: 'token',
    headerName: '',
    headerValue: '',
    timeoutMs: 12_000,
    defaultToolPolicy: 'approval_required' as const,
  }
  assert.deepEqual(createMcpCreateRequest(values), {
    name: 'Docs',
    description: 'Docs tools',
    transport: 'streamable-http',
    url: 'https://mcp.example.test',
    enabled: true,
    authType: 'bearer',
    defaultToolPolicy: 'approval_required',
    authConfig: { bearerToken: 'token' },
    timeoutMs: 12_000,
  })
  assert.deepEqual(createMcpTestRequest(values), {
    url: 'https://mcp.example.test',
    transport: 'streamable-http',
    authType: 'bearer',
    authConfig: { bearerToken: 'token' },
    timeoutMs: 12_000,
  })
  assert.deepEqual(createMcpTestRequest(values, { mcpServerId: 'mcp_1' }), {
    url: 'https://mcp.example.test',
    transport: 'streamable-http',
    authType: 'bearer',
    authConfig: { bearerToken: 'token' },
    timeoutMs: 12_000,
    mcpServerId: 'mcp_1',
  })
  const server = createMcpSummaryFromForm('mcp_1', values, 10)
  assert.equal(server.hasAuth, true)
  assert.equal(setMcpServerEnabled(server, false, 20).updatedAt, 20)
  assert.deepEqual(filterMcpServers([server], 'docs').map((item) => item._id), ['mcp_1'])
  assert.deepEqual(formatMcpTestResult({ ok: true, toolCount: 3 }, true), {
    ok: true,
    message: 'Connected — 3 tools available',
  })
})

test('extension registry catalog filtering and policy gates cover custom enterprise entries', () => {
  const items = [
    { kind: 'tool' as const, id: 'browser', label: 'Browser', policyGateId: 'browser-tools' },
    { kind: 'modelProvider' as const, id: 'openai', label: 'OpenAI', providerKey: 'openai' },
  ]
  assert.deepEqual(filterExtensionCatalog(items, { query: 'open' }).map((item) => item.kind), ['modelProvider'])
  assert.deepEqual([...policyDisabledExtensionIds(items, [{
    id: 'browser-tools',
    label: 'Browser tools',
    defaultEnabled: false,
    enforcement: 'disable',
  }])], ['browser'])
})
