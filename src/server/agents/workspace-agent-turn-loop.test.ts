import assert from 'node:assert/strict'
import test from 'node:test'
import { generateText, type ModelMessage } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import type {
  WorkspaceAgentModelCall,
  WorkspaceAgentPreparedContext,
} from './workspace-agent-durable'
import {
  runWorkspaceAgentTurnLoop,
  type WorkspaceAgentLoopUsage,
  type WorkspaceAgentTurnLoopDependencies,
} from './workspace-agent-turn-loop'
import {
  refusedAmbiguousWorkspaceAgentToolRetry,
  workspaceAgentToolResultFromOutput,
  workspaceAgentToolResultOutput,
} from './workspace-agent-turn-utils'
import { settleWorkspaceAgentUsageWithPolicy } from './workspace-agent-usage'

function prepared(maxSteps = 5): WorkspaceAgentPreparedContext {
  return {
    messages: [{ role: 'user', content: 'Complete this action.' }],
    maxSteps,
  } as WorkspaceAgentPreparedContext
}

function modelCall(
  toolCalls: WorkspaceAgentModelCall['toolCalls'] = [],
  text = '',
  usage = { inputTokens: 13, outputTokens: 7 },
): WorkspaceAgentModelCall {
  return {
    text,
    responseMessages: [],
    toolCalls,
    usage,
    finishReason: toolCalls.length ? 'tool-calls' : 'stop',
    parts: [],
    transcriptParts: [],
  }
}

function toolCall(toolName: string, toolCallId: string) {
  return { toolCallId, toolName, input: { action: 'run' } }
}

function successToolResult(output: unknown) {
  return workspaceAgentToolResultFromOutput({ output, display: output })
}

function createDependencies(args: {
  calls: WorkspaceAgentModelCall[]
  needsApproval?: boolean
  approved?: boolean
  actions?: string[]
}): WorkspaceAgentTurnLoopDependencies {
  return {
    beginFirstModelCall: async () => undefined,
    callModel: async ({ modelStep }) => args.calls[modelStep],
    inspectTool: async () => ({ available: true, needsApproval: args.needsApproval ?? false }),
    requestApproval: async () => ({ approved: args.approved ?? true }),
    executeTool: async ({ toolCall: current }) => {
      args.actions?.push(current.toolCallId)
      return successToolResult({ success: true })
    },
    persistProgress: async () => undefined,
    finalize: async () => ({ completed: true }),
  }
}

function usageState(): WorkspaceAgentLoopUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    usageKnown: true,
    providerCallStarted: false,
    providerOutcomeAmbiguous: false,
  }
}

test('normalizes native tool results and feeds them to a subsequent AI SDK mock completion', async () => {
  const screenshotResult = workspaceAgentToolResultFromOutput({
    output: {
      type: 'content',
      value: [{
        type: 'image-data',
        data: 'c2NyZWVuc2hvdA==',
        mediaType: 'image/png',
      }],
    },
    display: { screenshot: '[screenshot omitted]' },
    outputIsMapped: true,
  })
  const results = [
    workspaceAgentToolResultOutput(workspaceAgentToolResultFromOutput({ output: { found: true }, display: { found: true } })),
    workspaceAgentToolResultOutput(workspaceAgentToolResultFromOutput({
      output: { error: 'The action was denied.' },
      display: { error: 'The action was denied.' },
      error: 'The action was denied.',
    })),
    workspaceAgentToolResultOutput(screenshotResult),
  ]
  const model = new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: 'text', text: 'I received all three results.' }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 6, text: 6, reasoning: 0 },
      },
      warnings: [],
    },
  })
  const names = ['jsonTool', 'deniedTool', 'screenshotTool']
  const ids = ['json-1', 'denied-1', 'screenshot-1']
  const messages: ModelMessage[] = [
    {
      role: 'assistant',
      content: names.map((toolName, index) => ({
        type: 'tool-call' as const,
        toolCallId: ids[index],
        toolName,
        input: {},
      })),
    },
    {
      role: 'tool',
      content: results.map((output, index) => ({
        type: 'tool-result' as const,
        toolCallId: ids[index],
        toolName: names[index],
        output,
      })),
    },
  ]

  const response = await generateText({ model, messages })
  const prompt = model.doGenerateCalls[0]?.prompt ?? []
  const serializedPrompt = JSON.stringify(prompt)

  assert.equal(response.text, 'I received all three results.')
  assert.match(serializedPrompt ?? '', /"type":"json"/)
  assert.match(serializedPrompt ?? '', /"type":"error-text"/)
  assert.match(serializedPrompt ?? '', /"type":"file"/)
  assert.match(serializedPrompt ?? '', /image\/png/)
  assert.match(serializedPrompt ?? '', /"data":"c2NyZWVuc2hvdA=="/)
  assert.doesNotMatch(serializedPrompt ?? '', /"screenshot"/)
  assert.doesNotMatch(serializedPrompt ?? '', /"type":"image","data":"c2NyZWVuc2hvdA=="/)
  assert.deepEqual(results[0], { type: 'json', value: { found: true } })
  assert.deepEqual(results[1], { type: 'error-text', value: 'The action was denied.' })
  assert.deepEqual(screenshotResult.display, { screenshot: '[screenshot omitted]' })
})

