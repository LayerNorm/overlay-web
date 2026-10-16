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
import { packEventBatch, shrinkOversizedEvent } from './outbox-packing.js'
import { coalesceTextCheckpoints } from './text-coalescer.js'
import { StructuredLogger } from './logger.js'
import { SqliteHostStateStore } from './state.js'
import type { AgentControlPlaneClient } from './transport.js'
import { ControlPlaneRequestError, nextReconnectDelay } from './transport.js'

export type AgentHostRuntimeOptions = {
  /** Opt in only against a server supporting the negotiated lifecycle extension. */
  durableLifecycle?: boolean
  environmentId: string
  workspaceId: string
  filesystem: FilesystemGrant
  adapters: AgentAdapter[]
  state: SqliteHostStateStore
  controlPlane: AgentControlPlaneClient
  logger?: StructuredLogger
  maxOutboxEvents?: number
  /** Overlay Cloud machines fetch their provider credentials from the control plane for each run. */
  fetchRunCredentials?: boolean
}

export class AgentHostRuntime {
  private readonly adapters: Map<string, AgentAdapter>
  private readonly sessions = new Map<string, AgentAdapterSession>()
  private readonly logger: StructuredLogger
  private flushing?: Promise<void>
  /** Highest sequence being uploaded per event stream; queued checkpoints above it may still be replaced. */
  private readonly inFlight = new Map<string, number>()
  private flushRetry?: ReturnType<typeof setTimeout>
  private flushFailures = 0
  private outboxWarned = false
  private uploadsStopped = false
  private readonly terminalRuns = new Set<string>()
  private lastHeartbeatAt = 0
  private readonly bootId = randomUUID()
  private readonly executions = new Map<string, { attemptId: string; generation: number; hostBootId?: string }>()
  private resolvedThroughSequence = 0

  constructor(private readonly options: AgentHostRuntimeOptions) {
    this.adapters = new Map(options.adapters.map((adapter) => [adapter.capability.id, adapter]))
    this.logger = options.logger ?? new StructuredLogger()
  }

  async discoverCapabilities() {
    return Promise.all([...this.adapters.values()].map((adapter) => adapter.discover()))
  }

