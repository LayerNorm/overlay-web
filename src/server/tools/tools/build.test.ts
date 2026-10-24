import assert from 'node:assert/strict'
import test from 'node:test'
import { asSchema, type ToolSet } from 'ai'
import { buildOverlayToolSet } from './build'
import { createFreeTierGatedStubTools } from './free-tier-gated-stub-tools'

function buildTestTools() {
  return buildOverlayToolSet({
    userId: 'user-test',
    serverSecret: 'secret-test',
    baseUrl: 'http://localhost:3000',
    allowedToolIds: [],
    includePaidOnlyOverlayTools: true,
    memoryEnabled: true,
  })
}

async function assertGatewayCompatibleToolSet(toolSet: ToolSet) {
  const violations: string[] = []
  for (const [toolName, toolDef] of Object.entries(toolSet)) {
    const schema = await asSchema(toolDef.inputSchema).jsonSchema as {
      anyOf?: unknown
      oneOf?: unknown
      type?: unknown
    }
    if (schema.type !== 'object') violations.push(`${toolName}:root_type_${String(schema.type)}`)
    if (schema.anyOf) violations.push(`${toolName}:root_anyOf`)
    if (schema.oneOf) violations.push(`${toolName}:root_oneOf`)
  }
  assert.deepEqual(violations, [])
}

test('present_generated_ui exposes a Gateway-compatible object schema', async () => {
  const tools = buildTestTools()
  const schema = await asSchema(tools.present_generated_ui.inputSchema).jsonSchema as {
    anyOf?: unknown
    oneOf?: unknown
    type?: unknown
  }

  assert.equal(schema.type, 'object')
  assert.equal(schema.anyOf, undefined)
  assert.equal(schema.oneOf, undefined)
})

test('present_generated_ui still validates variant-specific required fields', async () => {
  const tools = buildTestTools()
  const inputSchema = tools.present_generated_ui.inputSchema as {
    safeParse(input: unknown): { success: boolean }
  }

  assert.equal(inputSchema.safeParse({ kind: 'draft.email', body: 'Missing subject' }).success, false)
  assert.equal(inputSchema.safeParse({ kind: 'draft.text', body: 'Draft body' }).success, true)
  assert.equal(inputSchema.safeParse({
    kind: 'draft.text',
    title: 'Landing page',
    body: '<!DOCTYPE html>\n<html><body>Hello</body></html>',
  }).success, false)
})

test('Overlay tools expose Gateway-compatible input schemas', async () => {
  await assertGatewayCompatibleToolSet(buildOverlayToolSet({
    userId: 'user-test',
    serverSecret: 'secret-test',
    baseUrl: 'http://localhost:3000',
    includePaidOnlyOverlayTools: true,
    memoryEnabled: true,
  }))
})

test('present_generated_ui accepts a bounded conversational questionnaire without permission fields', () => {
  const inputSchema = buildTestTools().present_generated_ui.inputSchema as {
    safeParse(input: unknown): { success: boolean }
  }
  const question = { kind: 'questionnaire', prompt: 'Which focus?', choices: [{ id: 'research', label: 'Research' }], multiple: true }
  assert.equal(inputSchema.safeParse(question).success, true)
  assert.equal(inputSchema.safeParse({ ...question, prompt: '' }).success, false)
  assert.equal(inputSchema.safeParse({ ...question, approveExecution: true }).success, false)
})

test('free-tier stub tools expose Gateway-compatible input schemas', async () => {
  await assertGatewayCompatibleToolSet(createFreeTierGatedStubTools(true))
})
