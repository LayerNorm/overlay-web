import assert from 'node:assert/strict'
import {mkdtemp, realpath, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import type {AgentHostCommand, EventBatch, EventAcknowledgement, CommandAcknowledgement} from '@layernorm/overlay-agent-bridge-protocol'
import type {AgentAdapter} from './adapter'
import {FakeAgentAdapter} from './fake-adapter'
import {AgentHostRuntime} from './runtime'
import {SqliteHostStateStore} from './state'
import {StructuredLogger} from './logger'
import {nativePreparationFingerprint} from './native-start-preparation'
import {ControlPlaneRequestError} from './transport'

test('native startup drains durable source output and requires the exact server admission before calling adapter code', async t => {
  for (const response of ['admitted', 'missing', 'foreign_boot', 'foreign_attempt', 'foreign_generation', 'foreign_command', 'foreign_cursor', 'expired', 'source_outage', 'cancel_queued', 'cancel_polled', 'cancel_admission']) await t.test(response, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'native-start-barrier-')), root = await realpath(directory)
    const state = new SqliteHostStateStore(join(root, 'host.sqlite'))
    const prefix = 'Durable source output before the crash. 🙂\n'
    const applied: EventBatch[] = [], acknowledgements: CommandAcknowledgement[] = []
    let uploading: () => void = () => undefined
    const uploadEntered = new Promise<void>(resolve => {uploading = resolve})
    let releaseUpload: () => void = () => undefined
    const uploadPending = new Promise<void>(resolve => {releaseUpload = resolve})
    let sourceAcknowledged = false, starts = 0, runtime: AgentHostRuntime | undefined
    const fake = new FakeAgentAdapter()
    const adapter: AgentAdapter = {capability: {...fake.capability, recovery: {...fake.capability.recovery, fencedSessionRestoration: true}},
      discover: async () => adapter.capability, async start(input, emit) {
        starts++
        assert.equal(sourceAcknowledged, true)
        assert.ok(applied.some(batch => batch.events.some(event => event.type === 'native_start_requested')))
        await emit({type: 'text_checkpoint', payload: {text: 'New provider output'}})
        return Object.assign(await fake.start(input, emit), {initialPromptHandled: true})
      }}
    try {
      state.claimExecution('run', 'source')
      state.saveSession({runId: 'run', adapterId: 'fake', remoteSessionId: 'original-native', workingDirectory: root,
        execution: {attemptId: 'source', generation: 1, hostBootId: 'old-boot'}})
      state.appendEvent({protocolVersion: 1, eventId: 'source-tail', environmentId: 'environment', runId: 'run',
        occurredAt: 1, execution: {attemptId: 'source', generation: 1, hostBootId: 'old-boot'},
        type: 'text_checkpoint', payload: {text: prefix}})
      const command: AgentHostCommand = {protocolVersion: 1, commandId: 'restore', environmentId: 'environment', workspaceId: 'workspace',
        runId: 'run', sequence: 1, issuedAt: 2, execution: {attemptId: 'next', generation: 2}, type: 'start', payload: {
          bindingId: 'binding', adapterId: 'fake', workingDirectory: root, sessionId: 'original-native', prompt: 'Continue',
          metadata: {overlayNativeAdmission: 1, recoveryTextOffset: 0}, restore: {previousExecution: {
            attemptId: 'source', generation: 1, hostBootId: 'old-boot'},
            providerStop: {provider: 'box', leaseId: 'lease', providerReference: 'machine', observedAt: 2}}}}
      const cancel: AgentHostCommand = {...command, commandId: 'stop', sequence: 2, type: 'cancel', payload: {reason: 'user requested'}}
      let polls = 0
      runtime = new AgentHostRuntime({environmentId: 'environment', workspaceId: 'workspace', durableLifecycle: true,
        filesystem: {mode: 'selected_roots', roots: [root]}, adapters: [adapter], state, logger: new StructuredLogger(() => undefined), controlPlane: {
          pollCommands: async () => {
            if (++polls === 1) return {commands: [command, ...(response === 'cancel_queued' ? [cancel] : [])]}
            if (polls === 2 && (response === 'cancel_polled' || response === 'cancel_admission')) {await uploadEntered; return {commands: [command, cancel]}}
            return {commands: []}
          }, acknowledgeCommand: async value => {acknowledgements.push(value)},
          uploadEvents: async (batch): Promise<EventAcknowledgement> => {
            if (batch.events[0].execution?.attemptId === 'source') {
              if (response === 'source_outage') throw new ControlPlaneRequestError(503)
              if (response === 'cancel_polled') {uploading(); await uploadPending}
              sourceAcknowledged = true
            }
            applied.push(batch)
            const requested = batch.events.find(event => event.type === 'native_start_requested')
            const ack = {protocolVersion: 1 as const, accepted: true as const, acknowledgedSequence: batch.events.at(-1)?.sourceSequence ?? 0}
            if (!requested || requested.type !== 'native_start_requested' || response === 'missing') return ack
            assert.equal(sourceAcknowledged, true)
            assert.equal(requested.payload.sourceEventCursor, 1)
            if (response === 'cancel_admission') {uploading(); await uploadPending}
            return {...ack, nativeStartAdmission: {commandId: response === 'foreign_command' ? 'another-command' : 'restore',
              attemptId: response === 'foreign_attempt' ? 'another-attempt' : 'next', generation: response === 'foreign_generation' ? 3 : 2,
              hostBootId: response === 'foreign_boot' ? 'another-receiver' : requested.execution?.hostBootId ?? '',
              sourceEventCursor: response === 'foreign_cursor' ? 2 : 1, canonicalTextOffset: prefix.length,
              hardDeadlineAt: response === 'expired' ? Date.now() - 1 : Date.now() + 60000}}
          },
        }})
      if (response.startsWith('cancel_')) {
        await runtime.pollOnce(0)
        assert.equal(starts, 0, 'queued Stop must prevent provider startup while the source upload is waiting')
        assert.equal(state.getSession('run')?.execution?.attemptId, response === 'cancel_admission' ? 'next' : 'source')
        if (response === 'cancel_polled') assert.equal(state.pendingEvents(10)[0]?.eventId, 'source-tail', 'Stop retains the unacknowledged source output')
        if (response === 'cancel_admission') assert.equal(state.nativePreparationPending('restore', nativePreparationFingerprint(command)), false, 'interrupted startup admission cannot replay the local provider-start boundary')
        assert.equal(acknowledgements[0]?.accepted, false)
        assert.match(acknowledgements[0]?.error?.message ?? '', /stopped during preparation/)
        assert.equal(acknowledgements[1]?.commandId, 'stop')
        assert.equal(acknowledgements[1]?.accepted, true)
        assert.equal(state.commandCursor(), 2)
      } else if (response === 'admitted') {
        await runtime.processCommand(command)
        await runtime.run(AbortSignal.abort())
        assert.equal(starts, 1)
        const events = applied.flatMap(batch => batch.events)
        assert.ok(events.some(event => event.type === 'text_checkpoint' && event.payload.offset === prefix.length
          && event.payload.text === 'New provider output'))
        assert.ok(events.some(event => event.type === 'session_started' && event.payload.restorationCommandId === 'restore'))
      } else {
        await assert.rejects(runtime.processCommand(command), response === 'source_outage' ? /503/ : /admission was not acknowledged/)
        assert.equal(starts, 0)
        assert.equal(acknowledgements[0]?.error?.code, response === 'source_outage' ? 'native_preparation_retryable' : 'command_rejected')
        if (response === 'source_outage') {
          assert.equal(state.pendingEvents(10)[0]?.eventId, 'source-tail')
          assert.equal(state.getSession('run')?.execution?.attemptId, 'source', 'failed source drain cannot transfer the native identity')
        }
      }
      assert.equal(state.lastEventSequence('run', 'source'), 1, 'the durable source watermark survives outbox deletion')
    } finally {
      releaseUpload()
      await runtime?.run(AbortSignal.abort())
      state.close()
      await rm(directory, {recursive: true, force: true})
    }
  })
})