  async pollOnce(waitMs = 25_000, signal?: AbortSignal): Promise<number> {
    // A large backlog must not stop the host from receiving commands (a Stop most of all); it only gets reported.
    if (this.options.state.outboxSize() >= (this.options.maxOutboxEvents ?? 10_000)) {
      this.scheduleFlush()
      if (!this.outboxWarned && this.options.state.outboxSize() >= (this.options.maxOutboxEvents ?? 10_000)) {
        this.outboxWarned = true
        this.logger.warn('event outbox is backed up', { events: this.options.state.outboxSize() })
      }
    }
    const response = await this.options.controlPlane.pollCommands({ waitMs, ...(signal ? { signal } : {}) })
    if (response.resolvedThroughSequence !== undefined)
      this.resolvedThroughSequence = Math.max(this.resolvedThroughSequence, response.resolvedThroughSequence)
    // Sequential on purpose: commands arrive ordered and may build on each
    // other (e.g. stop after start), so they must be processed in order.
    for (const command of response.commands) {
      // react-doctor-disable-next-line react-doctor/async-await-in-loop
      await this.processCommand(command)
    }
    this.scheduleFlush()
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
        await abortableDelay(delay, signal).catch(() => undefined)
      }
    }
    this.stopBackgroundUploads()
  }

  private async refreshHostState(): Promise<void> {
    if (this.options.controlPlane.updateCapabilities) {
      await this.options.controlPlane.updateCapabilities({
        protocolVersion: OVERLAY_AGENT_PROTOCOL_VERSION,
        ...(this.options.durableLifecycle ? { remoteLifecycleVersion: 2 as const } : {}),
        hostVersion: '0.3.12',
        platform: `${platform()} ${release()}`,
        adapters: (await this.discoverCapabilities()).map((capability) => {
          if (this.options.durableLifecycle) return capability
          const { recovery, ...legacy } = capability
          void recovery
          return legacy
        }),
        filesystem: this.options.filesystem,
        maxConcurrentRuns: Math.max(1, this.adapters.size),
      })
    }
    await this.heartbeat()
  }

  private async heartbeat(): Promise<void> {
    await this.options.controlPlane.heartbeat?.()
    this.lastHeartbeatAt = Date.now()
    if (this.options.durableLifecycle) for (const [runId, session] of this.sessions) {
      const execution = this.executions.get(runId)
      if (!execution || this.terminalRuns.has(runId)) continue
      await this.emit(runId, { type: 'process_observation', payload: { process: await session.observe?.() ?? 'unknown' } }, execution)
    }
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
    const cursor = this.options.state.commandCursor()
    if (cursor === 0 && command.sequence > 1) {
      this.options.state.adoptCommandCursor(command.sequence - 1)
    }
    const expectedSequence = this.options.state.commandCursor() + 1
    if (command.sequence !== expectedSequence) {
      // The server attests which skipped numbers are already resolved; a hole it reports as
      // resolved is safe to jump over instead of wedging the whole command stream behind it.
      if (command.sequence > expectedSequence && command.sequence - 1 <= this.resolvedThroughSequence) {
        this.options.state.resumeCommandCursor(command.sequence - 1)
      } else {
        await this.acknowledge(command, false, `expected command sequence ${expectedSequence}`, 'command_sequence_gap')
        throw new Error(`expected command sequence ${expectedSequence}, received ${command.sequence}`)
      }
    }
    if (!this.options.state.claimCommand(command.commandId)) {
      const message = 'The previous command outcome is unknown; inspect the current execution instead of replaying it.'
      this.options.state.recordCommandResult(command.commandId, { sequence: command.sequence, accepted: false, errorCode: 'command_outcome_unknown', errorMessage: message })
      await this.acknowledge(command, false, message, 'command_outcome_unknown')
      return
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
      const packed = packEventBatch(this.options.environmentId, events)
      if (!packed.batch) {
        // One event larger than any upload: shrink it once, in place, so the stream keeps moving.
        const shrunk = packed.oversized && shrinkOversizedEvent(packed.oversized)
        if (!shrunk) throw new Error(`event ${packed.oversized?.sourceSequence} cannot fit in an upload`)
        this.options.state.replaceQueuedEvent(shrunk)
        this.logger.warn('shortened an oversized text checkpoint', { runId: shrunk.runId, sequence: shrunk.sourceSequence })
        continue
      }
      const batch = eventBatchSchema.parse(packed.batch)
      const stream = streamKey(batch.runId, batch.events[0].execution?.attemptId)
      this.inFlight.set(stream, batch.events.at(-1)!.sourceSequence)
      this.options.state.markUploadAttempt(batch.events)
      // Sequential on purpose: batches carry ordered sequences; the next
      // iteration reads pendingEvents after this batch is acknowledged.
      // react-doctor-disable-next-line react-doctor/async-await-in-loop
      const acknowledgement = await this.options.controlPlane.uploadEvents(batch).finally(() => this.inFlight.delete(stream))
      if (acknowledgement.accepted) {
        const lastSentSequence = batch.events.at(-1)!.sourceSequence
        if (acknowledgement.acknowledgedSequence !== lastSentSequence) {
          throw new Error(`server acknowledged ${acknowledgement.acknowledgedSequence}, expected ${lastSentSequence}`)
        }
        this.options.state.acknowledgeEvents(batch.runId, acknowledgement.acknowledgedSequence, batch.events[0].execution?.attemptId)
        continue
      }
      const lastSentSequence = batch.events.at(-1)!.sourceSequence
      if (!events[0].execution && acknowledgement.expectedSequence > events[0].sourceSequence && acknowledgement.expectedSequence <= lastSentSequence + 1) {
        this.options.state.discardEventsBefore(batch.runId, acknowledgement.expectedSequence, batch.events[0].execution?.attemptId)
        continue
      }
      throw new Error(`server requested unavailable event sequence ${acknowledgement.expectedSequence}`)
    }
  }

  private async dispatch(command: AgentHostCommand): Promise<void> {
    this.acceptExecutionFence(command)
    if (command.type === 'observe') {
      const session = this.sessions.get(command.runId)
      await this.emit(command.runId, { type: 'process_observation', payload: { process: session ? await session.observe?.() ?? 'unknown' : 'unknown' } })
      return
    }
    if (command.type === 'start') { await this.startSession(command); return }
    if (command.type === 'shutdown') {
      const session = this.sessions.get(command.runId)
      if (session) await session.stop(command.payload.reason)
      this.sessions.delete(command.runId)
      return
    }
    if (command.execution && command.type === 'cancel' && !this.sessions.has(command.runId)) {
      // An empty JS map does not prove an orphaned subprocess stopped.
      await this.emit(command.runId, { type: 'process_observation', payload: { process: 'unknown', recoveryOutcome: 'unavailable' } })
      return
    }
    const session = await this.requireSession(command.runId, command.type === 'reconnect' ? command.payload.remoteSessionId : undefined)
    if (command.type === 'prompt') {
      const execution = this.executions.get(command.runId)
      void session.prompt(command.payload.prompt).catch(error => this.emit(command.runId,
        { type: 'failed', payload: { code: 'adapter_prompt_failed', message: safeError(error), retryable: true } }, execution))
    }
    else if (command.type === 'approval_response') await session.approve(command.payload.requestKey, command.payload.optionId)
    else if (command.type === 'elicitation_response') await session.elicit(command.payload.requestKey, command.payload.action, command.payload.content)
    else if (command.type === 'cancel') await session.cancel(command.payload.reason)
    else if (command.type === 'reconnect') {
      const stored = this.options.state.getSession(command.runId)
      if (command.execution && stored && this.requireAdapter(stored.adapterId).capability.protocol === 'eve') {
        const process = await session.observe?.() ?? 'unknown'
        await this.emit(command.runId, { type: 'process_observation', payload: { process, recoveryOutcome: process === 'live' ? 'attached_live' : 'unavailable' } })
        if (process === 'live') void session.resume().catch(error => this.emit(command.runId, { type: 'failed', payload: { code: 'native_stream_unavailable', message: safeError(error), retryable: true } }))
        return
      }
      await session.resume()
      if (command.execution) await this.emit(command.runId, { type: 'process_observation', payload: { process: await session.observe?.() ?? 'unknown', recoveryOutcome: 'attached_live' } })
    }
  }

  private acceptExecutionFence(command: AgentHostCommand): void {
    if (!command.execution) return
    if (!this.options.durableLifecycle) throw new Error('remote lifecycle extension was not negotiated')
    // The server delivers shutdowns for runs this host may never have seen (or whose
    // attempt was replaced): they cannot start a writer, so they bypass the fence.
    if (command.type === 'shutdown') return
    const previous = this.executions.get(command.runId) ?? this.options.state.getSession(command.runId)?.execution
    const replacesPrevious = previous && (previous.attemptId !== command.execution.attemptId || previous.generation !== command.execution.generation)
    // The server only emits `fresh` on an explicit start_fresh: that user action is the
    // proof-of-intent that authorizes replacing a persisted execution whose writer state
    // is unknown (e.g. this host restarted while a detached adapter child was running).
    if (replacesPrevious && !(command.type === 'start' && command.payload.fresh === true))
      throw new Error('execution replacement requires proof that the old writer stopped')
    this.executions.set(command.runId, { ...command.execution, hostBootId: this.bootId })
    if (replacesPrevious) this.terminalRuns.delete(command.runId)
  }

  private async startSession(command: Extract<AgentHostCommand, { type: 'start' }>): Promise<void> {
    if (command.payload.fresh) {
      // An explicit start_fresh authorizes teardown even when the persisted session is
      // not live here: the old process may be an orphan, and refusing would leave the
      // run unrecoverable.
      await this.sessions.get(command.runId)?.stop('Starting a fresh session')
      this.sessions.delete(command.runId)
      this.options.state.deleteSession(command.runId)
      this.options.state.deleteAdapterSessionState(command.runId)
    } else if (this.sessions.has(command.runId)) return
    else if (this.options.state.getSession(command.runId)) {
      // A crash after the external write but before the local ack leaves an unknown outcome.
      // Do not create another process or re-prompt it merely because delivery was repeated.
      throw new Error('persisted execution exists; observe or inspect its outcome before starting again')
    }
    if (command.execution && !this.options.state.claimExecution(command.runId, command.execution.attemptId))
      throw new Error('execution start outcome is unknown; inspect the existing process before continuing')
    const adapter = this.requireAdapter(command.payload.adapterId)
    const scope = await resolveFilesystemScope(this.options.filesystem, command.payload.workingDirectory)
    const credentials = await this.runCredentials(command.runId, command.payload.metadata.runCredentials === true)
    if (credentials === 'unavailable') return
    // Bind callbacks before adapter code can emit, including during old-session teardown.
    const execution = this.executions.get(command.runId)
    const emit = coalesceTextCheckpoints((event: NormalizedAgentEvent) => this.emit(command.runId, event, execution))
    const session = await adapter.start({
      runId: command.runId,
      workingDirectory: scope.workingDirectory,
      additionalDirectories: scope.additionalDirectories,
      prompt: command.payload.prompt,
      ...(command.payload.sessionId ? { remoteSessionId: command.payload.sessionId } : {}),
      metadata: command.payload.metadata,
      ...(credentials ? { credentials } : {}),
      adapterState: this.options.state.getAdapterSessionState(command.runId, command.payload.adapterId),
      persistAdapterState: (state) => this.options.state.saveAdapterSessionState(command.runId, command.payload.adapterId, state),
    }, emit)
    this.sessions.set(command.runId, session)
    this.options.state.saveSession({ runId: command.runId, adapterId: command.payload.adapterId, remoteSessionId: session.remoteSessionId, workingDirectory: scope.workingDirectory,
      config: { version: 1, configReference: command.payload.bindingId, toolsReference: command.runId, ...(typeof command.payload.metadata.model === 'string' ? { model: command.payload.metadata.model } : {}) },
      ...(command.execution ? { execution: { ...command.execution, hostBootId: this.bootId } } : {}),
    })
    await this.emit(command.runId, { type: 'session_started', payload: { remoteSessionId: session.remoteSessionId, adapterId: command.payload.adapterId } })
    if (!session.initialPromptHandled) {
      void session.prompt(command.payload.prompt).catch((error) => emit({ type: 'failed', payload: { code: 'adapter_prompt_failed', message: safeError(error), retryable: true } }))
    }
    return
  }

  private async requireSession(runId: string, requestedRemoteSessionId?: string): Promise<AgentAdapterSession> {
    const active = this.sessions.get(runId)
    if (active) return active
    const stored = this.options.state.getSession(runId)
    if (!stored) throw new Error(`remote session not found for run ${runId}`)
    if (requestedRemoteSessionId && requestedRemoteSessionId !== stored.remoteSessionId) throw new Error('reconnect session does not match persisted session')
    const adapter = this.requireAdapter(stored.adapterId)
    if (adapter.capability.recovery?.interruptedTurnContinuation !== true) {
      if (this.options.durableLifecycle) await this.emit(runId, { type: 'process_observation', payload: { process: 'unknown', recoveryOutcome: 'unavailable' } })
      throw new Error('adapter cannot restore interrupted execution or in-memory approval; inspect the original process')
    }
    const scope = await resolveFilesystemScope(this.options.filesystem, stored.workingDirectory)
    // A resumed session needs its credentials again; whether this run has an account is the server's call.
    const credentials = await this.runCredentials(runId, this.options.fetchRunCredentials === true)
    if (credentials === 'unavailable') throw new Error('provider credentials are unavailable for this run')
    const session = await this.requireAdapter(stored.adapterId).start({
      runId, workingDirectory: scope.workingDirectory, additionalDirectories: scope.additionalDirectories,
      prompt: '', remoteSessionId: stored.remoteSessionId, metadata: { ...(stored.config?.model ? { model: stored.config.model } : {}) },
      ...(credentials ? { credentials } : {}),
      adapterState: this.options.state.getAdapterSessionState(runId, stored.adapterId),
      persistAdapterState: (state) => this.options.state.saveAdapterSessionState(runId, stored.adapterId, state),
    }, coalesceTextCheckpoints((event) => this.emit(runId, event)))
    this.sessions.set(runId, session)
    return session
  }

  /**
   * The provider credentials for a run. `undefined` means the run uses none
   * (no account bound, or this host does not fetch them); 'unavailable' means
   * the run cannot start, and the failure has already been reported.
   */
  private async runCredentials(runId: string, requested: boolean): Promise<Record<string, string> | undefined | 'unavailable'> {
    const fetchCredentials = this.options.controlPlane.fetchRunCredentials?.bind(this.options.controlPlane)
    // Only a host holding the run-credentials method (Overlay Cloud) asks, and only when the run says it has an account.
    if (!fetchCredentials || !this.options.fetchRunCredentials || !requested) return undefined
    try {
      return await fetchCredentials(runId)
    } catch (error) {
      const code = error instanceof ControlPlaneRequestError ? error.code : undefined
      // No account on this binding: nothing to inject, the run proceeds as configured.
      if (code === 'provider_account_missing') return undefined
      const needsSignIn = code === 'account_needs_reauth' || code === 'account_unavailable'
      await this.emit(runId, { type: 'failed', payload: {
        code: needsSignIn ? 'auth_required' : 'credentials_unavailable',
        message: needsSignIn
          ? 'This agent’s account needs to be reconnected in Settings → Agent accounts.'
          : 'The agent could not get its credentials. Try again.',
        retryable: !needsSignIn,
      } })
      this.logger.warn('run credentials unavailable', { runId, code: code ?? 'unknown' })
      return 'unavailable'
    }
  }

  private requireAdapter(adapterId: string): AgentAdapter {
    const adapter = this.adapters.get(adapterId)
    if (!adapter) throw new Error(`adapter is not installed: ${adapterId}`)
    return adapter
  }

  /**
   * Records an event and returns once it is durable on disk. Uploading happens in the background: an adapter that
   * reports progress never waits on the network, so slow or failing uploads cannot hold back the agent's own output.
   */
  private async emit(runId: string, event: NormalizedAgentEvent,
    execution = this.executions.get(runId)): Promise<void> {
    const stored: Omit<AgentHostEvent, 'sourceSequence'> = {
      protocolVersion: OVERLAY_AGENT_PROTOCOL_VERSION,
      ...(execution ? { execution } : {}),
      eventId: randomUUID(), environmentId: this.options.environmentId, runId,
      occurredAt: Date.now(), ...event,
    } as Omit<AgentHostEvent, 'sourceSequence'>
    this.options.state.appendOrReplaceTextCheckpoint(stored, this.inFlight.get(streamKey(runId, execution?.attemptId)) ?? 0)
    const currentExecution = this.executions.get(runId)
    if (this.options.durableLifecycle && execution?.attemptId === currentExecution?.attemptId
      && execution?.generation === currentExecution?.generation && ['completed', 'cancelled', 'failed'].includes(event.type)) this.terminalRuns.add(runId)
    this.scheduleFlush()
  }

  /** Stops background upload passes, e.g. when the host shuts down; queued events stay on disk for next start. */
  stopBackgroundUploads(): void {
    this.uploadsStopped = true
    if (this.flushRetry) clearTimeout(this.flushRetry)
    this.flushRetry = undefined
  }

  /** Starts an upload pass unless one is running (it drains new events too); retries failures with backoff. */
  private scheduleFlush(): void {
    if (this.uploadsStopped || this.flushing || this.flushRetry) return
    void this.flushOutbox().then(() => {
      this.flushFailures = 0
      // An event recorded while the pass was finishing would otherwise wait for the next poll.
      let queued = 0
      try { queued = this.options.state.outboxSize() } catch { return } // state closed: the host is shutting down
      if (queued > 0) this.scheduleFlush()
    }, (error) => {
      if (this.uploadsStopped || (error as NodeJS.ErrnoException)?.code === 'ERR_INVALID_STATE') return
      const delay = nextReconnectDelay(this.flushFailures++)
      this.logger.warn('event upload deferred', { error: safeError(error), retryInMs: delay })
      this.flushRetry = setTimeout(() => { this.flushRetry = undefined; this.scheduleFlush() }, delay)
      this.flushRetry.unref?.()
    })
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

function streamKey(runId: string, attemptId?: string) { return `${runId}\u0000${attemptId ?? ''}` }

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds)
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
  })
}
