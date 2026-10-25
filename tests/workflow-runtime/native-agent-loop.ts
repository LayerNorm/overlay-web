import { requestWorkspaceAgentApproval, type WorkspaceAgentApprovalInput } from '../../src/server/workflows/workspace-agent-approval'
import {
  runWorkspaceAgentTurnLoop,
  type WorkspaceAgentTurnLoopDependencies,
} from '../../src/server/agents/workspace-agent-turn-loop'

type Prepared = Parameters<typeof runWorkspaceAgentTurnLoop>[0]['prepared']
type Dependencies = WorkspaceAgentTurnLoopDependencies

async function audit(prepared: Prepared, event: string) {
  const { appendFile } = await import('node:fs/promises')
  await appendFile(prepared.contextBlock, `${event}\n`)
}

export async function begin(prepared: Prepared) {
  'use step'
  await audit(prepared, 'begin')
}

export async function model(args: Parameters<Dependencies['callModel']>[0]): ReturnType<Dependencies['callModel']> {
  'use step'
  await audit(args.prepared, `model:${args.modelStep}`)
  const toolCalls = args.modelStep === 0
    ? ['read', 'write'].map(id => ({ toolCallId: id, toolName: id, input: {} }))
    : []
  return {
    text: toolCalls.length ? '' : 'Done',
    toolCalls,
    responseMessages: [],
    usage: { inputTokens: 1, outputTokens: 1 },
    finishReason: toolCalls.length ? 'tool-calls' : 'stop',
    parts: [],
    transcriptParts: args.baseParts,
  }
}

export async function inspect(args: Parameters<Dependencies['inspectTool']>[0]) {
  'use step'
  await audit(args.prepared, `inspect:${args.toolCall.toolCallId}`)
  return { available: true, needsApproval: args.prepared.instructions === 'ask' && args.toolCall.toolCallId === 'write' }
}

export async function execute(args: Parameters<Dependencies['executeTool']>[0]): ReturnType<Dependencies['executeTool']> {
  'use step'
  await audit(args.prepared, `execute:${args.toolCall.toolCallId}`)
  return { output: { type: 'text', value: 'ok' }, display: 'ok' }
}

export async function persist(args: Parameters<Dependencies['persistProgress']>[0]) {
  'use step'
  await audit(args.prepared, `persist:${args.parts.length}`)
}

export async function finalize(args: Parameters<Dependencies['finalize']>[0]) {
  'use step'
  await audit(args.prepared, 'finalize')
  return { completed: true }
}

export async function publishApproval(prepared: Prepared, input: WorkspaceAgentApprovalInput) {
  'use step'
  await audit(prepared, 'approval:published')
  return {
    status: 'waiting_for_approval' as const,
    approval: { token: input.token, requestedAt: Date.now(), requests: input.requests },
  }
}

export async function resumeApproval(prepared: Prepared) {
  'use step'
  await audit(prepared, 'approval:resumed')
  return { status: 'running' as const }
}

export async function nativeAgentLoopFixture(input: { id: string; auditPath: string; mode: 'ask' | 'auto' }) {
  'use workflow'
  const prepared = {
    runId: input.id,
    contextBlock: input.auditPath,
    instructions: input.mode,
    messages: [{ role: 'user', content: 'Read, then write.' }],
    maxSteps: 3,
  } as Prepared
  const usage = {
    inputTokens: 0, outputTokens: 0, usageKnown: true,
    providerCallStarted: false, providerOutcomeAmbiguous: false,
  }
  const result = await runWorkspaceAgentTurnLoop({
    prepared,
    usage,
    dependencies: {
      beginFirstModelCall: async () => await begin(prepared),
      callModel: model,
      inspectTool: inspect,
      executeTool: execute,
      persistProgress: persist,
      finalize,
      requestApproval: async ({ toolCall }) => await requestWorkspaceAgentApproval({
        actorUserId: 'fixture-actor',
        runId: input.id,
        token: `native-loop:${input.id}`,
        requests: [{
          approvalId: `${input.id}:${toolCall.toolCallId}`,
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          input: toolCall.input,
        }],
      }, {
        publish: async args => await publishApproval(prepared, args),
        resume: async () => await resumeApproval(prepared),
      }),
    },
  })
  return { content: result.content, usage }
}
