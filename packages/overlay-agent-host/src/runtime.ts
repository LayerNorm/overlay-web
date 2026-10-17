import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { setTimeout as wait } from 'node:timers/promises'
import { agentSettingsSchema } from './acp-settings.js'
import {
  eventBatchSchema,
  OVERLAY_AGENT_PROTOCOL_VERSION,
  type AgentHostCommand,
  type AgentHostEvent,
  type FilesystemGrant,
  driveStartDescriptorSchema,
  filesystemGrantSchema,
} from '@layernorm/overlay-agent-bridge-protocol'
import { createRuntimeDrive, type RuntimeDrive } from './runtime-drive.js'
import { RuntimeDriveController } from './runtime-drive-controller.js'
import {createNativeTerminalIntent, observeActiveNativeRuns, withNativeTerminalBoundary} from './runtime-terminal-boundary.js'
import { HostHeartbeat } from './host-heartbeat.js'
import { buildHostCapabilities, updateHostCapabilities } from './host-capabilities.js'
import { PendingHostPrompts, quiesceHostRuns } from './runtime-shutdown.js'
import {withRunPreparation} from './run-preparation.js'
import {fetchProviderRunCredentials} from './provider-run-credentials.js'
import {requireNativeRestorationSource} from './native-restoration.js'
import {admitHostSession} from './runtime-session-admission.js'
import {nativePreparationFingerprint} from './native-start-preparation.js'
import {drainNativeSource, requestNativeStart} from './native-start-barrier.js'
import {OutboxReceipts} from './outbox-receipts.js'
import {processPolledCommands} from './preparation-command-polling.js'
import {processHostCommand} from './process-host-command.js'
import type { AgentAdapter, AgentAdapterSession, EmitAgentEvent, NormalizedAgentEvent } from './adapter.js'
import { resolveFilesystemScope } from './filesystem-policy.js'
import { packEventBatch, shrinkOversizedEvent } from './outbox-packing.js'
import { createRunStream } from './run-stream.js'
import { StructuredLogger } from './logger.js'
import { SqliteHostStateStore } from './state.js'
import type { AgentControlPlaneClient } from './transport.js'
import { nextReconnectDelay } from './transport.js'

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
  drive?: { stateDirectory: string; apiUrl: string; create?: typeof createRuntimeDrive; syncIntervalMs?: number; fetch?: typeof globalThis.fetch }
}

export class AgentHostRuntime {
  private readonly nativePreparations = new Map<string, {fingerprint: string; work: Promise<void>}>()
  private readonly adapters: Map<string, AgentAdapter>
  private readonly sessions = new Map<string, AgentAdapterSession>()
  private readonly logger: StructuredLogger
  private flushing?: Promise<void>
  private readonly outboxReceipts = new OutboxReceipts()
  /** Highest sequence being uploaded per event stream; queued checkpoints above it may still be replaced. */
  private readonly inFlight = new Map<string, number>()
  private flushRetry?: ReturnType<typeof setTimeout>
  private flushFailures = 0
  private outboxWarned = false
  private uploadsStopped = false
  private streamingNegotiated = false
  private readonly streams = new Map<string, ReturnType<typeof createRunStream>>()
  private readonly terminalRuns = new Set<string>()
  private readonly hostHeartbeat: HostHeartbeat
  private nextCapabilityRefreshAt = 0
  private capabilityRefresh: Promise<void> | undefined
  private readonly bootId = randomUUID()
  private readonly executions = new Map<string, { attemptId: string; generation: number; hostBootId?: string }>()
  private resolvedThroughSequence = 0
  private readonly drives = new Map<string, RuntimeDriveController>()
  private shuttingDown = false
  private shutdownDrained = false
  private readonly prompts = new PendingHostPrompts(error => this.logger.warn('prompt callbacks failed', {error: safeError(error)}))

  get canCloseState(): boolean { return this.shutdownDrained }

