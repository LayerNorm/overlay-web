import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { Readable, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'
import type { AgentAdapter, AgentAdapterSession, EmitAgentEvent, StartAdapterSessionInput } from './adapter'

export type AcpAdapterOptions = {
  id: string
  displayName: string
  command: string
  args?: string[]
  env?: Record<string, string>
}

type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void }

export class AcpAgentAdapter implements AgentAdapter {
  readonly capability

  constructor(private readonly options: AcpAdapterOptions) {
    this.capability = {
      id: options.id, displayName: options.displayName, protocol: 'acp' as const,
      supports: { prompt: true, approval: true, cancel: true, resume: true },
    }
  }

  async discover() { return this.capability }

  async start(input: StartAdapterSessionInput, emit: EmitAgentEvent): Promise<AgentAdapterSession> {
    const ready = deferred<{ sessionId: string; context: acp.ClientContext }>()
    const closed = deferred<void>()
    const permissions = new Map<string, { response: Deferred<string | undefined>; options: Set<string> }>()
    const elicitations = new Map<string, { response: Deferred<acp.CreateElicitationResponse> }>()
    let child: ChildProcessWithoutNullStreams | undefined
    let activeContext: acp.ClientContext | undefined
    let sessionId = input.remoteSessionId
    let textCheckpoint = ''

    const app = acp.client({ name: 'overlay-agent-host' })
      .onRequest(acp.methods.client.session.requestPermission, async ({ params }) => {
        const requestKey = params.toolCall.toolCallId || randomUUID()
        const response = deferred<string | undefined>()
        permissions.set(requestKey, { response, options: new Set(params.options.map((option) => option.optionId)) })
        await emit({
          type: 'approval_requested',
          payload: {
            requestKey,
            prompt: params.toolCall.title ?? 'Agent permission request',
            options: params.options.map((option) => ({ id: option.optionId, label: option.name })),
            context: { toolCallId: params.toolCall.toolCallId },
          },
        })
        const optionId = await response.promise
        permissions.delete(requestKey)
        return optionId ? { outcome: { outcome: 'selected' as const, optionId } } : { outcome: { outcome: 'cancelled' as const } }
      })
      .onRequest(acp.methods.client.elicitation.create, async ({ params }) => {
        if (params.mode !== 'form') return { action: 'decline' as const }
        const requestKey = randomUUID()
        const response = deferred<acp.CreateElicitationResponse>()
        elicitations.set(requestKey, { response })
        await emit({ type: 'elicitation_requested', payload: { requestKey, prompt: params.message,
          requestedSchema: params.requestedSchema as Record<string, unknown>, context: {} } })
        const result = await response.promise
        elicitations.delete(requestKey)
        return result
      })
      .onNotification(acp.methods.client.session.update, async ({ params }) => {
        await normalizeAcpUpdate(params.update, emit, {
          appendText(chunk) {
            textCheckpoint += chunk
            return textCheckpoint
          },
        })
      })

    const background = async () => {
      child = spawn(this.options.command, this.options.args ?? [], {
        cwd: input.workingDirectory,
        env: { ...process.env, ...this.options.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      child.stderr.on('data', (chunk) => {
        if (process.env.OVERLAY_AGENT_HOST_DEBUG_ACP === '1') process.stderr.write(chunk)
      })
      child.once('error', ready.reject)
      const stream = acp.ndJsonStream(
        Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      )
      await app.connectWith(stream, async (context) => {
        activeContext = context
        const initialized = await context.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: { elicitation: { form: {} } },
        })
        if (sessionId && initialized.agentCapabilities?.loadSession !== true) {
          throw new Error(`ACP adapter ${this.options.id} does not support session resume`)
        }
        if (sessionId) {
          await context.request(acp.methods.agent.session.load, {
            sessionId, cwd: input.workingDirectory, additionalDirectories: input.additionalDirectories, mcpServers: [],
          })
        } else {
          const created = await context.request(acp.methods.agent.session.new, {
            cwd: input.workingDirectory, additionalDirectories: input.additionalDirectories, mcpServers: [],
          })
          sessionId = created.sessionId
        }
        ready.resolve({ sessionId, context })
        await closed.promise
      })
    }
    void background().catch(async (error) => {
      ready.reject(error)
      await emit({ type: 'failed', payload: { code: 'acp_connection_failed', message: safeError(error), retryable: true } })
    }).finally(() => child?.kill())

    const initialized = await ready.promise
    const requireContext = () => activeContext ?? initialized.context
    return {
      remoteSessionId: initialized.sessionId,
      prompt: async (prompt) => {
        const result = await requireContext().request(acp.methods.agent.session.prompt, {
          sessionId: initialized.sessionId, prompt: [{ type: 'text', text: prompt }],
        })
        await emit({ type: 'completed', payload: { summary: `ACP turn stopped: ${result.stopReason}`, usage: {} } })
      },
      approve: async (requestKey, optionId) => {
        const pending = permissions.get(requestKey)
        if (!pending) throw new Error(`ACP approval request is not pending: ${requestKey}`)
        if (!pending.options.has(optionId)) throw new Error(`ACP approval option is invalid: ${optionId}`)
        pending.response.resolve(optionId)
      },
      elicit: async (requestKey, action, content) => {
        const pending = elicitations.get(requestKey)
        if (!pending) throw new Error(`ACP elicitation request is not pending: ${requestKey}`)
        pending.response.resolve(action === 'accept' ? { action, content: content as Record<string, string | number | boolean | string[]> } : { action })
      },
      cancel: async () => {
        await requireContext().notify(acp.methods.agent.session.cancel, { sessionId: initialized.sessionId })
        await emit({ type: 'cancelled', payload: {} })
      },
      resume: async () => undefined,
      stop: async () => {
        for (const pending of permissions.values()) pending.response.resolve(undefined)
        for (const pending of elicitations.values()) pending.response.resolve({ action: 'cancel' })
        closed.resolve()
        child?.kill()
      },
    }
  }
}

async function normalizeAcpUpdate(
  update: acp.SessionUpdate,
  emit: EmitAgentEvent,
  checkpoint: { appendText(chunk: string): string },
): Promise<void> {
  if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
    await emit({ type: 'text_checkpoint', payload: { text: checkpoint.appendText(update.content.text) } })
    return
  }
  if (update.sessionUpdate === 'tool_call') {
    await emit({ type: 'action', payload: { actionId: update.toolCallId, title: update.title, status: normalizeStatus(update.status) } })
    await emitToolContent(update.toolCallId, update.title, update.content, emit)
    return
  }
  if (update.sessionUpdate === 'tool_call_update') {
    await emit({ type: 'action', payload: { actionId: update.toolCallId, title: update.title ?? 'Tool call', status: normalizeStatus(update.status) } })
    await emitToolContent(update.toolCallId, update.title ?? 'Tool call', update.content, emit)
    return
  }
  if (update.sessionUpdate === 'plan') {
    await emit({ type: 'plan', payload: { entries: update.entries.map((entry, index) => ({
      id: `plan-${index}`, title: entry.content, status: entry.status,
    })) } })
    return
  }
  if (update.sessionUpdate === 'plan_update') {
    const plan = update.plan
    const entries = plan.type === 'items'
      ? plan.entries.map((entry, index) => ({ id: `${plan.planId}-${index}`, title: entry.content, status: entry.status }))
      : [{ id: plan.planId, title: plan.type === 'markdown' ? plan.content : `Plan: ${plan.uri}`, status: 'in_progress' as const }]
    await emit({ type: 'plan', payload: { entries } })
    return
  }
  if (update.sessionUpdate === 'plan_removed') {
    await emit({ type: 'plan', payload: { entries: [] } })
  }
}

