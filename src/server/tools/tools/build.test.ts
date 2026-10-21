import assert from 'node:assert/strict'
import test from 'node:test'
import { asSchema, type ToolSet } from 'ai'
import { buildOverlayToolSet } from './build'
import { createFreeTierGatedStubTools } from './free-tier-gated-stub-tools'
import { executeComputerActionWithApproval } from './overlay-executes'

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

test('computer screenshot returns image content and computer input validates action variants', () => {
  const tools = buildOverlayToolSet({
    userId: 'user-test',
    serverSecret: 'secret-test',
    baseUrl: 'http://localhost:3000',
    includePaidOnlyOverlayTools: true,
    memoryEnabled: true,
  })
  const screenshot = tools.computer_screenshot as unknown as {
    toModelOutput(args: {
      output: { success: boolean; width?: number; height?: number; image?: Uint8Array; error?: string }
    }): unknown
  }
  const image = new Uint8Array([137, 80, 78, 71])
  assert.deepEqual(screenshot.toModelOutput({
    output: { success: true, width: 640, height: 360, image },
  }), {
    type: 'content',
    value: [
      { type: 'text', text: 'Screenshot captured at 640 by 360 pixels.' },
      { type: 'file', data: { type: 'data', data: image }, mediaType: 'image/png' },
    ],
  })

  const inputSchema = tools.computer_input.inputSchema as {
    safeParse(input: unknown): { success: boolean }
  }
  assert.equal(inputSchema.safeParse({ action: 'click', x: 10, y: 20 }).success, true)
  assert.equal(inputSchema.safeParse({ action: 'type' }).success, false)

  const browser = tools.computer_browser as unknown as {
    inputSchema: { safeParse(input: unknown): { success: boolean } }
    toModelOutput(args: { output: { success: boolean; text?: string; error?: string } }): unknown
  }
  assert.equal(browser.inputSchema.safeParse({ action: 'navigate', url: 'https://example.test/' }).success, true)
  assert.equal(browser.inputSchema.safeParse({ action: 'navigate', url: 'file:///etc/passwd' }).success, false)
  assert.equal(browser.inputSchema.safeParse({ action: 'click' }).success, false)
  assert.deepEqual(browser.toModelOutput({
    output: { success: true, text: 'URL: https://example.test/\nTitle: Example' },
  }), {
    type: 'text',
    value: 'URL: https://example.test/\nTitle: Example',
  })
})

test('computer_browser typing is marked for Work-mode approval', async () => {
  const tools = buildOverlayToolSet({
    userId: 'user-test',
    baseUrl: 'http://localhost:3000',
    allowedToolIds: ['computer_browser'],
    computerApprovalContext: 'work',
  })
  const browser = tools.computer_browser as unknown as {
    needsApproval?: (input: unknown, options: unknown) => boolean | Promise<boolean>
  }

  assert.equal(typeof browser.needsApproval, 'function')
  assert.equal(await browser.needsApproval?.({
    action: 'type',
    ref: 'ref-1',
    text: 'hello',
    submit: true,
  }, {}), true)
})

test('computer input fails closed before operate for typing while scroll still operates', async () => {
  const tools = buildOverlayToolSet({
    userId: 'user-test',
    baseUrl: 'http://localhost:3000',
    allowedToolIds: ['computer_input'],
  })
  const computerInput = tools.computer_input as unknown as {
    execute: (input: unknown, options: unknown) => Promise<unknown>
    needsApproval?: unknown
  }
  assert.equal(computerInput.needsApproval, undefined)
  assert.deepEqual(await computerInput.execute({ action: 'type', text: 'hello' }, {}), {
    success: false,
    error: 'approval_required',
    message: 'Typing and key presses on the Computer need your approval. Switch this chat to Work mode, or ask the user to do it in Open desktop.',
  })

  let operateCalls = 0
  const operate = async () => {
    operateCalls += 1
    return { success: true }
  }

  const typing = await executeComputerActionWithApproval(
    {},
    'computer_input',
    { action: 'type', text: 'hello' },
    operate,
  )
  assert.deepEqual(typing, {
    success: false,
    error: 'approval_required',
    message: 'Typing and key presses on the Computer need your approval. Switch this chat to Work mode, or ask the user to do it in Open desktop.',
  })
  assert.equal(operateCalls, 0)

  const scrolling = await executeComputerActionWithApproval(
    {},
    'computer_input',
    { action: 'scroll', direction: 'down', amount: 2 },
    operate,
  )
  assert.deepEqual(scrolling, { success: true })
  assert.equal(operateCalls, 1)
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

test('free-tier stub tools expose Gateway-compatible input schemas', async () => {
  await assertGatewayCompatibleToolSet(createFreeTierGatedStubTools(true))
})