  constructor(private readonly options: AgentHostRuntimeOptions) {
    this.adapters = new Map(options.adapters.map((adapter) => [adapter.capability.id, adapter]))
    this.logger = options.logger ?? new StructuredLogger()
    this.hostHeartbeat = new HostHeartbeat(() => this.heartbeat())
  }

  updateFilesystemGrant(grant: FilesystemGrant): void {
    this.options.filesystem = filesystemGrantSchema.parse(grant)
  }

  async discoverCapabilities() {
    // Authenticated starts already captured the live catalog. Publish it without probing or replacing auth files during work.
    if (this.options.fetchRunCredentials && [...this.sessions.keys()].some(runId => !this.terminalRuns.has(runId))) return [...this.adapters.values()].map(adapter => adapter.capability)
    const root = this.options.filesystem.mode === 'all_user_files' ? homedir() : this.options.filesystem.roots[0]
    return Promise.all([...this.adapters.values()].map(async adapter => {
      if (!root) return adapter.capability
      let credentials: Record<string, string> | undefined
      if (this.options.fetchRunCredentials && this.options.controlPlane.fetchDiscoveryCredentials) {
        try { credentials = await this.options.controlPlane.fetchDiscoveryCredentials(adapter.capability.id) }
        catch {
          this.logger.warn('adapter option credentials unavailable; keeping fallback catalog', { adapterId: adapter.capability.id })
          return adapter.capability
        }
      }
      return adapter.discover({ workingDirectory: root, ...(credentials ? { credentials } : {}) })
    }))
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
    this.streamingNegotiated = response.streaming?.textDeltas === true && response.streaming.heartbeats === true
    if (response.resolvedThroughSequence !== undefined)
      this.resolvedThroughSequence = Math.max(this.resolvedThroughSequence, response.resolvedThroughSequence)
    await processPolledCommands({commands: response.commands, ...(signal ? {signal} : {}),
      process: (command, preparationSignal) => this.processCommand(command, preparationSignal),
      poll: signal => this.options.controlPlane.pollCommands({waitMs: 25_000, signal}),
      received: next => {if (next.resolvedThroughSequence !== undefined) this.resolvedThroughSequence = Math.max(this.resolvedThroughSequence, next.resolvedThroughSequence)},
      onError: error => this.logger.warn('preparation command polling deferred', {error: safeError(error)}),
    })
    this.scheduleFlush()
    return response.retryAfterMs ?? 0
  }

  async run(signal: AbortSignal): Promise<void> {
    let attempt = 0
    const abort = () => { this.shuttingDown = true }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    try {
      if (signal.aborted) return
      await this.refreshHostState()
      this.hostHeartbeat.start(signal, error => this.logger.warn('host heartbeat deferred', { error: safeError(error) }))
      while (!signal.aborted) {
        try {
          if (Date.now() >= this.nextCapabilityRefreshAt) this.scheduleCapabilityRefresh()
          if (this.hostHeartbeat.due()) await this.hostHeartbeat.send()
          const retryAfterMs = await this.pollOnce(25_000, signal)
          attempt = 0
          if (retryAfterMs > 0) await wait(retryAfterMs, undefined, {signal})
        } catch (error) {
          if (signal.aborted) break
          const delay = nextReconnectDelay(attempt++)
          this.logger.warn('agent host poll failed', { error: safeError(error), delay })
          await wait(delay, undefined, {signal}).catch(() => undefined)
        }
      }
    } finally {
      this.shuttingDown = true
      const heartbeatStopped = this.hostHeartbeat.stop()
      try {
        await quiesceHostRuns({sessions: this.sessions.values(), prompts: this.prompts, streams: this.streams.values(), drives: this.drives.values()})
        await heartbeatStopped
        await this.capabilityRefresh
        this.stopBackgroundUploads()
        await this.flushing?.catch(error => this.logger.warn('queued events retained during shutdown', {error: safeError(error)}))
        this.shutdownDrained = true
      } finally { this.stopBackgroundUploads(); await heartbeatStopped; signal.removeEventListener('abort', abort) }
    }
  }

