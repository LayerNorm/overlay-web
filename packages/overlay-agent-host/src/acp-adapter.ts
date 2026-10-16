import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { Readable, Writable } from 'node:stream'
import { rm } from 'node:fs/promises'
import * as acp from '@agentclientprotocol/sdk'
import type { AgentAdapter, AgentAdapterSession, EmitAgentEvent, StartAdapterSessionInput } from './adapter.js'
import type { AdapterCapability, AdapterOptions } from '@layernorm/overlay-agent-bridge-protocol'
import { verifyMcpApprovalBridge } from '@layernorm/overlay-agent-bridge-protocol'
import { parseAgentOptions } from './agent-options.js'
import { applyAcpSettings } from './acp-settings.js'
import { orderedAcpUpdates } from './ordered-acp-updates.js'
import { actionTitle } from './action-title.js'
import {processGroupHasLiveMembers, signalProcessGroup} from './process-group.js'
import {createDiscoveryWorkspace} from './discovery-workspace.js'

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
  startupTimeoutMs?: number
}

type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void }

export async function overlayMcpApproval(metadata: Record<string, unknown>, requestedSchema: unknown) {
  const mcp = metadata.overlayMcp
  if (!mcp || typeof mcp !== 'object' || !('token' in mcp) || typeof mcp.token !== 'string') return null
  return verifyMcpApprovalBridge(mcp.token, requestedSchema)
}

/** A control-plane answer can beat delivery of its signed form. Preserve it until that form arrives. */
export function rememberOverlayMcpApproval<Response>(answers: Map<string, Response>, metadata: Record<string, unknown>, requestKey: string, response: Response): boolean {
  const mcp = metadata.overlayMcp
  if (!/^mcp_call:[a-f0-9-]{36}$/.test(requestKey) || !mcp || typeof mcp !== 'object' || !('token' in mcp) || typeof mcp.token !== 'string') return false
  const previous = answers.get(requestKey)
  if (previous && JSON.stringify(previous) !== JSON.stringify(response)) throw Error('Canonical MCP approval was already answered differently')
  if (!previous && answers.size >= 1000) throw Error('Canonical MCP approval cache is full')
  answers.set(requestKey, response)
  return true
}

export class AcpAgentAdapter implements AgentAdapter {
  readonly capability: AdapterCapability

  constructor(private readonly options: AcpAdapterOptions) {
    this.capability = {
      id: options.id, displayName: options.displayName, protocol: 'acp' as const,
      supports: { prompt: true, approval: true, cancel: true, resume: true },
      recovery: { liveReattachment: true, sessionLoading: true, interruptedTurnContinuation: false, approvalRestoration: false, providerCheckpoints: false },
    }
  }

  async discover(input?: Parameters<AgentAdapter['discover']>[0]) {
    await this.options.verify?.()
    if (!input || (this.capability.options && Date.now() - this.capability.options.discoveredAt < 24 * 60 * 60_000)) return this.capability
    const directory = await createDiscoveryWorkspace(input)
    if (!directory) return this.capability
    let probe: AgentAdapterSession | undefined
    try {
      // Session creation reads the agent's catalog; discovery never sends a prompt or offers workspace tools.
      const adapter = new AcpAgentAdapter({ ...this.options, startupTimeoutMs: this.options.startupTimeoutMs ?? 15000 })
      probe = await adapter.start({ runId: `discovery-${randomUUID()}`, workingDirectory: directory,
        additionalDirectories: [], prompt: '', metadata: {}, ...(input.credentials ? { credentials: input.credentials } : {}) }, async () => {})
      this.capability.options = adapter.capability.options
    } catch {
      // Missing provider sign-in keeps the static fallback until an authenticated session supplies options.
    } finally {
      try { await probe?.stop() }
      finally { await rm(directory, { recursive: true, force: true }) }
    }
    return this.capability
  }