test('Ask denial returns an error to the model without executing the action', async () => {
  const actions: string[] = []
  let approvals = 0
  const dependencies = createDependencies({
    calls: [modelCall([toolCall('computer_input', 'ask-denied')]), modelCall([], 'Denied.')],
    needsApproval: true,
    approved: false,
    actions,
  })
  dependencies.requestApproval = async () => {
    approvals += 1
    return { approved: false, reason: 'User denied this action.' }
  }
  const result = await runWorkspaceAgentTurnLoop({ prepared: prepared(), dependencies, usage: usageState() })
  assert.equal(approvals, 1)
  assert.deepEqual(actions, [])
  assert.equal(result.content, 'Denied.')
})

test('Ask approval executes one action and continues the model loop', async () => {
  const actions: string[] = []
  let approvals = 0
  const dependencies = createDependencies({
    calls: [modelCall([toolCall('computer_input', 'ask-approved')]), modelCall([], 'Done.')],
    needsApproval: true,
    actions,
  })
  dependencies.requestApproval = async () => {
    approvals += 1
    return { approved: true }
  }
  const result = await runWorkspaceAgentTurnLoop({ prepared: prepared(), dependencies, usage: usageState() })
  assert.equal(approvals, 1)
  assert.deepEqual(actions, ['ask-approved'])
  assert.equal(result.content, 'Done.')
})

test('Auto executes without requesting approval', async () => {
  const actions: string[] = []
  let approvals = 0
  const dependencies = createDependencies({
    calls: [modelCall([toolCall('computer_exec', 'auto-exec')]), modelCall([], 'Done.')],
    actions,
  })
  dependencies.requestApproval = async () => {
    approvals += 1
    return { approved: true }
  }
  await runWorkspaceAgentTurnLoop({ prepared: prepared(), dependencies, usage: usageState() })
  assert.equal(approvals, 0)
  assert.deepEqual(actions, ['auto-exec'])
})

