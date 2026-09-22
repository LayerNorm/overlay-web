import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import { jsonSchema, tool, type ToolSet } from 'ai'
import { z } from 'zod'
import {
  analyzeToolSetForGatewayCompatibility,
  filterGatewayCompatibleToolSet,
} from './tool-schema-compat'
import {
  deepSearchInputSchema,
  webFetchInputSchema,
  webSearchInputSchema,
} from '@/server/tools/tools/web-search'

function noopTool(schema: ToolSet[string]['inputSchema']): ToolSet[string] {
  return tool({
    description: 'Contract-test tool',
    inputSchema: schema,
    execute: async () => ({ ok: true }),
  })
}

const candidateToolSets: Array<[string, ToolSet]> = [
  [
    'web_search_function_wrappers',
    {
      web_search: noopTool(webSearchInputSchema),
      deep_search: noopTool(deepSearchInputSchema),
      web_fetch: noopTool(webFetchInputSchema),
    },
  ],
  [
    'representative_external_tools',
    {
      COMPOSIO_SEARCH_TOOLS: noopTool(jsonSchema({
        type: 'object',
        properties: {
          query: { type: 'string' },
        },
        required: ['query'],
        additionalProperties: false,
      })),
      mcp_deepwiki_ask_question: noopTool(z.object({
        repoName: z.string().min(1),
        question: z.string().min(1),
      })),
    },
  ],
]

for (const [name, toolSet] of candidateToolSets) {
  test(`${name} tools expose Gateway-compatible input schemas`, async () => {
    const violations = await analyzeToolSetForGatewayCompatibility(toolSet)
    assert.deepEqual(violations, [])
  })
}

test('Gateway tool quarantine drops invalid root-union schemas without dropping valid tools', async () => {
  const good = noopTool(z.object({ query: z.string().min(1) }))
  const bad = noopTool(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('draft.text'), body: z.string().min(1) }),
    z.object({ kind: z.literal('draft.email'), subject: z.string().min(1), body: z.string().min(1) }),
  ]))

  const filtered = await filterGatewayCompatibleToolSet({ good, bad })

  assert.deepEqual(Object.keys(filtered.tools), ['good'])
  assert.deepEqual(filtered.dropped, [
    { toolName: 'bad', reason: 'root_anyOf_not_supported' },
  ])
})
