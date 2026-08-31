import { createHash, randomUUID } from 'node:crypto'
import { platform, release } from 'node:os'
import {
  eventBatchSchema,
  OVERLAY_AGENT_PROTOCOL_VERSION,
  type AgentHostCommand,
  type AgentHostEvent,
  type FilesystemGrant,
} from '@layernorm/overlay-agent-bridge-protocol'
import type { AgentAdapter, AgentAdapterSession, NormalizedAgentEvent } from './adapter.js'
import { resolveFilesystemScope } from './filesystem-policy.js'
import { StructuredLogger } from './logger.js'
import { SqliteHostStateStore } from './state.js'
import type { AgentControlPlaneClient } from './transport.js'
import { nextReconnectDelay } from './transport.js'

export type AgentHostRuntimeOptions = {
  environmentId: string
  workspaceId: string
  filesystem: FilesystemGrant
  adapters: AgentAdapter[]
  state: SqliteHostStateStore
  controlPlane: AgentControlPlaneClient
  logger?: StructuredLogger
  maxOutboxEvents?: number
}

export class AgentHostRuntime {
  private readonly adapters: Map<string, AgentAdapter>
  private readonly sessions = new Map<string, AgentAdapterSession>()
  private readonly logger: StructuredLogger
  private flushing?: Promise<void>
  private lastHeartbeatAt = 0

  constructor(private readonly options: AgentHostRuntimeOptions) {
    this.adapters = new Map(options.adapters.map((adapter) => [adapter.capability.id, adapter]))
    this.logger = options.logger ?? new StructuredLogger()
  }

  async discoverCapabilities() {
    return Promise.all([...this.adapters.values()].map((adapter) => adapter.discover()))
  }

  async pollOnce(waitMs = 25_000, signal?: AbortSignal): Promise<number> {
    if (this.options.state.outboxSize() >= (this.options.maxOutboxEvents ?? 10_000)) {
      await this.flushOutbox()
      if (this.options.state.outboxSize() >= (this.options.maxOutboxEvents ?? 10_000)) throw new Error('event outbox backpressure limit reached')
    }
    const response = await this.options.controlPlane.pollCommands({ waitMs, ...(signal ? { signal } : {}) })
    for (const command of response.commands) await this.processCommand(command)
    await this.flushOutbox()
    return response.retryAfterMs ?? 0
  }

  async run(signal: AbortSignal): Promise<void> {
    let attempt = 0
    await this.refreshHostState()
    while (!signal.aborted) {
      try {
        if (Date.now() - this.lastHeartbeatAt >= 30_000) await this.heartbeat()
        const retryAfterMs = await this.pollOnce(25_000, signal)
        attempt = 0
        if (retryAfterMs > 0) await abortableDelay(retryAfterMs, signal)
      } catch (error) {
        if (signal.aborted) break
        const delay = nextReconnectDelay(attempt++)
        this.logger.warn('agent host poll failed', { error: safeError(error), delay })
        await abortableDelay(delay, signal)
      }
    }
  }

  private async refreshHostState(): Promise<void> {
    if (this.options.controlPlane.updateCapabilities) {
      await this.options.controlPlane.updateCapabilities({
        protocolVersion: OVERLAY_AGENT_PROTOCOL_VERSION,
        hostVersion: '0.0.1',
        platform: `${platform()} ${release()}`,
        adapters: await this.discoverCapabilities(),
        filesystem: this.options.filesystem,
        maxConcurrentRuns: Math.max(1, this.adapters.size),
      })
    }
    await this.heartbeat()
  }

  private async heartbeat(): Promise<void> {
    await this.options.controlPlane.heartbeat?.()
    this.lastHeartbeatAt = Date.now()
  }

