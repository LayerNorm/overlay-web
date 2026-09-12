import assert from 'node:assert/strict'
import test from 'node:test'
import {
  describePersonalChatWorkTools,
  sanitizeWorkflowToolSchemaValue,
} from './personal-chat-work-tools'
import { jsonSchema, tool } from 'ai'

test('strips JSON Schema format keywords from serialized tool schemas', async () => {
  // Repro of the production Work-mode crash: the workflow step compiles tool
  // schemas with Ajv in strict mode, which throws on `format: "uri"`.
  const tools = {
    computer_open_url: tool({
      description: 'Open a URL on the computer',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          connectUrl: { type: 'string', format: 'uri' },
          at: { type: 'string', format: 'date-time' },
          nested: {
            type: 'object',
            properties: {
              link: { type: 'string', format: 'uri-reference' },
            },
          },
        },
        required: ['connectUrl'],
      }),
      execute: async () => ({}),
    }),
  }

  const [definition] = await describePersonalChatWorkTools(tools, false)
  const schema = JSON.stringify(definition.inputSchema)
  assert.equal(schema.includes('"format"'), false)
  assert.deepEqual(
    (definition.inputSchema.properties as Record<string, unknown>).connectUrl,
    { type: 'string' },
  )
  assert.deepEqual(definition.inputSchema.required, ['connectUrl'])
})

test('sanitizeWorkflowToolSchemaValue leaves non-format keys untouched', () => {
  const input = {
    type: 'object',
    properties: {
      pattern: { type: 'string', pattern: '^[a-z]+$' },
      list: { type: 'array', items: { type: 'number', minimum: 1 } },
    },
    additionalProperties: false,
  }
  assert.deepEqual(sanitizeWorkflowToolSchemaValue(input), input)
})
