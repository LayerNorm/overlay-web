import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Spec } from '@json-render/core'
import { buildGenerativeUiCatalogPrompt } from '@overlay/chat-core/generative-ui'
import { buildAssistantVisualSequence } from '@overlay/chat-core'
import { isGeneratedUiPart } from '@overlay/chat-core/generated-ui'
import { JsonRenderCard } from '@overlay/chat-react/json-render-card'
import { GeneratedUiCard } from '@overlay/chat-react/generated-ui-card'
import { buildAssistantPersistenceFromSteps } from '@/shared/chat/persist-assistant-turn'
import { asSchema, type ToolSet } from 'ai'
import { DRIVER_VERSION, type SandboxInstance } from '@overlay/sandbox-runtime'
import { getOverlayServerContext } from '@/server/bootstrap'
import { buildOverlayToolSet } from './build'
import { executeComputerActionWithApproval, executeComputerActionWithTakeover, executeRenderUi } from './overlay-executes'

const renderSpec = { root: 'root', elements: { root: { type: 'Text', props: { text: 'Weekly summary' } } } }
const renderOptions = { userId: 'user-test', serverSecret: 'secret-test', baseUrl: 'http://localhost:3000' }

function formSpec(): Spec {
  const example = buildGenerativeUiCatalogPrompt().split('\n').find(line => line.startsWith('Form example: '))
  assert.ok(example)
  return JSON.parse(example.slice('Form example: '.length))
}

function uiStep(toolCallId: string, toolName: string, output: unknown) {
  const call = { type: 'tool-call', toolCallId, toolName, input: {} }
  const result = { type: 'tool-result', toolCallId, toolName, input: {}, output }
  return { text: '', content: [call, result], toolCalls: [call], toolResults: [result] }
}

test('realistic bug forms execute, persist and render with nested bindings, extra props and misplaced children', async () => {
  const variants: Array<[string, (spec: Spec) => void]> = [
    ['canonical form', () => {}],
    ['field name', spec => { spec.elements.title!.props.name = 'title' }],
    ['button variant', spec => { spec.elements.submit!.props.variant = 'default' }],
    ['empty leaf children', spec => { for (const element of Object.values(spec.elements)) element.children ??= [] }],
    ['children in props', spec => {
      for (const id of ['card', 'fields']) {
        const element = spec.elements[id]!
        element.props.children = element.children
        delete element.children
      }
    }],
  ]
  for (const [name, mutate] of variants) {
    const spec = formSpec()
    spec.state = { form: { title: 'Sidebar disappears', details: 'Open a thread', severity: 'High', reproducible: true, frequency: 'Always' } }
    mutate(spec)
    const output = await executeRenderUi(renderOptions, { title: '  Bug report  ', summary: '  Complete the bug report.  ', spec })
    assert.equal(output.success, true, name)
    if (!output.success) continue
    const persistence = buildAssistantPersistenceFromSteps([uiStep('form', 'render_ui', output)] as never, '')
    const part = persistence.parts.find(isGeneratedUiPart)
    assert.ok(part, name)
    assert.equal(part.data.kind, 'json_render')
    if (part.data.kind !== 'json_render') continue
    const normalized = JSON.parse(part.data.specJson) as Spec
    assert.equal(Object.hasOwn(normalized.elements.title!.props, 'name'), false)
    assert.equal(Object.hasOwn(normalized.elements.submit!.props, 'variant'), false)
    assert.deepEqual(normalized.elements.card!.children, ['fields'])
    const html = renderToStaticMarkup(createElement(JsonRenderCard, { partId: part.id, data: part.data }))
    for (const expected of ['<input', '<textarea', 'role="combobox"', 'role="checkbox"', 'role="radiogroup"', 'Sidebar disappears', 'Submit bug report']) {
      assert.ok(html.includes(expected), `${name}: ${expected}`)
    }
    assert.ok(!html.includes('Could not display this view'), name)
  }
})

test('failed render_ui specs leave an error trace and actionable retry instructions, never a phantom card', async () => {
  const spec = formSpec()
  spec.elements.submit!.on = { press: { action: 'submit', params: { state: { $state: '/form' } } } }
  const output = await executeRenderUi(renderOptions, { summary: 'Bug report', spec })
  assert.equal(output.success, false)
  if (output.success) return
  assert.match(output.error, /No UI was created/)
  assert.match(output.hint, /Fix the listed issues and call render_ui again/)
  assert.match(output.hint, /Only claim a view was displayed after success:true/)
  assert.match(output.hint, /tell the user plainly that you could not display it/)
  const persistence = buildAssistantPersistenceFromSteps([uiStep('failed', 'render_ui', output)] as never, '')
  assert.ok(!persistence.parts.some(isGeneratedUiPart))
  const blocks = buildAssistantVisualSequence(persistence.parts)
  assert.equal(blocks[0]?.kind, 'tool')
  if (blocks[0]?.kind === 'tool') assert.equal(blocks[0].state, 'output-error')
})

test('typed questionnaires survive persistence and render their choices', () => {
  const generatedUi = { version: 1, kind: 'questionnaire', prompt: 'Which QA environment?',
    choices: [{ id: 'preview', label: 'Preview' }, { id: 'production', label: 'Production' }], multiple: false }
  const output = { success: true, id: 'question', generatedUi }
  const persistence = buildAssistantPersistenceFromSteps([uiStep('question', 'present_generated_ui', output)] as never, '')
  const part = persistence.parts.find(isGeneratedUiPart)
  assert.ok(part)
  const html = renderToStaticMarkup(createElement(GeneratedUiCard, { part }))
  assert.ok(html.includes('Which QA environment?'))
  assert.ok(html.includes('Preview') && html.includes('Production'))
})