  async processCommand(command: AgentHostCommand): Promise<void> {
    if (command.environmentId !== this.options.environmentId || command.workspaceId !== this.options.workspaceId) {
      throw new Error('command scope does not match this host')
    }
    const processed = this.options.state.getProcessedCommand(command.commandId)
    if (processed) {
      await this.acknowledge(command, processed.accepted, processed.errorMessage, processed.errorCode)
      return
    }
    const expectedSequence = this.options.state.commandCursor() + 1
    if (command.sequence !== expectedSequence) {
      await this.acknowledge(command, false, `expected command sequence ${expectedSequence}`, 'command_sequence_gap')
      throw new Error(`expected command sequence ${expectedSequence}, received ${command.sequence}`)
    }
    try {
      await this.dispatch(command)
      this.options.state.recordCommandResult(command.commandId, { sequence: command.sequence, accepted: true })
    } catch (error) {
      const message = safeError(error)
      this.options.state.recordCommandResult(command.commandId, { sequence: command.sequence, accepted: false, errorCode: 'command_rejected', errorMessage: message })
      await this.acknowledge(command, false, message, 'command_rejected')
      throw error
    }
    await this.acknowledge(command, true)
  }

  async uploadArtifact(runId: string, input: { name: string; mediaType: string; bytes: Uint8Array }): Promise<string> {
    const controlPlane = this.options.controlPlane
    if (!controlPlane.createArtifactUpload || !controlPlane.uploadArtifactBytes || !controlPlane.completeArtifactUpload) {
      throw new Error('control plane does not support artifact uploads')
    }
    const sha256 = createHash('sha256').update(input.bytes).digest('hex')
    const upload = await controlPlane.createArtifactUpload({ protocolVersion: OVERLAY_AGENT_PROTOCOL_VERSION,
      runId, name: input.name, mediaType: input.mediaType, size: input.bytes.byteLength, sha256 })
    await controlPlane.uploadArtifactBytes(upload, input.bytes)
    await controlPlane.completeArtifactUpload(upload.artifactId)
    await this.emit(runId, { type: 'artifact', payload: { name: input.name, mediaType: input.mediaType,
      size: input.bytes.byteLength, sha256, uploadReference: upload.uploadReference } })
    return upload.artifactId
  }

  async flushOutbox(): Promise<void> {
    if (this.flushing) return this.flushing
    this.flushing = this.flushOutboxInternal().finally(() => { this.flushing = undefined })
    return this.flushing
  }

  private async flushOutboxInternal(): Promise<void> {
    for (;;) {
      const events = this.options.state.pendingEvents(100)
      if (events.length === 0) return
      const batch = eventBatchSchema.parse({
        protocolVersion: OVERLAY_AGENT_PROTOCOL_VERSION,
        environmentId: this.options.environmentId,
        runId: events[0].runId,
        events,
      })
      const acknowledgement = await this.options.controlPlane.uploadEvents(batch)
      if (acknowledgement.accepted) {
        const lastSentSequence = batch.events.at(-1)!.sourceSequence
        if (acknowledgement.acknowledgedSequence !== lastSentSequence) {
          throw new Error(`server acknowledged ${acknowledgement.acknowledgedSequence}, expected ${lastSentSequence}`)
        }
        this.options.state.acknowledgeEvents(batch.runId, acknowledgement.acknowledgedSequence)
        continue
      }
      const lastSentSequence = batch.events.at(-1)!.sourceSequence
      if (acknowledgement.expectedSequence > events[0].sourceSequence && acknowledgement.expectedSequence <= lastSentSequence + 1) {
        this.options.state.discardEventsBefore(batch.runId, acknowledgement.expectedSequence)
        continue
      }
      throw new Error(`server requested unavailable event sequence ${acknowledgement.expectedSequence}`)
    }
  }

