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
          clientCapabilities: {},
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
      cancel: async () => {
        await requireContext().notify(acp.methods.agent.session.cancel, { sessionId: initialized.sessionId })
        await emit({ type: 'cancelled', payload: {} })
      },
      resume: async () => undefined,
      stop: async () => {
        for (const pending of permissions.values()) pending.response.resolve(undefined)
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
    return
  }
  if (update.sessionUpdate === 'tool_call_update') {
    await emit({ type: 'action', payload: { actionId: update.toolCallId, title: update.title ?? 'Tool call', status: normalizeStatus(update.status) } })
  }
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
