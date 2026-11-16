import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CONNECTOR_CATEGORIES,
  MCP_CATALOG,
  MCP_CATEGORIES,
  SKILL_CATEGORIES,
  SKILL_TEMPLATES,
  groupExtensionCatalog,
  matchesExtensionQuery,
  normalizeMcpServerUrl,
} from './extension-catalog'

test('catalog sections follow the curated order, skip missing keys and collect the rest under All', () => {
  const items = ['zendesk', 'slack', 'gmail', 'hubspot', 'unknown'].map((slug) => ({ slug }))
  const sections = groupExtensionCatalog(items, CONNECTOR_CATEGORIES, (item) => item.slug)
  assert.deepEqual(sections.map((section) => [section.id, section.items.map((item) => item.slug)]), [
    ['popular', ['gmail', 'slack']],
    ['sales', ['hubspot']],
    ['all', ['zendesk', 'unknown']],
  ])
})

test('every curated MCP and skill key exists in its catalog', () => {
  const mcpIds = new Set(MCP_CATALOG.map((entry) => entry.id))
  for (const category of MCP_CATEGORIES) for (const key of category.keys) assert.ok(mcpIds.has(key), key)
  const skillIds = new Set(SKILL_TEMPLATES.map((template) => template.id))
  for (const category of SKILL_CATEGORIES) for (const key of category.keys) assert.ok(skillIds.has(key), key)
  for (const entry of MCP_CATALOG) assert.match(entry.url, /^https:\/\//)
})

test('MCP URLs match regardless of host case and trailing slash', () => {
  assert.equal(normalizeMcpServerUrl('https://MCP.Linear.app/mcp/'), normalizeMcpServerUrl('https://mcp.linear.app/mcp'))
  assert.notEqual(normalizeMcpServerUrl('https://mcp.linear.app/sse'), normalizeMcpServerUrl('https://mcp.linear.app/mcp'))
})

test('catalog search matches name or description case-insensitively', () => {
  assert.ok(matchesExtensionQuery('  CRM ', 'HubSpot', 'Contacts and CRM deals'))
  assert.ok(!matchesExtensionQuery('zapier', 'HubSpot', undefined))
  assert.ok(matchesExtensionQuery('', 'anything'))
})
