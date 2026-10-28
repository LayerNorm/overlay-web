import assert from 'node:assert/strict'
import test from 'node:test'
import { asSchema, type ToolSet } from 'ai'
import { DRIVER_VERSION, type SandboxInstance } from '@overlay/sandbox-runtime'
import { getOverlayServerContext } from '@/server/bootstrap'
import { buildOverlayToolSet } from './build'
import { createFreeTierGatedStubTools } from './free-tier-gated-stub-tools'
import { executeComputerActionWithApproval, executeComputerActionWithTakeover } from './overlay-executes'

function buildTestTools() {
  return buildOverlayToolSet({
    userId: 'user-test',
    serverSecret: 'secret-test',
    baseUrl: 'http://localhost:3000',
    allowedToolIds: [],
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
  assert.equal(inputSchema.safeParse({ action: 'click', x: 10, y: 20, confirm: true }).success, true)
  assert.equal(inputSchema.safeParse({ action: 'double_click', x: 10, y: 20, confirm: true }).success, true)
  assert.equal(inputSchema.safeParse({ action: 'right_click', x: 10, y: 20, confirm: true }).success, true)
  assert.equal(inputSchema.safeParse({ action: 'type' }).success, false)

  const browser = tools.computer_browser as unknown as {
    description: string
    inputSchema: { safeParse(input: unknown): { success: boolean } }
    toModelOutput(args: { output: { success: boolean; text?: string; error?: string } }): unknown
  }
  assert.match(browser.description, /stale_browser_ref.*no action occurred/)
  assert.match(browser.description, /fresh snapshot after page changes/)
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
    message: "This action needs approval. Use Work mode, or set this agent's Permissions to Auto.",
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
    message: "This action needs approval. Use Work mode, or set this agent's Permissions to Auto.",
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

test('Auto automation runs computer typing and exec without approval_required', async () => {
  const options = {
    approvalMode: 'auto' as const,
    computerApprovalContext: 'automation' as const,
  }
  const calls: string[] = []
  const computerType = await executeComputerActionWithApproval(
    options,
    'computer_input',
    { action: 'type', text: 'hello' },
    async () => {
      calls.push('computer_input')
      return { success: true }
    },
  )
  const computerExec = await executeComputerActionWithApproval(
    options,
    'computer_exec',
    { command: 'printf hello' },
    async () => {
      calls.push('computer_exec')
      return { success: true }
    },
  )
  assert.deepEqual(computerType, { success: true })
  assert.deepEqual(computerExec, { success: true })
  assert.deepEqual(calls, ['computer_input', 'computer_exec'])
})

test('computer input preserves a driver approval_required result for the model', async () => {
  const result = await executeComputerActionWithApproval(
    { computerApprovalContext: 'work' },
    'computer_input',
    { action: 'click', confirm: true },
    async () => ({
      success: false,
      error: 'approval_required',
      label: 'Delete account',
      message: 'This click may post, send, buy, or delete something.',
    }),
  )
  assert.deepEqual(result, {
    success: false,
    error: 'approval_required',
    label: 'Delete account',
    message: 'This click may post, send, buy, or delete something.',
  })
})

test('Computer maintenance conflicts return a clear busy tool error', async () => {
  const previousNextPhase = process.env.NEXT_PHASE
  process.env.NEXT_PHASE = 'phase-production-build'
  let context: ReturnType<typeof getOverlayServerContext>
  try {
    context = getOverlayServerContext()
  } finally {
    if (previousNextPhase === undefined) delete process.env.NEXT_PHASE
    else process.env.NEXT_PHASE = previousNextPhase
  }
  const originalComputerService = context.computerService
  const originalWorkspaceService = context.workspaceService
  const computer = { id: 'computer-1', name: 'Computer', controlledByUserId: undefined }
  context.workspaceService = {
    ...originalWorkspaceService,
    listForUser: async () => [{
      workspace: { id: 'ws-1' },
      principal: { id: 'principal-1' },
      membership: { role: 'member' },
    }],
  } as unknown as typeof context.workspaceService
  context.computerService = {
    ...originalComputerService,
    getForOwner: async () => computer,
    withOwnerOperation: async () => {
      throw new Error('COMPUTER_MAINTENANCE_IN_PROGRESS')
    },
  } as unknown as typeof context.computerService

  try {
    const tools = buildOverlayToolSet({
      userId: 'user-test',
      workspaceId: 'ws-1',
      baseUrl: 'http://localhost:3000',
      allowedToolIds: ['computer_input'],
    })
    const computerInput = tools.computer_input as unknown as {
      execute: (input: unknown, options: unknown) => Promise<unknown>
    }

    assert.deepEqual(await computerInput.execute({ action: 'click', x: 10, y: 20 }, {}), {
      success: false,
      error: 'computer_busy',
      message: 'The Computer is busy with another action. Wait a moment and try again.',
    })
  } finally {
    context.computerService = originalComputerService
    context.workspaceService = originalWorkspaceService
  }
})

test('computer takeover blocks input but keeps screenshot and browser snapshot available', async () => {
  let operateCalls = 0
  const operate = async () => {
    operateCalls += 1
    return { success: true }
  }

  const click = await executeComputerActionWithTakeover(
    'user-1',
    'computer_input',
    { action: 'click', x: 5, y: 5 },
    operate,
  )
  assert.deepEqual(click, {
    success: false,
    error: 'user_in_control',
    message: 'The user has taken control of this Computer. Wait for them to hand it back, then take a new screenshot or snapshot before continuing.',
  })
  assert.equal(operateCalls, 0)

  assert.deepEqual(await executeComputerActionWithTakeover('user-1', 'computer_screenshot', {}, operate), { success: true })
  assert.equal(operateCalls, 1)
  assert.deepEqual(
    await executeComputerActionWithTakeover('user-1', 'computer_browser', { action: 'snapshot' }, operate),
    { success: true },
  )
  assert.equal(operateCalls, 2)
})

test('computer_input click resolves its computer once', async () => {
  const previousNextPhase = process.env.NEXT_PHASE
  process.env.NEXT_PHASE = 'phase-production-build'
  let context: ReturnType<typeof getOverlayServerContext>
  try {
    context = getOverlayServerContext()
  } finally {
    if (previousNextPhase === undefined) delete process.env.NEXT_PHASE
    else process.env.NEXT_PHASE = previousNextPhase
  }
  const originalComputerService = context.computerService
  const originalWorkspaceService = context.workspaceService
  let getForOwnerCalls = 0
  let failInput = false
  let requireClickApproval = false
  const computer = { id: 'computer-1', name: 'Computer', controlledByUserId: undefined }
  const instance = {
    capabilities: { desktop: true },
    runCommand: async (request: { args?: string[] }) => {
      const driverRequest = JSON.parse(request.args?.at(-1) ?? '{}') as { command?: string }
      const inputFailed = failInput && driverRequest.command === 'click'
      const clickApprovalRequired = requireClickApproval && driverRequest.command === 'click'
      const stdout = driverRequest.command === 'capabilities'
        ? JSON.stringify({
            version: DRIVER_VERSION,
            display: ':0',
            screen: { width: 1280, height: 720 },
            input: true,
            screenshot: true,
            missing: [],
          })
        : inputFailed
          ? JSON.stringify({
              error: {
                code: 'desktop_driver_failed',
                message: 'The desktop input command failed.',
                detail: {
                  exit: 7,
                  subcommand: 'click',
                  stderr: 'input device unavailable',
                },
              },
            })
          : clickApprovalRequired
            ? JSON.stringify({
                success: false,
                error: 'approval_required',
                label: 'Post',
                message: 'This click may post, send, buy, or delete something. Call computer_input click again with confirm: true to ask the user for approval.',
              })
          : JSON.stringify({ success: true })
      return {
        wait: async () => ({
          commandId: 'command-1',
          exitCode: inputFailed ? 1 : 0,
          stdout,
          stderr: '',
          startedAt: 0,
          endedAt: 1,
        }),
      }
    },
  } as unknown as SandboxInstance
  context.workspaceService = {
    ...originalWorkspaceService,
    listForUser: async () => [{
      workspace: { id: 'ws-1' },
      principal: { id: 'principal-1' },
      membership: { role: 'member' },
    }],
  } as unknown as typeof context.workspaceService
  context.computerService = {
    ...originalComputerService,
    getForOwner: async () => {
      getForOwnerCalls += 1
      return computer
    },
    withOwnerOperation: async ({ operation }: {
      operation: (current: typeof computer, sandbox: SandboxInstance) => Promise<unknown>
    }) => await operation(computer, instance),
  } as unknown as typeof context.computerService

  try {
    const tools = buildOverlayToolSet({
      userId: 'user-test',
      workspaceId: 'ws-1',
      baseUrl: 'http://localhost:3000',
      allowedToolIds: ['computer_input'],
    })
    const computerInput = tools.computer_input as unknown as {
      execute: (input: unknown, options: unknown) => Promise<unknown>
    }

    assert.deepEqual(await computerInput.execute({ action: 'click', x: 10, y: 20 }, {}), {
      success: true,
      acknowledgement: 'click completed.',
    })
    assert.equal(getForOwnerCalls, 1)

    requireClickApproval = true
    assert.deepEqual(await computerInput.execute({ action: 'click', x: 10, y: 20 }, {}), {
      success: false,
      error: 'approval_required',
      label: 'Post',
      message: 'This click may post, send, buy, or delete something. Call computer_input click again with confirm: true to ask the user for approval.',
    })
    assert.equal(getForOwnerCalls, 2)

    requireClickApproval = false
    failInput = true
    assert.deepEqual(await computerInput.execute({ action: 'click', x: 10, y: 20 }, {}), {
      success: false,
      error: 'The desktop input command failed.',
      code: 'desktop_driver_failed',
      detail: {
        exit: 7,
        subcommand: 'click',
        stderr: 'input device unavailable',
      },
    })
    assert.equal(getForOwnerCalls, 3)
  } finally {
    context.computerService = originalComputerService
    context.workspaceService = originalWorkspaceService
  }
})

test('Overlay tools expose Gateway-compatible input schemas', async () => {
  await assertGatewayCompatibleToolSet(buildOverlayToolSet({
    userId: 'user-test',
    serverSecret: 'secret-test',
    baseUrl: 'http://localhost:3000',
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
