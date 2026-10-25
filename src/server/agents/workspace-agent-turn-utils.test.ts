import assert from 'node:assert/strict'
import test from 'node:test'
import { generateText, jsonSchema, tool, type StepResult, type ToolSet } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { buildAssistantPersistenceFromSteps, compactAssistantPersistenceForConvex } from '@/shared/chat/persist-assistant-turn'
import { workspaceAgentToolCallParts } from './workspace-agent-turn-utils'

test('a native streamed tool call retains its real result when the turn finalizes', async () => {
  const input = { command: 'printf PR316_RECORDED_TOOL' }
  const output = { success: true, stdout: 'PR316_RECORDED_TOOL', exitCode: 0 }
  const result = await generateText({
    model: new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: 'tool-call', toolCallId: 'exec-1', toolName: 'computer_exec', input: JSON.stringify(input) }],
        finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
        usage: {
          inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 6, text: 6, reasoning: 0 },
        },
        warnings: [],
      },
    }),
    prompt: 'Run the harmless QA command.',
    tools: {
      computer_exec: tool({
        inputSchema: jsonSchema({ type: 'object', properties: { command: { type: 'string' } }, required: ['command'] }),
        execute: async () => output,
      }),
    },
  })
  const call = result.toolCalls[0]
  assert.ok(call)
  const { modelPart, transcriptPart } = workspaceAgentToolCallParts(call)
  const generatedStep = result.steps[0]
  assert.ok(generatedStep)
  const step: StepResult<ToolSet> = {
    ...generatedStep,
    content: [modelPart],
    text: generatedStep.text,
    toolCalls: generatedStep.toolCalls,
    toolResults: generatedStep.toolResults,
  }
  const saved = compactAssistantPersistenceForConvex(buildAssistantPersistenceFromSteps([step], 'Command completed.'))
  assert.deepEqual(saved.parts.filter(part => part.type === 'tool-invocation').map(part => part.toolInvocation), [{
    toolCallId: 'exec-1', toolName: 'computer_exec', state: 'output-available', toolInput: input, toolOutput: output,
  }])
  assert.equal(transcriptPart.type, 'tool-invocation')
  assert.equal(transcriptPart.toolInvocation.state, 'input-available')
})