  async start(input: StartAdapterSessionInput, emit: EmitAgentEvent): Promise<AgentAdapterSession> {
    const ready = deferred<{ sessionId: string; context: acp.ClientContext }>()
    const closed = deferred<void>()
    const permissions = new Map<string, { response: Deferred<string | undefined>; options: Set<string> }>()
    const elicitations = new Map<string, { response: Deferred<acp.CreateElicitationResponse> }>()
    const completedMcpApprovals = new Map<string, acp.CreateElicitationResponse>()
    let child: ChildProcessWithoutNullStreams | undefined
    let activeContext: acp.ClientContext | undefined
    let sessionId = input.remoteSessionId
    let textCheckpoint = ''
    let promptActive = false
    let sessionOptions: AdapterOptions = { discoveredAt: Date.now() }
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
        const bridge = await overlayMcpApproval(input.metadata, params.requestedSchema)
        const requestKey = bridge?.requestKey ?? randomUUID()
        const completed = bridge ? completedMcpApprovals.get(requestKey) : undefined
        if (completed) return completed
        const prior = elicitations.get(requestKey)
        if (prior) return prior.response.promise
        if (bridge && completedMcpApprovals.size >= 1000) return { action: 'cancel' as const }
        const response = deferred<acp.CreateElicitationResponse>()
        elicitations.set(requestKey, { response })
        // The server already wrote the canonical approval card. Register its host response without a second card.
        if (!bridge) await emit({ type: 'elicitation_requested', payload: { requestKey, prompt: params.message,
          requestedSchema: params.requestedSchema as Record<string, unknown>, context: {} } })
        const result = await response.promise
        if (bridge) completedMcpApprovals.set(requestKey, result)
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
          const loaded = await context.request(acp.methods.agent.session.load, {
            sessionId, cwd: input.workingDirectory, additionalDirectories: input.additionalDirectories, mcpServers,
          })
          sessionOptions = parseAgentOptions(loaded)
        } else {
          const created = await context.request(acp.methods.agent.session.new, {
            cwd: input.workingDirectory, additionalDirectories: input.additionalDirectories, mcpServers,
          })
          sessionId = created.sessionId
          sessionOptions = parseAgentOptions(created)
        }
        this.capability.options = sessionOptions
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
      await signalProcessGroup(pid, 'SIGTERM')
      let timer: ReturnType<typeof setTimeout> | undefined
      try { await Promise.race([exited, new Promise<void>(resolve => { timer = setTimeout(resolve, 1000) })]) }
      finally { if (timer) clearTimeout(timer) }
      await signalProcessGroup(pid, 'SIGKILL')
      await exited
      // SIGKILL delivery is asynchronous even after wrapper exit. Give all live
      // descendants a bounded drain; exited zombies cannot execute further work.
      const deadline = Date.now() + 2_000
      for (;;) {
        if (!await processGroupHasLiveMembers(pid)) break
        if (Date.now() >= deadline) throw new Error('ACP process group has not stopped; inspect remaining execution')
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      terminationConfirmed = true
      closed.resolve()
    }

    let startupTimer: ReturnType<typeof setTimeout> | undefined
    let initialized: Awaited<typeof ready.promise>
    try {
      initialized = await Promise.race([ready.promise, new Promise<never>((_, reject) => {
        startupTimer = setTimeout(() => reject(new Error('ACP session initialization timed out')), this.options.startupTimeoutMs ?? 60000)
      })])
    } catch (error) {
      if (child?.pid) await terminateProcess()
      else closed.resolve()
      throw error
    } finally { if (startupTimer) clearTimeout(startupTimer) }
    const requireContext = () => activeContext ?? initialized.context
    return {
      remoteSessionId: initialized.sessionId,
      prompt: async (prompt) => {
        promptActive = true
        try {
          sessionOptions = await applyAcpSettings(requireContext(), initialized.sessionId, input.metadata, sessionOptions)
          this.capability.options = sessionOptions
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
        const response: acp.CreateElicitationResponse = action === 'accept' ? { action, content: content as Record<string, string | number | boolean | string[]> } : { action }
        if (!pending && rememberOverlayMcpApproval(completedMcpApprovals, input.metadata, requestKey, response)) return
        if (!pending) throw new Error(`ACP elicitation request is not pending: ${requestKey}`)
        pending.response.resolve(response)
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
    await emit({ type: 'action', payload: { actionId: update.toolCallId, title: actionTitle(update.title), status: normalizeStatus(update.status) } })
    await emitToolContent(update.toolCallId, update.title, update.content, emit)
    return
  }
  if (update.sessionUpdate === 'tool_call_update') {
    await emit({ type: 'action', payload: { actionId: update.toolCallId, title: actionTitle(update.title ?? 'Tool call'), status: normalizeStatus(update.status) } })
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
        title: actionTitle(item.path),
        patch: unifiedDiff(item.path, oldText, item.newText),
      } })
    } else if (item.type === 'terminal') {
      await emit({ type: 'terminal', payload: {
        terminalId: item.terminalId,
        title: actionTitle(title),
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