async function emitToolContent(
  toolCallId: string,
  title: string,
  content: acp.ToolCallContent[] | null | undefined,
  emit: EmitAgentEvent,
) {
  for (const [index, item] of (content ?? []).entries()) {
    if (item.type === 'diff') {
      const oldText = item.oldText ?? ''
      await emit({ type: 'diff', payload: {
        diffId: `${toolCallId}-diff-${index}`,
        title: item.path.slice(0, 2_000),
        patch: unifiedDiff(item.path, oldText, item.newText),
      } })
    } else if (item.type === 'terminal') {
      await emit({ type: 'terminal', payload: {
        terminalId: item.terminalId,
        title: title.slice(0, 2_000),
        summary: `Terminal ${item.terminalId} is attached to this action.`,
        status: 'running',
      } })
    }
  }
}

function unifiedDiff(path: string, oldText: string, newText: string) {
  return `--- a/${path}\n+++ b/${path}\n@@\n-${oldText}\n+${newText}`.slice(0, 200_000)
}

function normalizeStatus(status: string | null | undefined): 'started' | 'updated' | 'completed' | 'failed' {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'in_progress' || status === 'pending') return 'started'
  return 'updated'
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline })
  return { promise, resolve, reject }
}

function safeError(error: unknown): string { return error instanceof Error ? error.message.slice(0, 2_000) : 'Unknown ACP error' }
