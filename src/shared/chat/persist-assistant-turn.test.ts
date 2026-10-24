import assert from 'node:assert/strict'
import test from 'node:test'
import type { StepResult, ToolSet } from 'ai'
import { buildAssistantPersistenceFromSteps, compactAssistantPersistenceForConvex } from './persist-assistant-turn'
import { summarizeToolResultForTranscript } from '@/shared/tools/tool-result-summary'
import { MAX_PERSISTED_TOOL_ERROR_CHARS } from './tool-outcomes'

test('completion preserves ordered SDK text, reasoning and tool calls across steps', () => {
  const firstCall = { type: 'tool-call', toolCallId: 'list', toolName: 'list_notes', input: {} }
  const secondCall = { type: 'tool-call', toolCallId: 'read', toolName: 'read_note', input: { id: 'note-1' } }
  const steps = [
    {
      text: 'Checking now. Found a note.',
      reasoningText: 'Inspect the workspace.',
      toolCalls: [firstCall, secondCall],
      toolResults: [{ toolCallId: 'list', output: { ids: ['note-1'] } }],
      content: [
        { type: 'reasoning', text: 'Inspect the workspace.' },
        { type: 'text', text: 'Checking now.' },
        firstCall,
        { type: 'text', text: 'Found a note.' },
        secondCall,
      ],
    },
    {
      text: 'Check complete.',
      toolCalls: [],
      toolResults: [{ toolCallId: 'read', output: { text: 'Synthetic note' } }],
      content: [{ type: 'text', text: 'Check complete.' }],
    },
  ] as unknown as StepResult<ToolSet>[]

  const saved = compactAssistantPersistenceForConvex(buildAssistantPersistenceFromSteps(steps, 'fallback'))
  assert.deepEqual(saved.parts.map((part) => part.type), [
    'reasoning', 'text', 'tool-invocation', 'text', 'tool-invocation', 'text',
  ])
  assert.deepEqual(saved.parts.filter((part) => part.type === 'text').map((part) => part.text), [
    'Checking now.', 'Found a note.', 'Check complete.',
  ])
  assert.equal(saved.content, 'Checking now. Found a note.\n\nCheck complete.')
  assert.deepEqual(saved.parts[4]?.toolInvocation, {
    toolCallId: 'read', toolName: 'read_note', state: 'output-available',
    toolInput: { id: 'note-1' }, toolOutput: { text: 'Synthetic note' },
  })
})

test('legacy steps without ordered content retain their transcript and fallback text', () => {
  const steps = [{
    text: 'Done.',
    reasoningText: 'Check notes.',
    toolCalls: [{ toolCallId: 'list', toolName: 'list_notes', input: {} }],
    toolResults: [{ toolCallId: 'list', output: [] }],
  }] as unknown as StepResult<ToolSet>[]
  const saved = buildAssistantPersistenceFromSteps(steps, 'fallback')
  assert.deepEqual(saved.parts.map((part) => part.type), ['reasoning', 'tool-invocation', 'text'])
  assert.deepEqual(buildAssistantPersistenceFromSteps(undefined, 'Partial response'), {
    content: 'Partial response', parts: [{ type: 'text', text: 'Partial response' }],
  })
})

