/**
 * Personal Chat Work — durable in-workflow execution of a chat Work-mode turn.
 *
 * The loop is intentionally manual rather than `WorkflowAgent`: the SDK's
 * internal model step resolves `gateway.languageModel(<id>)`, which locks
 * durable turns to AI Gateway models. Our own `'use step'` rebuilds the model
 * via `getLanguageModel` inside the step — the same resolution the ephemeral
 * act path uses — so BYOK, OpenRouter, and NVIDIA NIM models all work, and
 * user credentials are fetched at call time instead of sitting in the
 * workflow event log.
 *
 * Each iteration is a durable `streamText` step that forwards live
 * `ModelCallStreamPart`s to the run's writable (the client reads the same
 * stream shape `WorkflowAgent` produced), followed by one durable step per
 * tool call. Approval-gated calls suspend the workflow on a `createHook`
 * until the user resolves them — the approval card itself renders from the
 * agent-run record, not the stream. A process restart resumes at the failing
 * step instead of losing the whole turn.
 */

import { jsonSchema, streamText, tool, type ModelMessage, type StepResult, type ToolSet } from 'ai'
import type { ModelCallStreamPart } from '@ai-sdk/workflow'
import { createHook, FatalError, getWorkflowMetadata, getWritable } from 'workflow'
import type {
  PersonalChatWorkToolDefinition,
  PersonalChatWorkToolingContext,
} from '@/shared/agents/personal-chat-work'
import type { SourceCitationMap } from '@/shared/knowledge/ask-knowledge-types'
import { getLanguageModel } from '@/server/ai/model-runtime'
import {
  executePersonalChatWorkTool,
  personalChatWorkToolNeedsApproval,
} from '@/server/conversations/personal-chat-work-tools'
import {
  attachPersonalChatWorkRun,
  failPersonalChatWork,
  finalizePersonalChatWork,
  markPersonalChatWorkResumed,
  markPersonalChatWorkWaiting,
  persistPersonalChatWorkProgress,
} from '@/server/conversations/personal-chat-work-lifecycle'

export type PersonalChatWorkWorkflowInput = {
  agentRunId: string
  billingUserId: string
  conversationId: string
  emitWebhook: boolean
  instructions: string
  messages: ModelMessage[]
  modelId: string
  multiModelSlotIndex?: number
  multiModelTotal?: number
  paid: boolean
  providerOptions?: Record<string, Record<string, unknown>>
  reasoning?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  reservationId: string | null
  resourceUserId: string
  sourceCitations?: SourceCitationMap
  toolDefinitions: PersonalChatWorkToolDefinition[]
  toolingContext: PersonalChatWorkToolingContext
  turnId: string
}

/**
 * Serializable result of one durable model call. A `LanguageModel` cannot
 * cross the step boundary (methods + captured credentials do not serialize),
 * so the step rebuilds it via `getLanguageModel` and returns only data.
 */
type WorkModelCallResult = {
  finishReason: string
  reasoning?: unknown[]
  reasoningText?: string
  responseMessages: ModelMessage[]
  routedModelId?: string
  text: string
  toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>
  usage: { inputTokens?: number; outputTokens?: number }
}

// Raw model-stream part types that map to UI chunks the client understands.
// Envelope parts (start/finish/step boundaries) are emitted by the workflow's
// own writers — not forwarded from the model stream — and everything else
// (`model-call-end`, `tool-input-error`, `raw`…) has no `toUIMessageChunk`
// mapping and would throw in the transform.
const FORWARDED_STREAM_PART_TYPES = new Set([
  'custom',
  'file',
  'reasoning-delta',
  'reasoning-end',
  'reasoning-file',
  'reasoning-start',
  'source',
  'text-delta',
  'text-end',
  'text-start',
  'tool-call',
  'tool-error',
  'tool-input-delta',
  'tool-input-start',
  'tool-result',
])

const MAX_WORK_MODEL_STEPS = 64
const MAX_WORK_APPROVAL_CYCLES = 20
const WORK_TOOL_APPROVAL_DENIAL = 'Denied by user.'

export function aggregatePersonalChatWorkUsage(steps: StepResult<ToolSet>[]) {
  return steps.reduce((usage, step) => ({
    inputTokens: usage.inputTokens + (step.usage?.inputTokens ?? 0),
    outputTokens: usage.outputTokens + (step.usage?.outputTokens ?? 0),
  }), { inputTokens: 0, outputTokens: 0 })
}

export function buildPersonalChatWorkApprovalToken(agentRunId: string, approvalCycle: number) {
  return `agent-run:${agentRunId}:approval:${approvalCycle}`
}

