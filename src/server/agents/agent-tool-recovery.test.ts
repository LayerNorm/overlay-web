import assert from 'node:assert/strict'
import test from 'node:test'
import { stepCountIs, streamText, tool } from 'ai'
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test'
import { z } from 'zod'
import { buildAssistantPersistenceFromSteps } from '@/shared/chat/persist-assistant-turn'
import { prepareAgentToolRecoveryStep } from './agent-tool-recovery'

const usage = {
  inputTokens: 1,
  outputTokens: 1,
  totalTokens: 2,
}
const toolFinishReason = { unified: 'tool-calls', raw: 'tool-calls' } as const
const stopFinishReason = { unified: 'stop', raw: 'stop' } as const

function response(chunks: unknown) {
  return {
    stream: simulateReadableStream({ chunks }),
  } as never
}

test('invalid tool calls recover to an exposed tool without executing the invalid name', async () => {
  let executionCount = 0
  const model = new MockLanguageModelV4({
    doStream: [
      response([
        { type: 'stream-start', warnings: [] },
        {
          type: 'tool-call',
          toolCallId: 'invalid-call',
          toolName: 'computer_bash',
          input: '{"command":"printf 4"}',
        },
        { type: 'finish', finishReason: toolFinishReason, usage },
      ]),
      response([
        { type: 'stream-start', warnings: [] },
        {
          type: 'tool-call',
          toolCallId: 'valid-call',
          toolName: 'computer_exec',
          input: '{"command":"printf 4"}',
        },
        { type: 'finish', finishReason: toolFinishReason, usage },
      ]),
      response([
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 'text-1' },
        { type: 'text-delta', id: 'text-1', delta: 'stdout 4' },
        { type: 'text-end', id: 'text-1' },
        { type: 'finish', finishReason: stopFinishReason, usage },
      ]),
    ],
  })
  const systemPrompt = 'Use only the exact available tool names.'
  const result = streamText({
    model,
    system: systemPrompt,
    prompt: 'Run the command.',
    tools: {
      computer_exec: tool({
        inputSchema: z.object({ command: z.string() }),
        execute: async ({ command }) => {
          executionCount += 1
          return { stdout: command.replace('printf ', '') }
        },
      }),
    },
    prepareStep: ({ steps }) => prepareAgentToolRecoveryStep(
      steps,
      ['computer_exec'],
      systemPrompt,
    ),
    stopWhen: stepCountIs(3),
  })

  const text = await result.text
  const steps = await result.steps
  const persistence = buildAssistantPersistenceFromSteps(steps, text)
  const recoveryPrompt = model.doStreamCalls[1]?.prompt ?? []
  const recoverySystem = JSON.stringify(recoveryPrompt.find(
    part => part.role === 'system',
  ))

  assert.equal(text, 'stdout 4')
  assert.equal(executionCount, 1)
  assert.equal(steps[0]?.toolCalls[0]?.toolName, 'computer_bash')
  assert.equal(steps[0]?.toolCalls[0]?.invalid, true)
  assert.match(recoverySystem, /computer_exec/)
  assert.doesNotMatch(recoverySystem, /computer_bash/)
  assert.doesNotMatch(recoverySystem, /search_memory|search_messages/)
  assert.equal(steps[1]?.toolResults[0]?.output.stdout, '4')
  const invocations = persistence.parts
    .filter((part) => part.type === 'tool-invocation')
    .map((part) => part.toolInvocation as Record<string, unknown>)
  assert.deepEqual(invocations.map((invocation) => invocation.state), ['output-error', 'output-available'])
  assert.match(String((invocations[0]!.toolOutput as Record<string, unknown>).error), /computer_bash|unavailable/)
  assert.deepEqual(invocations[1]!.toolOutput, { stdout: '4' })
})
