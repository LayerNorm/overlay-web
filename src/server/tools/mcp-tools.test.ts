import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildMcpToolsContext,
  rankMcpCatalogEntries,
  stripReservedSchemaKeys,
} from './mcp-tools'

const entries = [
  {
    serverId: 's1',
    serverName: 'GitHub',
    name: 'create_issue',
    description: 'Create a GitHub issue',
  },
  {
    serverId: 's1',
    serverName: 'GitHub',
    name: 'list_repos',
    description: 'List repositories',
  },
  {
    serverId: 's2',
    serverName: 'Weather',
    name: 'get_forecast',
    description: 'Fetch weather forecast for a city',
  },
]

test('rankMcpCatalogEntries returns prefix of catalog for empty query', () => {
  const ranked = rankMcpCatalogEntries(entries, '', 2)
  assert.equal(ranked.length, 2)
  assert.equal(ranked[0]?.name, 'create_issue')
  assert.equal(ranked[0]?.score, 0)
})

test('rankMcpCatalogEntries prefers exact and name matches', () => {
  const ranked = rankMcpCatalogEntries(entries, 'create issue', 5)
  assert.equal(ranked[0]?.name, 'create_issue')
  assert.ok((ranked[0]?.score ?? 0) > (ranked[1]?.score ?? 0))
})

test('rankMcpCatalogEntries matches descriptions and server names', () => {
  const ranked = rankMcpCatalogEntries(entries, 'weather forecast', 5)
  assert.equal(ranked[0]?.name, 'get_forecast')
})

test('stripReservedSchemaKeys removes $-prefixed keys Convex refuses to store', () => {
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search text' },
      filters: {
        type: 'array',
        items: { $ref: '#/$defs/filter', type: 'object' },
      },
    },
    $defs: { filter: { type: 'object' } },
    required: ['query'],
  }

  const cleaned = stripReservedSchemaKeys(schema) as Record<string, unknown>

  assert.equal(JSON.stringify(cleaned).includes('"$'), false)
  assert.deepEqual(cleaned, {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search text' },
      filters: { type: 'array', items: { type: 'object' } },
    },
    required: ['query'],
  })
})

test('stripReservedSchemaKeys leaves primitives and plain schemas untouched', () => {
  assert.equal(stripReservedSchemaKeys(undefined), undefined)
  assert.equal(stripReservedSchemaKeys('text'), 'text')
  assert.deepEqual(stripReservedSchemaKeys({ type: 'object' }), { type: 'object' })
})

test('buildMcpToolsContext keys request context by executable tool name', () => {
  assert.deepEqual(buildMcpToolsContext({
    userId: 'user_1',
    conversationId: 'conversation_1',
    turnId: 'turn_1',
    modelId: 'model_1',
  }), {
    call_mcp_tool: {
      userId: 'user_1',
      conversationId: 'conversation_1',
      turnId: 'turn_1',
      modelId: 'model_1',
    },
  })
})
