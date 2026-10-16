import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { Readable, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'
import type { AgentAdapter, AgentAdapterSession, EmitAgentEvent, StartAdapterSessionInput } from './adapter.js'
import { orderedAcpUpdates } from './ordered-acp-updates.js'

/**
 * Overlay sends each turn an MCP server (its workspace tools: notes, files,
 * memory, knowledge, connected apps) with a run-scoped bearer token. It is
 * offered to the agent only over HTTP, and only when the agent says it
 * supports HTTP MCP servers.
 */
export function overlayMcpServers(metadata: Record<string, unknown>, agentSupportsHttp: boolean): acp.McpServer[] {
  const overlayMcp = metadata.overlayMcp as { url?: unknown; token?: unknown } | undefined
  if (!agentSupportsHttp || typeof overlayMcp?.url !== 'string' || typeof overlayMcp.token !== 'string') return []
  let url: URL
  try {
    url = new URL(overlayMcp.url)
  } catch {
    return []
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return []
  return [{ type: 'http', name: 'overlay', url: url.toString(), headers: [{ name: 'Authorization', value: `Bearer ${overlayMcp.token}` }] }]
}

export type AcpAdapterOptions = {
  id: string
  displayName: string
  command: string
  args?: string[]
  env?: Record<string, string>
  verify?: () => Promise<void>
}

type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void }

export class AcpAgentAdapter implements AgentAdapter {
  readonly capability

  constructor(private readonly options: AcpAdapterOptions) {
    this.capability = {
      id: options.id, displayName: options.displayName, protocol: 'acp' as const,
      supports: { prompt: true, approval: true, cancel: true, resume: true },
      recovery: { liveReattachment: true, sessionLoading: true, interruptedTurnContinuation: false, approvalRestoration: false, providerCheckpoints: false },
    }
  }

  async discover() {
    await this.options.verify?.()
    return this.capability
  }

  async start(input: StartAdapterSessionInput, emit: EmitAgentEvent): Promise<AgentAdapterSession> {
    const ready = deferred<{ sessionId: string; context: acp.ClientContext }>()
    const closed = deferred<void>()
    const permissions = new Map<string, { response: Deferred<string | undefined>; options: Set<string> }>()
    const elicitations = new Map<string, { response: Deferred<acp.CreateElicitationResponse> }>()
    let child: ChildProcessWithoutNullStreams | undefined
    let activeContext: acp.ClientContext | undefined
    let sessionId = input.remoteSessionId
    let textCheckpoint = ''
    let promptActive = false
    let updateOrder: ReturnType<typeof orderedAcpUpdates> | undefined

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
        try {
          await normalizeAcpUpdate(params.update, emit, {
            appendText(chunk) {
              textCheckpoint += chunk
              return textCheckpoint
            },
          })
          updateOrder?.complete()
        } catch (error) { updateOrder?.fail(error) }
      })

    const background = async () => {
      child = spawn(this.options.command, this.options.args ?? [], {
        cwd: input.workingDirectory,
        env: { ...process.env, ...this.options.env, ...input.credentials },
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      })
      child.stderr.on('data', (chunk) => {
        if (process.env.OVERLAY_AGENT_HOST_DEBUG_ACP === '1') process.stderr.write(chunk)
      })
      child.once('error', ready.reject)
      const stream = acp.ndJsonStream(
        Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      )
      updateOrder = orderedAcpUpdates(stream)
      await app.connectWith(updateOrder.stream, async (context) => {
        activeContext = context
        const initialized = await context.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: { elicitation: { form: {} } },
        })
        if (sessionId && initialized.agentCapabilities?.loadSession !== true) {
          throw new Error(`ACP adapter ${this.options.id} does not support session resume`)
        }
        const mcpServers = overlayMcpServers(input.metadata, Boolean(initialized.agentCapabilities?.mcpCapabilities?.http))
        if (sessionId) {
          await context.request(acp.methods.agent.session.load, {
            sessionId, cwd: input.workingDirectory, additionalDirectories: input.additionalDirectories, mcpServers,
          })
        } else {
          const created = await context.request(acp.methods.agent.session.new, {
            cwd: input.workingDirectory, additionalDirectories: input.additionalDirectories, mcpServers,
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

    let terminationConfirmed = false
    const terminateProcess = async () => {
      if (terminationConfirmed) return
      if (!child?.pid) throw new Error('cannot confirm ACP process termination')
      const target = child
      const pid = target.pid!
      const signal = (name: NodeJS.Signals) => {
        try { process.platform === 'win32' ? target.kill(name) : process.kill(-pid, name) }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
      }
      const exited = new Promise<void>(resolve => target.exitCode !== null || target.signalCode !== null ? resolve() : target.once('exit', () => resolve()))
      if (process.platform === 'win32') {
        // Node's child.kill terminates only the wrapper on Windows. Require the
        // OS tree terminator to succeed before reporting a confirmed stop.
        await new Promise<void>((resolve, reject) => {
          const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
          killer.once('error', reject)
          killer.once('exit', code => code === 0 ? resolve() : reject(new Error('ACP process tree termination was not confirmed')))
        })
        await exited
        terminationConfirmed = true
        closed.resolve()
        return
      }
      signal('SIGTERM')
      let timer: ReturnType<typeof setTimeout> | undefined
      try { await Promise.race([exited, new Promise<void>(resolve => { timer = setTimeout(resolve, 1000) })]) }
      finally { if (timer) clearTimeout(timer) }
      signal('SIGKILL')
      await exited
      // SIGKILL delivery and descendant reaping are asynchronous even after the
      // wrapper emits exit. Give the whole group a bounded drain before attesting.
      const deadline = Date.now() + 2_000
      for (;;) {
        try { process.kill(-pid, 0) }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') break
          throw error
        }
        if (Date.now() >= deadline) throw new Error('ACP process group has not stopped; inspect remaining execution')
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      terminationConfirmed = true
      closed.resolve()
    }

    const initialized = await ready.promise
    const requireContext = () => activeContext ?? initialized.context
    return {
      remoteSessionId: initialized.sessionId,
      prompt: async (prompt) => {
        promptActive = true
        try {
          const result = await requireContext().request(acp.methods.agent.session.prompt, {
            sessionId: initialized.sessionId, prompt: [{ type: 'text', text: prompt }],
          })
          await emit({ type: 'completed', payload: { summary: `ACP turn stopped: ${result.stopReason}`, usage: {} } })
        } finally { promptActive = false }
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
        await requireContext().notify(acp.methods.agent.session.cancel, { sessionId: initialized.sessionId }).catch(() => undefined)
        await terminateProcess()
        await emit({ type: 'cancelled', payload: {} })
      },
      observe: async () => !child || child.exitCode !== null || child.signalCode !== null ? 'lost' : promptActive ? 'live' : 'unknown',
      resume: async () => {
        if (!child || child.exitCode !== null || child.signalCode !== null || !promptActive)
          throw new Error('ACP session loading does not restore an interrupted turn; inspect the previous process before continuing')
      },
      stop: async () => {
        for (const pending of permissions.values()) pending.response.resolve(undefined)
        for (const pending of elicitations.values()) pending.response.resolve({ action: 'cancel' })
        await terminateProcess()
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
    return
  }
  if (update.sessionUpdate === 'available_commands_update') {
    const commands = (update.availableCommands ?? []).slice(0, 100).map((command) => ({
      name: command.name,
      ...(command.description ? { description: command.description } : {}),
      ...(command.input?.hint ? { inputHint: command.input.hint } : {}),
    }))
    await emit({ type: 'commands_update', payload: { commands } })
  }
}

export async function emitToolContent(
  toolCallId: string,
  title: string,
  content: acp.ToolCallContent[] | null | undefined,
  emit: EmitAgentEvent,
) {
  // Sequential on purpose: emitted events form an ordered stream the consumer
  // renders in order, so they must not be reordered by parallel emission.
  for (const [index, item] of (content ?? []).entries()) {
    if (item.type === 'diff') {
      const oldText = item.oldText ?? ''
      // react-doctor-disable-next-line react-doctor/async-await-in-loop
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