test('render_ui normalizes raw execute inputs, validates and returns a deterministic serialized card', async () => {
  const result = await executeRenderUi(renderOptions, { summary: '  Weekly summary  ', title: '  Report  ', spec: renderSpec })
  assert.equal(result.success, true)
  if (!result.success) return
  assert.deepEqual(result.generatedUi, { version: 1, kind: 'json_render', catalogVersion: 1, summary: 'Weekly summary', title: 'Report', specJson: JSON.stringify(renderSpec) })
  assert.equal((await executeRenderUi(renderOptions, { summary: 'Weekly summary', title: 'Report', spec: renderSpec })).id, result.id)
  const untitled = await executeRenderUi(renderOptions, { summary: 'Summary', title: ' ', spec: renderSpec })
  assert.ok(untitled.success && !('title' in untitled.generatedUi))
})

test('render_ui rejects invalid raw payloads with bounded repair details', async () => {
  for (const input of [null, {}, { summary: ' ', spec: renderSpec }, { summary: 'x'.repeat(1001), spec: renderSpec },
    { summary: 'Summary', title: 123, spec: renderSpec }, { summary: 'Summary', title: 'x'.repeat(121), spec: renderSpec },
    { summary: 'Summary', spec: { root: 'root', elements: { root: { type: 'Unknown', props: {} } } } },
    { summary: 'Summary', spec: { root: 'root', elements: { root: { type: 'Link', props: { label: 'Unsafe', url: 'http://example.com' } } } } },
  ]) {
    const result = await executeRenderUi(renderOptions, input)
    assert.equal(result.success, false)
    if (result.success) continue
    assert.equal(result.code, 'tool_validation_failure')
    assert.ok(result.error && result.hint)
    assert.ok(result.issues.length > 0 && result.issues.length <= 12)
    assert.ok(!('generatedUi' in result))
  }
})

test('personal, native and automation builders expose render_ui with a permissive object schema', async () => {
  for (const surface of [{}, { agentId: 'agent', sharedRoom: true }, { automationId: 'automation' }]) {
    const tools = buildOverlayToolSet({ ...renderOptions, ...surface, allowedToolIds: [] })
    assert.ok(tools.present_generated_ui && tools.render_ui)
    const schema = await asSchema(tools.render_ui.inputSchema).jsonSchema as { type: string; properties: { spec: { type: string; additionalProperties: boolean } } }
    assert.equal(schema.type, 'object')
    assert.equal(schema.properties.spec.type, 'object')
    assert.equal(schema.properties.spec.additionalProperties, true)
    const execute = tools.render_ui.execute as unknown as (input: unknown) => Promise<{ success: boolean }>
    assert.equal((await execute({ summary: 'Summary', spec: {} })).success, false)
    assert.equal((await execute({ summary: 'Summary', spec: renderSpec })).success, true)
  }
})

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

test('binary publication requires both the computer-publication and write-file grants', () => {
  const withoutFileGrant = buildOverlayToolSet({
    userId: 'user-test',
    baseUrl: 'http://localhost:3000',
    allowedToolIds: ['computer_publish_file'],
  })
  const withBothGrants = buildOverlayToolSet({
    userId: 'user-test',
    baseUrl: 'http://localhost:3000',
    allowedToolIds: ['computer_publish_file', 'write_file'],
  })
  assert.equal(withoutFileGrant.computer_publish_file, undefined)
  assert.ok(withBothGrants.computer_publish_file)
})

test('computer_browser typing in durable personal runs requires approval', async () => {
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
    message: "This action needs approval. Review it in personal chat with a connected Computer, or set this agent's Permissions to Auto.",
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
    message: "This action needs approval. Review it in personal chat with a connected Computer, or set this agent's Permissions to Auto.",
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

test('create_note requires a non-empty title', () => {
  const tools = buildOverlayToolSet({
    userId: 'user-test',
    baseUrl: 'http://localhost:3000',
    allowedToolIds: ['create_note'],
  })
  const inputSchema = tools.create_note.inputSchema as {
    safeParse(input: unknown): { success: boolean }
  }

  assert.equal(inputSchema.safeParse({ content: 'Markdown body' }).success, false)
  assert.equal(inputSchema.safeParse({ title: '   ', content: 'Markdown body' }).success, false)
  assert.equal(inputSchema.safeParse({ title: 'Note title', content: 'Markdown body' }).success, true)
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

test('present_generated_ui returns bounded repair details for invalid generated UI input', async () => {
  const execute = (buildTestTools().present_generated_ui as unknown as {
    execute(input: unknown): Promise<Record<string, unknown>>
  }).execute
  const result = await execute({
    kind: 'questionnaire',
    prompt: 'Which focus?',
    choices: [{ id: 'same', label: 'One' }, { id: 'same', label: 'Two' }],
  })
  assert.equal(result.success, false)
  assert.equal(result.code, 'tool_validation_failure')
  assert.deepEqual(result.issues, [{
    path: 'generatedUi',
    code: 'normalization_failed',
    message: 'The payload could not be normalized to an allowed generated UI card.',
  }])
  assert.match(String(result.hint), /harness_report_blocker/)
})

test('present_generated_ui schema failures include bounded issue paths without echoing payloads', async () => {
  const execute = (buildTestTools().present_generated_ui as unknown as {
    execute(input: unknown): Promise<Record<string, unknown>>
  }).execute
  const result = await execute({ kind: 'draft.email', body: 'Draft text', privateMarker: 'do-not-echo' })
  assert.equal(result.success, false)
  assert.equal(result.code, 'tool_validation_failure')
  assert.ok(Array.isArray(result.issues))
  assert.ok((result.issues as Array<{ path: string }>).some(issue => issue.path === 'subject'))
  assert.ok(!(JSON.stringify(result).includes('do-not-echo')))
})
