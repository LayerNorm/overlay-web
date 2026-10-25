import assert from 'node:assert/strict'
import test from 'node:test'
import {
  describePersonalChatWorkTools,
  executePersonalChatWorkToolResult,
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

test('Work tool output converts screenshot bytes for the model and omits them from display', async () => {
  const image = new Uint8Array([137, 80, 78, 71])
  let mapperInput: unknown
  let mapperCallId = ''
  const result = await executePersonalChatWorkToolResult({
    execute: async () => ({ success: true, image, width: 1280, height: 720 }),
    input: {},
    toolCallId: 'screenshot-call',
    toModelOutput: ({ toolCallId, input, output }) => {
      mapperCallId = toolCallId
      mapperInput = input
      const screenshot = output as { image: Uint8Array; width: number; height: number }
      return {
        type: 'content',
        value: [
          { type: 'text', text: `Screenshot captured at ${screenshot.width} by ${screenshot.height} pixels.` },
          {
            type: 'file',
            data: { type: 'data', data: screenshot.image },
            mediaType: 'image/png',
          },
        ],
      }
    },
  })

  assert.equal(mapperCallId, 'screenshot-call')
  assert.deepEqual(mapperInput, {})
  assert.deepEqual(result, {
    overlayModelOutput: {
      type: 'content',
      value: [
        { type: 'text', text: 'Screenshot captured at 1280 by 720 pixels.' },
        {
          type: 'file',
          data: { type: 'data', data: 'iVBORw==' },
          mediaType: 'image/png',
        },
      ],
    },
    display: {
      success: true,
      image: { omitted: 'image', bytes: 4 },
      width: 1280,
      height: 720,
    },
  })
})

test('Work tools without toModelOutput preserve their plain JSON output', async () => {
  const output = { success: true, result: 'unchanged' }
  const result = await executePersonalChatWorkToolResult({
    execute: async () => output,
    input: {},
    toolCallId: 'json-call',
  })

  assert.equal(result, output)
})