/**
 * One model call of the durable Work loop, executed inside a `'use step'`.
 *
 * The model is rebuilt here via `getLanguageModel` — resolving BYOK vault
 * credentials, OpenRouter, and NVIDIA NIM at call time — then `streamText`
 * runs a single generation while every forwardable stream part is written to
 * the workflow's default stream so the client sees live text the same way it
 * did under `WorkflowAgent`. Tools carry no `execute`; the model emits
 * `toolCalls` only and each call runs as its own durable step.
 */
async function callWorkModelStep(args: {
  instructions: string
  maxOutputTokens: number
  messages: ModelMessage[]
  modelId: string
  providerOptions?: Record<string, Record<string, unknown>>
  reasoning?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  toolDefinitions: PersonalChatWorkToolDefinition[]
  userId: string
}): Promise<WorkModelCallResult> {
  'use step'

  const model = await getLanguageModel(args.modelId, undefined, args.userId)
  const tools = Object.fromEntries(args.toolDefinitions.map((definition) => [
    definition.name,
    tool({
      description: definition.description,
      inputSchema: jsonSchema(definition.inputSchema),
    }),
  ]))
  const writer = getWritable<ModelCallStreamPart<ToolSet>>().getWriter()
  try {
    const result = streamText({
      maxOutputTokens: args.maxOutputTokens,
      // The workflow step itself retries on throw — in-step SDK retries would
      // multiply attempts on transient provider errors.
      maxRetries: 0,
      messages: args.messages,
      model,
      ...(args.providerOptions ? { providerOptions: args.providerOptions as never } : {}),
      ...(args.reasoning ? { reasoning: args.reasoning } : {}),
      system: args.instructions,
      tools,
    })
    for await (const part of result.fullStream) {
      if (!FORWARDED_STREAM_PART_TYPES.has(part.type)) continue
      await writer.write(part as ModelCallStreamPart<ToolSet>)
    }
    const [finishReason, reasoning, reasoningText, response, text, toolCalls, usage] = await Promise.all([
      result.finishReason,
      result.reasoning,
      result.reasoningText,
      result.response,
      result.text,
      result.toolCalls,
      result.usage,
    ])
    return {
      finishReason,
      reasoning: reasoning as unknown[] | undefined,
      reasoningText,
      responseMessages: response.messages,
      routedModelId: response.modelId ?? undefined,
      text,
      toolCalls: toolCalls.map((call) => ({
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input: call.input,
      })),
      usage: {
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
      },
    }
  } finally {
    writer.releaseLock()
  }
}

/**
 * Writes arbitrary stream parts (tool results, errors, denials, step
 * boundaries) to the run's live output — the same helper role the SDK's
 * `writeToolResults`/`writeApprovalToolResults` steps played.
 */
async function writeWorkStreamParts(parts: Array<Record<string, unknown>>) {
  'use step'
  if (parts.length === 0) return
  const writer = getWritable<ModelCallStreamPart<ToolSet>>().getWriter()
  try {
    for (const part of parts) {
      await writer.write(part as ModelCallStreamPart<ToolSet>)
    }
  } finally {
    writer.releaseLock()
  }
}

async function closeWorkStream() {
  'use step'
  const writable = getWritable<ModelCallStreamPart<ToolSet>>()
  await writable.close()
}

async function failWorkStream(error: unknown) {
  'use step'
  const writable = getWritable<ModelCallStreamPart<ToolSet>>()
  const writer = writable.getWriter()
  try {
    const message = error instanceof Error ? error.message : 'Unknown workflow failure'
    await writer.write({ type: 'error', error: new Error(message) } as unknown as ModelCallStreamPart<ToolSet>)
  } finally {
    await writer.close()
  }
}

type WorkToolOutcome = {
  output: Record<string, unknown>
  transcript: Record<string, unknown>
}

function workToolErrorOutcome(toolCall: { toolCallId: string; toolName: string; input: unknown }, reason: string): WorkToolOutcome {
  return {
    output: { type: 'error-text', value: reason },
    transcript: {
      type: 'tool-error',
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      input: toolCall.input,
      error: reason,
      output: { error: reason },
    },
  }
}