  private async refreshHostState(): Promise<void> {
    if (this.options.controlPlane.updateCapabilities) {
      const capabilities = buildHostCapabilities(await this.discoverCapabilities(), {
        durableLifecycle: this.options.durableLifecycle === true, drive: Boolean(this.options.drive),
        filesystem: this.options.filesystem, maxConcurrentRuns: this.adapters.size,
      })
      await updateHostCapabilities(this.options.controlPlane, capabilities)
    }
    const missingCloudCatalog = this.options.fetchRunCredentials && [...this.adapters.values()].some(adapter => !adapter.capability.options)
    this.nextCapabilityRefreshAt = Date.now() + (missingCloudCatalog ? 60_000 : 24 * 60 * 60_000)
    await this.hostHeartbeat.send()
  }

  private scheduleCapabilityRefresh(): void {
    if (this.capabilityRefresh || this.uploadsStopped || this.shuttingDown) return
    this.capabilityRefresh = this.refreshHostState().catch(error => {
      this.nextCapabilityRefreshAt = Date.now() + 60_000
      this.logger.warn('adapter options refresh deferred', { error: safeError(error) })
    }).finally(() => { this.capabilityRefresh = undefined })
  }

  private async heartbeat(): Promise<void> {
    await this.options.controlPlane.heartbeat?.()
    if (this.options.durableLifecycle) await observeActiveNativeRuns(this.sessions, this.executions, this.terminalRuns,
      (runId, process, execution) => this.emit(runId, {type: 'process_observation', payload: {process}}, execution))
  }