test('replaying after approval uses completed model and tool step results', async () => {
  const calls = [
    modelCall([toolCall('read_tool', 'read-1')]),
    modelCall([toolCall('computer_input', 'click-1')]),
    modelCall([], 'Finished.'),
  ]
  const modelCache = new Map<number, WorkspaceAgentModelCall>()
  const toolCache = new Map<string, Awaited<ReturnType<WorkspaceAgentTurnLoopDependencies['executeTool']>>>()
  let modelExecutions = 0
  let safeActions = 0
  let approvedActions = 0
  let suspend = true
  const dependencies: WorkspaceAgentTurnLoopDependencies = {
    beginFirstModelCall: async () => undefined,
    callModel: async ({ modelStep }) => {
      const cached = modelCache.get(modelStep)
      if (cached) return cached
      modelExecutions += 1
      const result = calls[modelStep]
      modelCache.set(modelStep, result)
      return result
    },
    inspectTool: async ({ toolCall: current }) => ({
      available: true,
      needsApproval: current.toolName === 'computer_input',
    }),
    requestApproval: async () => {
      if (suspend) {
        suspend = false
        throw new Error('Workflow suspended for approval.')
      }
      return { approved: true }
    },
    executeTool: async ({ toolCall: current }) => {
      const cached = toolCache.get(current.toolCallId)
      if (cached) return cached
      if (current.toolName === 'read_tool') safeActions += 1
      else approvedActions += 1
      const result = successToolResult({ success: true })
      toolCache.set(current.toolCallId, result)
      return result
    },
    persistProgress: async () => undefined,
    finalize: async () => ({ completed: true }),
  }
  const firstUsage = usageState()
  const firstInput = { prepared: prepared(), dependencies, usage: firstUsage }
  await assert.rejects(runWorkspaceAgentTurnLoop(firstInput), /Workflow suspended/)
  const replayUsage = usageState()
  const result = await runWorkspaceAgentTurnLoop({
    prepared: prepared(),
    dependencies,
    usage: replayUsage,
  })

  assert.equal(result.content, 'Finished.')
  assert.equal(modelExecutions, 3)
  assert.equal(safeActions, 1)
  assert.equal(approvedActions, 1)
  assert.equal(replayUsage.inputTokens, 39)
  assert.equal(replayUsage.outputTokens, 21)
})

test('revoked or cancelled access after approval prevents tool execution', async (t) => {
  for (const state of ['revoked', 'cancelled'] as const) {
    await t.test(state, async () => {
      let actionCount = 0
      const dependencies = createDependencies({
        calls: [modelCall([toolCall('computer_input', `${state}-1`)])],
        needsApproval: true,
      })
      let currentAuthorizationState = 'running'
      dependencies.requestApproval = async () => {
        currentAuthorizationState = state
        return { approved: true }
      }
      dependencies.executeTool = async () => {
        if (currentAuthorizationState !== 'running') {
          throw new Error(`Run ${currentAuthorizationState}.`)
        }
        actionCount += 1
        return successToolResult('done')
      }
      await assert.rejects(
        runWorkspaceAgentTurnLoop({ prepared: prepared(), dependencies, usage: usageState() }),
        new RegExp(`Run ${state}`),
      )
      assert.equal(actionCount, 0)
    })
  }
})

test('known usage is settled after a later tool failure without releasing its reservation', async () => {
  const usage = usageState()
  const dependencies = createDependencies({
    calls: [modelCall([toolCall('computer_exec', 'usage-then-failure')], '', { inputTokens: 31, outputTokens: 12 })],
  })
  dependencies.executeTool = async () => {
    throw new Error('The later action failed.')
  }
  await assert.rejects(
    runWorkspaceAgentTurnLoop({ prepared: prepared(), dependencies, usage }),
    /later action failed/,
  )
  usage.providerCallStarted = true
  const calls: string[] = []
  const policy = {
    recordFinishedUsage: async (input: { inputTokens: number; outputTokens: number }) => {
      calls.push(`settle:${input.inputTokens}:${input.outputTokens}`)
      return { finalized: true, reservationId: null }
    },
    releaseReservation: async () => {
      calls.push('release')
    },
    markReservationForReconcile: async () => {
      calls.push('reconcile')
    },
  }
  await settleWorkspaceAgentUsageWithPolicy(
    policy as unknown as Parameters<typeof settleWorkspaceAgentUsageWithPolicy>[0],
    {
      actorUserId: 'user-a',
      prepared: { ...prepared(), reservationId: 'reservation-a', paid: true },
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      usageKnown: usage.usageKnown,
      providerCallStarted: usage.providerCallStarted,
      providerOutcomeAmbiguous: usage.providerOutcomeAmbiguous,
    },
  )

  assert.deepEqual(calls, ['settle:31:12'])
  assert.equal(usage.inputTokens, 31)
  assert.equal(usage.outputTokens, 12)
})