export async function personalChatWorkWorkflow(input: PersonalChatWorkWorkflowInput) {
  'use workflow'

  const { workflowRunId } = getWorkflowMetadata()
  await attachPersonalChatWorkRun({
    agentRunId: input.agentRunId,
    resourceUserId: input.resourceUserId,
    workflowRunId,
  })

  const allSteps: StepResult<ToolSet>[] = []
  // Text already published to the assistant row. Kept out here so it spans
  // approval cycles: resuming after an approval must extend the reply the
  // reader can already see, not restart it.
  let publishedText = ''
  const publishProgress = async () => {
    const content = allSteps
      .map((step) => step.text ?? '')
      .filter(Boolean)
      .join('')
    if (!content || content === publishedText) return
    publishedText = content
    await persistPersonalChatWorkProgress({
      agentRunId: input.agentRunId,
      content,
      resourceUserId: input.resourceUserId,
    })
  }

  try {
    let messages = input.messages
    let approvalCycle = 0
    // `WorkflowAgent` ran up to 64 model steps per stream invocation and the
    // approval loop re-invoked it each cycle — the budget resets after every
    // resolved approval to preserve that bound.
    let stepsSinceApproval = 0
    while (true) {
      if (stepsSinceApproval >= MAX_WORK_MODEL_STEPS) {
        throw new FatalError(`Work mode exceeded ${MAX_WORK_MODEL_STEPS} model steps without finishing.`)
      }
      stepsSinceApproval += 1
      const call = await callWorkModelStep({
        instructions: input.instructions,
        maxOutputTokens: 32_768,
        messages,
        modelId: input.modelId,
        providerOptions: input.providerOptions,
        reasoning: input.reasoning,
        toolDefinitions: input.toolDefinitions,
        userId: input.billingUserId,
      })

      const stepContent: Array<Record<string, unknown>> = [
        ...(call.text ? [{ type: 'text', text: call.text }] : []),
      ]
      const stepToolResults: Array<Record<string, unknown>> = []
      const toolResultContent: Array<Record<string, unknown>> = []

      if (call.toolCalls.length > 0) {
        // Non-gated calls execute immediately — each its own durable step.
        // Gated calls are collected and resolved by one approval hook so a
        // batch of requests still lands as a single prompt, matching the
        // WorkflowAgent behavior this replaces.
        type PendingApproval = {
          context: PersonalChatWorkToolingContext & { agentRunId: string; toolName: string }
          toolCall: { toolCallId: string; toolName: string; input: unknown }
        }
        const outcomes = new Map<string, WorkToolOutcome>()
        const pending: PendingApproval[] = []

        for (const toolCall of call.toolCalls) {
          stepContent.push({ type: 'tool-call', ...toolCall })
          const definition = input.toolDefinitions.find(
            (entry) => entry.name === toolCall.toolName,
          )
          const context = {
            ...input.toolingContext,
            agentRunId: input.agentRunId,
            toolName: toolCall.toolName,
          }
          if (!definition) {
            outcomes.set(
              toolCall.toolCallId,
              workToolErrorOutcome(toolCall, `Tool ${toolCall.toolName} is not available for this run.`),
            )
            continue
          }
          if (
            definition.needsApproval
            && await personalChatWorkToolNeedsApproval(toolCall.input, {
              context,
              messages,
              toolCallId: toolCall.toolCallId,
            })
          ) {
            pending.push({ context, toolCall })
            continue
          }
          try {
            const output = await executePersonalChatWorkTool(toolCall.input, {
              context,
              messages,
              toolCallId: toolCall.toolCallId,
            })
            outcomes.set(toolCall.toolCallId, {
              output: typeof output === 'string'
                ? { type: 'text', value: output }
                : { type: 'json', value: output as never },
              transcript: {
                type: 'tool-result',
                toolCallId: toolCall.toolCallId,
                toolName: toolCall.toolName,
                input: toolCall.input,
                output,
              },
            })
            await writeWorkStreamParts([{
              type: 'tool-result',
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.toolName,
              input: toolCall.input,
              output,
            }])
          } catch (toolError) {
            // A failed tool is fed back to the model (streamText parity) —
            // it does not fail the turn.
            const reason = toolError instanceof Error ? toolError.message : 'Tool execution failed'
            outcomes.set(toolCall.toolCallId, workToolErrorOutcome(toolCall, reason))
            await writeWorkStreamParts([{
              type: 'tool-error',
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.toolName,
              error: reason,
            }])
          }
        }

        if (pending.length > 0) {
          if (approvalCycle >= MAX_WORK_APPROVAL_CYCLES) {
            throw new FatalError('Work mode exceeded the maximum number of approval cycles.')
          }
          const token = buildPersonalChatWorkApprovalToken(input.agentRunId, approvalCycle)
          approvalCycle += 1
          await markPersonalChatWorkWaiting({
            agentRunId: input.agentRunId,
            resourceUserId: input.resourceUserId,
            approval: {
              token,
              requestedAt: Date.now(),
              requests: pending.map(({ toolCall }) => ({
                approvalId: `approval-${toolCall.toolCallId}`,
                toolCallId: toolCall.toolCallId,
                toolName: toolCall.toolName,
                input: toolCall.input,
              })),
            },
          })
          const decision = await createHook<{ approved: boolean; reason?: string }>({ token })
          await markPersonalChatWorkResumed({
            agentRunId: input.agentRunId,
            resourceUserId: input.resourceUserId,
          })
          stepsSinceApproval = 0
          const resolvedParts: Array<Record<string, unknown>> = []
          for (const { context, toolCall } of pending) {
            if (!decision.approved) {
              outcomes.set(
                toolCall.toolCallId,
                workToolErrorOutcome(toolCall, decision.reason ?? WORK_TOOL_APPROVAL_DENIAL),
              )
              resolvedParts.push({
                type: 'tool-output-denied',
                toolCallId: toolCall.toolCallId,
              })
              continue
            }
            try {
              const output = await executePersonalChatWorkTool(toolCall.input, {
                context,
                messages,
                toolCallId: toolCall.toolCallId,
              })
              outcomes.set(toolCall.toolCallId, {
                output: typeof output === 'string'
                  ? { type: 'text', value: output }
                  : { type: 'json', value: output as never },
                transcript: {
                  type: 'tool-result',
                  toolCallId: toolCall.toolCallId,
                  toolName: toolCall.toolName,
                  input: toolCall.input,
                  output,
                },
              })
              resolvedParts.push({
                type: 'tool-result',
                toolCallId: toolCall.toolCallId,
                toolName: toolCall.toolName,
                input: toolCall.input,
                output,
              })
            } catch (toolError) {
              const reason = toolError instanceof Error ? toolError.message : 'Tool execution failed'
              outcomes.set(toolCall.toolCallId, workToolErrorOutcome(toolCall, reason))
              resolvedParts.push({
                type: 'tool-error',
                toolCallId: toolCall.toolCallId,
                toolName: toolCall.toolName,
                error: reason,
              })
            }
          }
          await writeWorkStreamParts(resolvedParts)
        }

        // Results are appended in call order regardless of when they resolved.
        for (const toolCall of call.toolCalls) {
          const outcome = outcomes.get(toolCall.toolCallId)
          if (!outcome) continue
          stepToolResults.push(outcome.transcript)
          stepContent.push(outcome.transcript)
          toolResultContent.push({
            type: 'tool-result',
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            output: outcome.output,
          })
        }
      }

      // A StepResult-shaped record per model call — the same shape the
      // persistence layer and metrics consume for transcripts and usage.
      allSteps.push({
        content: stepContent,
        finishReason: call.finishReason,
        reasoning: call.reasoning,
        reasoningText: call.reasoningText,
        response: {
          messages: call.responseMessages,
          modelId: call.routedModelId,
        },
        text: call.text,
        toolCalls: call.toolCalls.map((entry) => ({ type: 'tool-call', ...entry })),
        toolResults: stepToolResults,
        usage: call.usage,
      } as unknown as StepResult<ToolSet>)
      await publishProgress()

      if (call.toolCalls.length === 0) {
        await finalizePersonalChatWork({
          agentRunId: input.agentRunId,
          billingUserId: input.billingUserId,
          conversationId: input.conversationId,
          emitWebhook: input.emitWebhook,
          event: {
            steps: allSteps,
            text: call.text,
            usage: aggregatePersonalChatWorkUsage(allSteps),
          },
          modelId: input.modelId,
          multiModelSlotIndex: input.multiModelSlotIndex,
          multiModelTotal: input.multiModelTotal,
          paid: input.paid,
          reservationId: input.reservationId,
          resourceUserId: input.resourceUserId,
          sourceCitations: input.sourceCitations,
          turnId: input.turnId,
          workflowRunId,
        })
        await closeWorkStream()
        return { agentRunId: input.agentRunId, completed: true }
      }

      // Step boundary for the live stream — same marker the SDK wrote between
      // iterations so a fresh text block id from the next call doesn't collide.
      await writeWorkStreamParts([{ type: 'finish-step' }, { type: 'start-step' }])

      // response.messages holds only the messages generated this call (the
      // assistant message with tool-call parts) — history must carry forward.
      messages = [
        ...messages,
        ...call.responseMessages,
        { role: 'tool', content: toolResultContent as never },
      ]
    }
  } catch (error) {
    await failWorkStream(error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown workflow failure'
    await failPersonalChatWork({
      agentRunId: input.agentRunId,
      billingUserId: input.billingUserId,
      errorMessage,
      modelId: input.modelId,
      reservationId: input.reservationId,
      resourceUserId: input.resourceUserId,
      steps: allSteps,
      workflowRunId,
    })
    throw error
  }
}