test('invalid names, malformed arguments, and thrown calls persist terminal errors', () => {
  const saved = buildAssistantPersistenceFromSteps([
    {
      text: '',
      toolCalls: [{
        toolCallId: 'bad-name',
        toolName: 'computer_bash',
        input: { command: 'pwd' },
        invalid: true,
        error: new Error('No such tool: computer_bash'),
      }, {
        toolCallId: 'bad-input',
        toolName: 'computer_exec',
        input: {},
        invalid: true,
        error: new Error('Input validation failed: command is required'),
      }],
      toolResults: [],
      content: [{
        type: 'tool-call',
        toolCallId: 'bad-name',
        toolName: 'computer_bash',
        input: { command: 'pwd' },
        invalid: true,
        error: new Error('No such tool: computer_bash'),
      }, {
        type: 'tool-call',
        toolCallId: 'bad-input',
        toolName: 'computer_exec',
        input: {},
        invalid: true,
        error: new Error('Input validation failed: command is required'),
      }],
    },
    {
      text: '',
      toolCalls: [{
        toolCallId: 'thrown',
        toolName: 'computer_exec',
        input: { command: 'pwd' },
      }],
      toolResults: [],
      content: [{
        type: 'tool-call',
        toolCallId: 'thrown',
        toolName: 'computer_exec',
        input: { command: 'pwd' },
      }, {
        type: 'tool-error',
        toolCallId: 'thrown',
        toolName: 'computer_exec',
        input: { command: 'pwd' },
        error: new Error('computer unavailable'),
      }],
    },
  ] as unknown as StepResult<ToolSet>[], '')
  const invocations = saved.parts
    .filter((part) => part.type === 'tool-invocation')
    .map((part) => part.toolInvocation as Record<string, unknown>)

  assert.deepEqual(invocations.map((invocation) => invocation.state), ['output-error', 'output-error', 'output-error'])
  assert.match(String((invocations[0]!.toolOutput as Record<string, unknown>).error), /No such tool/)
  assert.match(String((invocations[1]!.toolOutput as Record<string, unknown>).error), /Input validation failed/)
  assert.match(String((invocations[2]!.toolOutput as Record<string, unknown>).error), /computer unavailable/)
  assert.match(saved.content, /No such tool|Input validation failed|computer unavailable/)
})

test('falsey tool outputs remain successful terminal results', () => {
  const saved = buildAssistantPersistenceFromSteps([
    {
      text: '',
      toolCalls: [{ toolCallId: 'null', toolName: 'probe', input: {} }],
      toolResults: [{ toolCallId: 'null', toolName: 'probe', input: {}, output: null }],
      content: [{ type: 'tool-call', toolCallId: 'null', toolName: 'probe', input: {} }],
    },
    {
      text: '',
      toolCalls: [{ toolCallId: 'false', toolName: 'probe', input: {} }],
      toolResults: [{ toolCallId: 'false', toolName: 'probe', input: {}, output: false }],
      content: [{ type: 'tool-call', toolCallId: 'false', toolName: 'probe', input: {} }],
    },
  ] as unknown as StepResult<ToolSet>[], '')
  const invocations = saved.parts
    .filter((part) => part.type === 'tool-invocation')
    .map((part) => part.toolInvocation as Record<string, unknown>)

  assert.deepEqual(invocations.map((invocation) => invocation.state), ['output-available', 'output-available'])
  assert.equal((invocations[0] as Record<string, unknown>).toolOutput, null)
  assert.equal((invocations[1] as Record<string, unknown>).toolOutput, false)
})

test('null error metadata stays successful and structured failures retain their fields', () => {
  const saved = buildAssistantPersistenceFromSteps([
    {
      text: '',
      toolCalls: [
        { toolCallId: 'success', toolName: 'computer_exec', input: { command: 'printf ok' } },
        { toolCallId: 'failure', toolName: 'computer_exec', input: { command: 'false' } },
      ],
      toolResults: [
        {
          toolCallId: 'success',
          output: {
            success: true,
            error: null,
            stdout: 'ok',
            stderr: '',
            exitCode: 0,
          },
        },
        {
          toolCallId: 'failure',
          output: {
            success: false,
            error: null,
            exitCode: 1,
            stdout: '',
            stderr: 'command failed',
            details: { signal: null },
          },
        },
      ],
      content: [
        { type: 'tool-call', toolCallId: 'success', toolName: 'computer_exec', input: { command: 'printf ok' } },
        { type: 'tool-call', toolCallId: 'failure', toolName: 'computer_exec', input: { command: 'false' } },
      ],
    },
  ] as unknown as StepResult<ToolSet>[], '')
  const invocations = saved.parts
    .filter((part) => part.type === 'tool-invocation')
    .map((part) => part.toolInvocation as Record<string, unknown>)

  assert.equal(invocations[0]?.state, 'output-available')
  assert.deepEqual(invocations[0]?.toolOutput, {
    success: true,
    error: null,
    stdout: 'ok',
    stderr: '',
    exitCode: 0,
  })
  assert.equal(invocations[1]?.state, 'output-error')
  assert.deepEqual(invocations[1]?.toolOutput, {
    success: false,
    error: 'The tool returned success:false.',
    exitCode: 1,
    stdout: '',
    stderr: 'command failed',
    details: { signal: null },
  })
})