test('thrown usage settlement reconciles known totals and surfaces reconciliation failures', async () => {
  const messages: string[] = []
  const policy = {
    recordFinishedUsage: async () => { throw new Error('billing write failed') },
    releaseReservation: async () => { throw new Error('must not release') },
    markReservationForReconcile: async ({ errorMessage }: { errorMessage: string }) => { messages.push(errorMessage) },
  }
  const input = {
    actorUserId: 'user-a',
    prepared: { ...prepared(), reservationId: 'reservation-a', paid: true },
    inputTokens: 31,
    outputTokens: 12,
    usageKnown: true,
    providerCallStarted: true,
    providerOutcomeAmbiguous: false,
  }
  const result = await settleWorkspaceAgentUsageWithPolicy(
    policy as unknown as Parameters<typeof settleWorkspaceAgentUsageWithPolicy>[0],
    input,
  )
  assert.deepEqual(result, { settled: false, reconciled: true })
  assert.match(messages[0] ?? '', /input_tokens=31;output_tokens=12/)

  await assert.rejects(settleWorkspaceAgentUsageWithPolicy(
    {
      ...policy,
      markReservationForReconcile: async () => { throw new Error('reconcile write failed') },
    } as unknown as Parameters<typeof settleWorkspaceAgentUsageWithPolicy>[0],
    input,
  ), /reconcile write failed/)
})

test('an ambiguous tool retry is returned to the model without a duplicate side effect', async () => {
  let actionCount = 0
  const dependencies = createDependencies({
    calls: [modelCall([toolCall('computer_exec', 'ambiguous-1')]), modelCall([], 'The result is uncertain.')],
  })
  dependencies.executeTool = async () => {
    const retry = refusedAmbiguousWorkspaceAgentToolRetry(2)
    if (retry) return retry
    actionCount += 1
    return successToolResult({ complete: true })
  }
  const result = await runWorkspaceAgentTurnLoop({
    prepared: prepared(),
    dependencies,
    usage: usageState(),
  })
  assert.equal(actionCount, 0)
  assert.equal(result.steps[0]?.toolResults[0]?.type, 'tool-error')
  assert.equal(result.content, 'The result is uncertain.')
})

test('only screen captures may replay an ambiguous native tool step', () => {
  assert.equal(refusedAmbiguousWorkspaceAgentToolRetry(1, 'computer_exec'), null)
  for (const attempt of [2, 3]) {
    assert.equal(refusedAmbiguousWorkspaceAgentToolRetry(attempt, 'computer_screenshot'), null)
    for (const toolName of [
      undefined, 'computer_exec', 'computer_terminal', 'computer_browser', 'computer_input',
      'computer_open_url', 'computer_write_file', 'call_mcp_tool', 'executor', 'future_tool',
    ]) {
      assert.match(refusedAmbiguousWorkspaceAgentToolRetry(attempt, toolName)?.error ?? '', /not retried/)
    }
  }
})

test('a retried screen capture reaches the model as a fresh image result', async () => {
  let captures = 0
  let receivedImage: unknown
  const screenshot = workspaceAgentToolResultFromOutput({
    output: { type: 'content', value: [{ type: 'image-data', data: 'c2NyZWVuc2hvdA==', mediaType: 'image/png' }] },
    display: { success: true, width: 1280, height: 720 },
    outputIsMapped: true,
  })
  const dependencies = createDependencies({
    calls: [modelCall([{ toolName: 'computer_screenshot', toolCallId: 'capture-retry', input: {} }])],
  })
  const callModel = dependencies.callModel
  dependencies.callModel = async (args) => {
    if (args.modelStep === 0) return callModel(args)
    receivedImage = args.messages.at(-1)?.content
    return modelCall([], 'I received the fresh capture.')
  }
  dependencies.executeTool = async ({ toolCall: current }) => {
    const refusal = refusedAmbiguousWorkspaceAgentToolRetry(2, current.toolName)
    if (refusal) return refusal
    captures += 1
    return screenshot
  }
  const result = await runWorkspaceAgentTurnLoop({ prepared: prepared(), dependencies, usage: usageState() })
  assert.equal(captures, 1)
  assert.equal(result.steps[0]?.toolResults[0]?.type, 'tool-result')
  assert.deepEqual(receivedImage, [{ type: 'tool-result', toolCallId: 'capture-retry', toolName: 'computer_screenshot', output: screenshot.output }])
})