  async processCommand(command: AgentHostCommand, preparationSignal?: AbortSignal): Promise<void> {
    const execute = () => processHostCommand({command, state: this.options.state, environmentId: this.options.environmentId,
      workspaceId: this.options.workspaceId, errorMessage: safeError, shuttingDown: this.shuttingDown, resolvedThroughSequence: this.resolvedThroughSequence,
      dispatch: command => this.dispatch(command, preparationSignal), acknowledge: (command, accepted, message, code) => this.acknowledge(command, accepted, message, code)})
    if (command.type !== 'start' || !command.payload.restore || !command.execution) return execute()
    const fingerprint = nativePreparationFingerprint(command), active = this.nativePreparations.get(command.commandId)
    if (active) {
      if (active.fingerprint !== fingerprint) throw Error('Native preparation command changed during startup')
      return active.work
    }
    const work = Promise.resolve().then(execute)
    this.nativePreparations.set(command.commandId, {fingerprint, work})
    try {await work} finally {this.nativePreparations.delete(command.commandId)}
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
      if (this.shuttingDown && this.uploadsStopped) return
      const events = this.options.state.pendingUploadEvents(100)
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
        const attempted = this.options.state.uploadAttemptWatermark(batch.runId, batch.events[0].execution?.attemptId)
        if (acknowledgement.acknowledgedSequence < lastSentSequence || acknowledgement.acknowledgedSequence > attempted) {
          throw new Error(`server acknowledged ${acknowledgement.acknowledgedSequence}, expected ${lastSentSequence}`)
        }
        this.options.state.acknowledgeEvents(batch.runId, acknowledgement.acknowledgedSequence, batch.events[0].execution?.attemptId)
        this.outboxReceipts.record(acknowledgement)
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

  private async dispatch(command: AgentHostCommand, preparationSignal?: AbortSignal): Promise<void> {
    this.acceptExecutionFence(command)
    if (command.type === 'observe') {
      const session = this.sessions.get(command.runId)
      await this.emit(command.runId, { type: 'process_observation', payload: { process: session ? await session.observe?.() ?? 'unknown' : 'unknown' } })
      return
    }
    if (command.type === 'start') { await this.startSession(command, preparationSignal); return }
    if (command.type === 'shutdown') {
      const session = this.sessions.get(command.runId)
      if (session) await session.stop(command.payload.reason)
      await this.drives.get(command.runId)?.closeAfterStopped()
      this.drives.delete(command.runId)
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
      this.prompts.track(session.prompt(command.payload.prompt).catch(error => this.emit(command.runId,
        { type: 'failed', payload: { code: 'adapter_prompt_failed', message: safeError(error), retryable: true } }, execution)))
    }
    else if (command.type === 'approval_response') await session.approve(command.payload.requestKey, command.payload.optionId)
    else if (command.type === 'elicitation_response') await session.elicit(command.payload.requestKey, command.payload.action, command.payload.content)
    else if (command.type === 'cancel') await session.cancel(command.payload.reason)
    else if (command.type === 'reconnect') {
      const stored = this.options.state.getSession(command.runId)
      if (command.execution && stored && this.requireAdapter(stored.adapterId).capability.protocol === 'eve') {
        const process = await session.observe?.() ?? 'unknown'
        await this.emit(command.runId, { type: 'process_observation', payload: { process, recoveryOutcome: process === 'live' ? 'attached_live' : 'unavailable' } })
        if (process === 'live') this.prompts.track(session.resume().catch(error => this.emit(command.runId, { type: 'failed', payload: { code: 'native_stream_unavailable', message: safeError(error), retryable: true } })))
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
    const restoring = command.type === 'start' && command.payload.restore
    if (restoring && command.type === 'start') {
      if (this.sessions.has(command.runId)) throw Error('Cannot restore over a live session')
      requireNativeRestorationSource(command, this.options.state.getSession(command.runId))
    }
    const previous = this.executions.get(command.runId) ?? this.options.state.getSession(command.runId)?.execution
    const replacesPrevious = previous && (previous.attemptId !== command.execution.attemptId || previous.generation !== command.execution.generation)
    // The server only emits `fresh` on an explicit start_fresh: that user action is the
    // proof-of-intent that authorizes replacing a persisted execution whose writer state
    // is unknown (e.g. this host restarted while a detached adapter child was running).
    if (replacesPrevious && !restoring && !(command.type === 'start' && command.payload.fresh === true))
      throw new Error('execution replacement requires proof that the old writer stopped')
    this.executions.set(command.runId, { ...command.execution, hostBootId: this.bootId })
    if (replacesPrevious) this.terminalRuns.delete(command.runId)
  }

  private async startSession(command: Extract<AgentHostCommand, { type: 'start' }>, preparationSignal?: AbortSignal): Promise<void> {
    const execution = this.executions.get(command.runId)
    return withRunPreparation({
      enabled: Boolean(this.options.durableLifecycle && command.execution && command.payload.metadata.overlayPreparation === 1),
      active: () => !this.shuttingDown && !preparationSignal?.aborted,
      emit: () => this.emit(command.runId, {type: 'session_preparing', payload: {}}, execution),
      onError: error => this.logger.warn('run preparation heartbeat deferred', {runId: command.runId, error: safeError(error)}),
    }, () => this.initializeSession(command, preparationSignal))
  }

  private async initializeSession(command: Extract<AgentHostCommand, { type: 'start' }>, preparationSignal?: AbortSignal): Promise<void> {
    preparationSignal?.throwIfAborted()
    const adapter = this.requireAdapter(command.payload.adapterId)
    const admission = await admitHostSession({command, adapter, state: this.options.state, sessions: this.sessions})
    if (admission.kind === 'already-active') return
    const {settings, offset, restored} = admission
    let canonicalOffset = offset
    const credentials = await this.runCredentials(command.runId, command.payload.metadata.runCredentials === true, Boolean(restored))
    if (credentials === 'unavailable') return
    preparationSignal?.throwIfAborted()
    const drive = await this.prepareDrive(command)
    const scope = drive ? { workingDirectory: drive.workingDirectory, additionalDirectories: drive.additionalDirectories }
      : await resolveFilesystemScope(this.options.filesystem, command.payload.workingDirectory)
    if (restored && scope.workingDirectory !== restored.workingDirectory) {
      await drive?.close()
      throw Error('Native restoration cannot change its original working directory')
    }
    if (this.shuttingDown || preparationSignal?.aborted) {await drive?.close(); preparationSignal?.throwIfAborted(); throw Error('Host stopped before provider start')}
    if (restored && command.execution) {
      try {
        if (command.payload.metadata.overlayNativeAdmission === 1) await drainNativeSource({command, state: this.options.state,
          receipts: this.outboxReceipts, flush: () => this.flushOutbox(), signal: preparationSignal})
        preparationSignal?.throwIfAborted()
        this.options.state.enterNativeProviderStart({commandId: command.commandId, fingerprint: nativePreparationFingerprint(command),
        previous: restored, nextExecution: {...command.execution, hostBootId: this.bootId}})
        if (command.payload.metadata.overlayNativeAdmission === 1) canonicalOffset = await requestNativeStart({command,
          state: this.options.state, hostBootId: this.bootId, receipts: this.outboxReceipts,
          emit: event => this.emit(command.runId, event), flush: () => this.flushOutbox(), signal: preparationSignal})
      }
      catch (error) {await drive?.close(); throw error}
    }
    if (this.shuttingDown || preparationSignal?.aborted) {await drive?.close(); preparationSignal?.throwIfAborted(); throw Error('Host stopped before provider start')}
    // Bind callbacks before adapter code can emit, including during old-session teardown.
    const execution = this.executions.get(command.runId)
    const emit = this.createStream(command.runId, execution, drive, canonicalOffset)
    const session = await adapter.start({
      onNativeTurnEnded: createNativeTerminalIntent({execution, currentExecution: () => this.executions.get(command.runId),
        shuttingDown: () => this.shuttingDown, markEnded: () => {this.terminalRuns.add(command.runId)}}),
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
    this.scheduleCapabilityRefresh()
    this.options.state.saveSession({ runId: command.runId, adapterId: command.payload.adapterId, remoteSessionId: session.remoteSessionId, workingDirectory: scope.workingDirectory,
      config: { version: 1, configReference: command.payload.bindingId, toolsReference: command.runId, ...settings },
      ...(command.execution ? { execution: { ...command.execution, hostBootId: this.bootId } } : {}),
    })
    await this.emit(command.runId, { type: 'session_started', payload: { remoteSessionId: session.remoteSessionId, adapterId: command.payload.adapterId,
      ...(restored ? {restorationCommandId: command.commandId} : {}) } })
    if (!this.shuttingDown && !preparationSignal?.aborted && !session.initialPromptHandled) {
      this.prompts.track(session.prompt(command.payload.prompt).catch((error) => emit({ type: 'failed', payload: { code: 'adapter_prompt_failed', message: safeError(error), retryable: true } })))
    }
    return
  }


  private async prepareDrive(command: Extract<AgentHostCommand, { type: 'start' }>): Promise<RuntimeDrive | undefined> {
    const input = command.payload.metadata.overlayDrive
    if (input === undefined) return undefined
    const descriptor = driveStartDescriptorSchema.parse(input)
    const options = this.options.drive, controlPlane = this.options.controlPlane
    if (!options || !controlPlane.refreshFilesystemGrant || !controlPlane.fetchDriveCredentials) throw Error('DRIVE_HOST_UPGRADE_REQUIRED')
    const fetchDriveCredentials = controlPlane.fetchDriveCredentials.bind(controlPlane)
    this.options.filesystem = await controlPlane.refreshFilesystemGrant()
    const execution = this.executions.get(command.runId)
    const request = { runId: command.runId, sessionId: descriptor.sessionId,
      ...(execution ? { execution: { attemptId: execution.attemptId, generation: execution.generation } } : {}) }
    return (options.create ?? createRuntimeDrive)({ environmentId: this.options.environmentId, workspaceId: this.options.workspaceId,
      ...request, location: descriptor.location, filesystem: this.options.filesystem,
      ...(command.payload.restore ? {previousExecution: {attemptId: command.payload.restore.previousExecution.attemptId,
        generation: command.payload.restore.previousExecution.generation}} : {}),
      approvedWorkingDirectory: command.payload.workingDirectory, stateDirectory: options.stateDirectory, apiUrl: options.apiUrl,
      credentials: () => fetchDriveCredentials(request), ...(options.fetch ? {fetch: options.fetch} : {}),
    })
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
      onNativeTurnEnded: createNativeTerminalIntent({execution: this.executions.get(runId), currentExecution: () => this.executions.get(runId),
        shuttingDown: () => this.shuttingDown, markEnded: () => {this.terminalRuns.add(runId)}}),
      runId, workingDirectory: scope.workingDirectory, additionalDirectories: scope.additionalDirectories,
      prompt: '', remoteSessionId: stored.remoteSessionId, metadata: agentSettingsSchema.parse(stored.config ?? {}),
      ...(credentials ? { credentials } : {}),
      adapterState: this.options.state.getAdapterSessionState(runId, stored.adapterId),
      persistAdapterState: (state) => this.options.state.saveAdapterSessionState(runId, stored.adapterId, state),
    }, this.createStream(runId))
    this.sessions.set(runId, session)
    this.scheduleCapabilityRefresh()
    return session
  }

  private runCredentials(runId: string, requested: boolean, retryPreparation = false) {
    const execution = this.executions.get(runId)
    return fetchProviderRunCredentials({runId, requested: Boolean(this.options.fetchRunCredentials && requested),
      retryPreparation, client: this.options.controlPlane, emit: event => this.emit(runId, event, execution), logger: this.logger})
  }

  private requireAdapter(adapterId: string): AgentAdapter {
    const adapter = this.adapters.get(adapterId)
    if (!adapter) throw new Error(`adapter is not installed: ${adapterId}`)
    return adapter
  }

  private createStream(runId: string, execution = this.executions.get(runId), drive?: RuntimeDrive, textBaseOffset?: number): EmitAgentEvent {
    this.streams.get(runId)?.stop()
    const negotiated = this.streamingNegotiated
    const stream = createRunStream(event => this.emit(runId, event, execution), {
      streaming: () => negotiated,
      textBaseOffset,
      active: () => this.sessions.has(runId) && !this.terminalRuns.has(runId),
      observe: async () => await this.sessions.get(runId)?.observe?.() ?? 'unknown',
      onError: error => this.logger.warn('run heartbeat deferred', { runId, error: safeError(error) }),
    })
    this.streams.set(runId, stream)
    let forward: EmitAgentEvent = stream.emit
    if (drive) {
      const controller = new RuntimeDriveController(drive, stream.emit, this.options.drive?.syncIntervalMs)
      this.drives.set(runId, controller)
      forward = controller.emit
    }
    return withNativeTerminalBoundary({forward, execution, currentExecution: () => this.executions.get(runId),
      shuttingDown: () => this.shuttingDown, markEnded: () => {this.terminalRuns.add(runId)}})
  }

  /**
   * Records an event and returns once it is durable on disk. Uploading happens in the background: an adapter that
   * reports progress never waits on the network, so slow or failing uploads cannot hold back the agent's own output.
   */
  private async emit(runId: string, event: NormalizedAgentEvent,
    execution = this.executions.get(runId)): Promise<void> {
    if (this.shuttingDown && ['completed', 'failed', 'cancelled'].includes(event.type)) return
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
    for (const stream of this.streams.values()) stream.stop()
    for (const drive of this.drives.values()) drive.stopScheduling()
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