test('failure summaries win over success-specific web prose', () => {
  assert.equal(
    summarizeToolResultForTranscript({
      toolName: 'web_search',
      toolInput: { query: 'Overlay' },
      toolOutput: { success: false, error: 'search backend unavailable' },
      state: 'output-available',
    }),
    'search backend unavailable',
  )
})

test('pending web requests do not claim search completion and denied calls stay denied', () => {
  assert.equal(
    summarizeToolResultForTranscript({
      toolName: 'web_search',
      toolInput: { query: 'Overlay' },
      toolOutput: { provider: 'search-provider' },
      state: 'pending',
    }),
    null,
  )
  assert.equal(
    summarizeToolResultForTranscript({
      toolName: 'web_search',
      toolInput: { query: 'Overlay' },
      state: 'input-available',
    }),
    null,
  )
  assert.equal(
    summarizeToolResultForTranscript({
      toolName: 'web_search',
      toolInput: { query: 'Overlay' },
      state: 'output-denied',
    }),
    'The web_search tool was denied.',
  )
})

test('unfinished local calls fail while provider calls and pending approvals keep their identity', () => {
  const saved = buildAssistantPersistenceFromSteps([{
    text: '',
    toolCalls: [
      { toolCallId: 'missing', toolName: 'computer_exec', input: {} },
      { toolCallId: 'provider', toolName: 'provider_tool', input: {}, providerExecuted: true },
    ],
    toolResults: [],
    content: [
      { type: 'tool-call', toolCallId: 'missing', toolName: 'computer_exec', input: {} },
      { type: 'tool-call', toolCallId: 'provider', toolName: 'provider_tool', input: {}, providerExecuted: true },
      {
        type: 'tool-approval-request',
        approvalId: 'approval-1',
        toolCall: { toolCallId: 'approval-call', toolName: 'send_message', input: { text: 'hello' } },
      },
    ],
  }] as unknown as StepResult<ToolSet>[], '')
  const invocations = saved.parts
    .filter((part) => part.type === 'tool-invocation')
    .map((part) => part.toolInvocation as Record<string, unknown>)

  assert.equal(invocations[0]?.state, 'output-error')
  assert.match(String((invocations[0]?.toolOutput as Record<string, unknown>).error), /without an execution result/)
  assert.equal(invocations[1]?.state, 'input-available')
  assert.equal(invocations[1]?.providerExecuted, true)
  assert.equal(invocations[2]?.state, 'input-available')
  assert.equal(invocations[2]?.approvalId, 'approval-1')
  assert.equal(invocations[2]?.approvalStatus, 'requested')
})

test('persisted tool error text stays within its size bound', () => {
  const saved = buildAssistantPersistenceFromSteps([{
    text: '',
    toolCalls: [{ toolCallId: 'long-error', toolName: 'computer_exec', input: {} }],
    toolResults: [],
    content: [{
      type: 'tool-call',
      toolCallId: 'long-error',
      toolName: 'computer_exec',
      input: {},
    }, {
      type: 'tool-error',
      toolCallId: 'long-error',
      toolName: 'computer_exec',
      input: {},
      error: 'x'.repeat(MAX_PERSISTED_TOOL_ERROR_CHARS + 100),
    }],
  }] as unknown as StepResult<ToolSet>[], '')
  const invocation = saved.parts.find((part) => part.type === 'tool-invocation')!
    .toolInvocation as Record<string, unknown>
  const output = invocation.toolOutput as Record<string, unknown>

  assert.equal(invocation.state, 'output-error')
  assert.equal(String(output.error).length <= MAX_PERSISTED_TOOL_ERROR_CHARS, true)
})