  private async dispatch(command: AgentHostCommand): Promise<void> {
    if (command.type === 'start') {
      if (command.payload.fresh) {
        await this.sessions.get(command.runId)?.stop('Starting a fresh session')
        this.sessions.delete(command.runId)
        this.options.state.deleteSession(command.runId)
        this.options.state.deleteAdapterSessionState(command.runId)
      } else if (this.sessions.has(command.runId)) return
      const adapter = this.requireAdapter(command.payload.adapterId)
      const scope = await resolveFilesystemScope(this.options.filesystem, command.payload.workingDirectory)
      const session = await adapter.start({
        runId: command.runId,
        workingDirectory: scope.workingDirectory,
        additionalDirectories: scope.additionalDirectories,
        prompt: command.payload.prompt,
        ...(command.payload.sessionId ? { remoteSessionId: command.payload.sessionId } : {}),
        metadata: command.payload.metadata,
        adapterState: this.options.state.getAdapterSessionState(command.runId, command.payload.adapterId),
        persistAdapterState: (state) => this.options.state.saveAdapterSessionState(command.runId, command.payload.adapterId, state),
      }, (event) => this.emit(command.runId, event))
      this.sessions.set(command.runId, session)
      this.options.state.saveSession({ runId: command.runId, adapterId: command.payload.adapterId, remoteSessionId: session.remoteSessionId, workingDirectory: scope.workingDirectory })
      await this.emit(command.runId, { type: 'session_started', payload: { remoteSessionId: session.remoteSessionId, adapterId: command.payload.adapterId } })
      if (!session.initialPromptHandled) {
        void session.prompt(command.payload.prompt).catch((error) => this.emit(command.runId, { type: 'failed', payload: { code: 'adapter_prompt_failed', message: safeError(error), retryable: true } }))
      }
      return
    }
    if (command.type === 'shutdown') {
      const session = this.sessions.get(command.runId)
      if (session) await session.stop(command.payload.reason)
      this.sessions.delete(command.runId)
      return
    }
    const session = await this.requireSession(command.runId, command.type === 'reconnect' ? command.payload.remoteSessionId : undefined)
    if (command.type === 'prompt') await session.prompt(command.payload.prompt)
    else if (command.type === 'approval_response') await session.approve(command.payload.requestKey, command.payload.optionId)
    else if (command.type === 'elicitation_response') await session.elicit(command.payload.requestKey, command.payload.action, command.payload.content)
    else if (command.type === 'cancel') await session.cancel(command.payload.reason)
    else if (command.type === 'reconnect') await session.resume()
  }

  private async requireSession(runId: string, requestedRemoteSessionId?: string): Promise<AgentAdapterSession> {
    const active = this.sessions.get(runId)
    if (active) return active
    const stored = this.options.state.getSession(runId)
    if (!stored) throw new Error(`remote session not found for run ${runId}`)
    if (requestedRemoteSessionId && requestedRemoteSessionId !== stored.remoteSessionId) throw new Error('reconnect session does not match persisted session')
    const scope = await resolveFilesystemScope(this.options.filesystem, stored.workingDirectory)
    const session = await this.requireAdapter(stored.adapterId).start({
      runId, workingDirectory: scope.workingDirectory, additionalDirectories: scope.additionalDirectories,
      prompt: '', remoteSessionId: stored.remoteSessionId, metadata: {},
      adapterState: this.options.state.getAdapterSessionState(runId, stored.adapterId),
      persistAdapterState: (state) => this.options.state.saveAdapterSessionState(runId, stored.adapterId, state),
    }, (event) => this.emit(runId, event))
    this.sessions.set(runId, session)
    return session
  }

  private requireAdapter(adapterId: string): AgentAdapter {
    const adapter = this.adapters.get(adapterId)
    if (!adapter) throw new Error(`adapter is not installed: ${adapterId}`)
    return adapter
  }

  private async emit(runId: string, event: NormalizedAgentEvent): Promise<void> {
    if (this.options.state.outboxSize() >= (this.options.maxOutboxEvents ?? 10_000)) {
      throw new Error('event outbox backpressure limit reached')
    }
    const stored: Omit<AgentHostEvent, 'sourceSequence'> = {
      protocolVersion: OVERLAY_AGENT_PROTOCOL_VERSION,
      eventId: randomUUID(), environmentId: this.options.environmentId, runId,
      occurredAt: Date.now(), ...event,
    } as Omit<AgentHostEvent, 'sourceSequence'>
    this.options.state.appendEvent(stored)
    try { await this.flushOutbox() } catch (error) { this.logger.warn('event upload deferred', { runId, error: safeError(error) }) }
  }

  private acknowledge(command: AgentHostCommand, accepted: boolean, message?: string, errorCode = 'command_rejected'): Promise<void> {
    return this.options.controlPlane.acknowledgeCommand({
      protocolVersion: OVERLAY_AGENT_PROTOCOL_VERSION,
      commandId: command.commandId,
      environmentId: this.options.environmentId,
      accepted,
      ...(!accepted ? { error: { code: errorCode, message: message ?? 'command rejected' } } : {}),
    })
  }
}

function safeError(error: unknown): string { return error instanceof Error ? error.message.slice(0, 2_000) : 'Unknown host error' }

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds)
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
  })
}
