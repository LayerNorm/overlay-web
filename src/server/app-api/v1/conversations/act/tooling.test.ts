import assert from 'node:assert/strict'
import test from 'node:test'
import type { ToolSet } from '@/server/ai/sdk'
import {
  applyAccountToolPolicy,
  buildActTooling,
  intersectConnectorPolicies,
} from './tooling'

const toolSet = (tools: Record<string, object>): ToolSet => tools as unknown as ToolSet

test('buildActTooling preserves paid primary tool composition', () => {
  const tooling = buildActTooling({
    allowedOverlayToolIds: ['generate_image'],
    integrationRaw: toolSet({ GMAIL_SEND_EMAIL: {}, BROWSER_NAVIGATE: {} }),
    isMultiModelFollowUpSlot: false,
    mcpToolsRaw: toolSet({ search_mcp_tools: {}, call_mcp_tool: {} }),
    paid: true,
    parallelTool: {} as ToolSet[string],
    perplexityTool: {} as ToolSet[string],
    webToolSet: toolSet({ generate_image: {}, save_memory: {} }),
  })

  assert.deepEqual(tooling.allowedOverlayToolIds, ['generate_image'])
  assert.equal(tooling.gatewaySearchLog, 'perplexity:yes parallel:yes')
  assert.equal(tooling.missingGatewaySearchTools, false)
  assert.deepEqual(tooling.exposedMediaTools, ['generate_image'])
  assert.deepEqual(Object.keys(tooling.tools).sort(), [
    'BROWSER_NAVIGATE',
    'GMAIL_SEND_EMAIL',
    'call_mcp_tool',
    'generate_image',
    'parallel_search',
    'perplexity_search',
    'save_memory',
    'search_mcp_tools',
  ])
})

test('buildActTooling preserves free-tier and compare-slot stripping behavior', () => {
  const freePrimary = buildActTooling({
    allowedOverlayToolIds: [],
    integrationRaw: toolSet({ GMAIL_SEND_EMAIL: {}, BROWSER_NAVIGATE: {} }),
    isMultiModelFollowUpSlot: false,
    mcpToolsRaw: toolSet({ search_mcp_tools: {}, call_mcp_tool: {} }),
    paid: false,
    parallelTool: null,
    perplexityTool: null,
    webToolSet: toolSet({ save_memory: {} }),
  })
  assert.equal('GMAIL_SEND_EMAIL' in freePrimary.tools, true)
  assert.equal('BROWSER_NAVIGATE' in freePrimary.tools, false)
  assert.equal('search_mcp_tools' in freePrimary.tools, true)
  assert.equal('call_mcp_tool' in freePrimary.tools, true)
  assert.equal('perplexity_search' in freePrimary.tools, true)
  assert.equal('parallel_search' in freePrimary.tools, true)
  assert.equal('run_daytona_sandbox' in freePrimary.tools, true)

  const compareSlot = buildActTooling({
    allowedOverlayToolIds: [],
    integrationRaw: toolSet({ GMAIL_SEND_EMAIL: {} }),
    isMultiModelFollowUpSlot: true,
    mcpToolsRaw: toolSet({ search_mcp_tools: {}, call_mcp_tool: {} }),
    paid: true,
    parallelTool: {} as ToolSet[string],
    perplexityTool: {} as ToolSet[string],
    webToolSet: toolSet({ save_memory: {} }),
  })
  assert.equal('GMAIL_SEND_EMAIL' in compareSlot.tools, false)
  assert.equal('search_mcp_tools' in compareSlot.tools, false)
  assert.equal('call_mcp_tool' in compareSlot.tools, false)
  assert.equal('save_memory' in compareSlot.tools, true)
  assert.equal('perplexity_search' in compareSlot.tools, true)
})

test('connector policies intersect deployment-account access with project access', () => {
  assert.equal(intersectConnectorPolicies(undefined, undefined), undefined)
  assert.deepEqual(intersectConnectorPolicies(['gmail', 'slack'], undefined), ['gmail', 'slack'])
  assert.deepEqual(intersectConnectorPolicies(undefined, ['gmail']), ['gmail'])
  assert.deepEqual(
    intersectConnectorPolicies(['gmail', 'slack'], ['slack', 'github']),
    ['slack'],
  )
  assert.deepEqual(intersectConnectorPolicies([], ['gmail']), [])
})

test('account tool policy can only narrow deployment-enabled tools', () => {
  assert.deepEqual(
    applyAccountToolPolicy(['search_knowledge', 'create_note'], ['create_note', 'delete_note']),
    ['create_note'],
  )
  assert.deepEqual(applyAccountToolPolicy(['search_knowledge'], []), [])
  assert.deepEqual(applyAccountToolPolicy(['search_knowledge'], undefined), ['search_knowledge'])
})

test('buildActTooling rejects connector execution withheld by account policy', async () => {
  const tooling = buildActTooling({
    allowedOverlayToolIds: [],
    enabledConnectorSlugs: ['gmail'],
    integrationRaw: toolSet({
      execute_connector: {
        execute: async (input: unknown) => input,
      },
    }),
    isMultiModelFollowUpSlot: false,
    mcpToolsRaw: toolSet({}),
    paid: true,
    parallelTool: null,
    perplexityTool: null,
    webToolSet: toolSet({}),
  })

  const execute = (tooling.tools.execute_connector as {
    execute?: (input: unknown, options: unknown) => Promise<unknown>
  }).execute
  assert.ok(execute)
  assert.deepEqual(await execute({ connector: 'gmail' }, {}), { connector: 'gmail' })
  await assert.rejects(
    () => execute({ connector: 'slack' }, {}),
    /only permits these connectors: gmail/,
  )
})
