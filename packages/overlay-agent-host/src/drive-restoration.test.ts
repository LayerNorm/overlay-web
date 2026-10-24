import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {driveRecoveryResultSchema, type DriveRecoveryResult, type DriveCredentialsResponse} from '@layernorm/overlay-agent-bridge-protocol'
import {AgentDriveClient} from './drive-client'
import {AgentDriveCache} from './drive-cache'
import {SqliteDriveJournal, type DriveJournalContext} from './drive-journal'
import {SqliteDriveSyncState} from './drive-sync-state'
import {AgentDriveSynchronizer} from './drive-sync'
import {settleInterruptedDrive} from './drive-restoration'

const scope = {kind: 'personal' as const, workspaceId: 'workspace', ownerUserId: 'owner'}
const previousExecution = {attemptId: 'source', generation: 1}
const context: DriveJournalContext = {environmentId: 'environment', runId: 'run', sessionId: 'source', scope, execution: previousExecution}
const nextContext: DriveJournalContext = {...context, sessionId: 'next', execution: {attemptId: 'next', generation: 2}}
const uploadId = '24b3d8ed-21b2-43f3-9617-000000000001'
const bytes = Buffer.from('An interrupted deliverable 🙂\n'.repeat(100))
const request = {action: 'upload' as const, requestId: 'interrupted-content-001', operation: {kind: 'create' as const, name: 'report.md'},
  sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length, mimeType: 'text/markdown'}
const result = {fileId: 'file', updatedAt: 2, name: 'report.md', conflict: false, objectStored: true,
  sha256: request.sha256, sizeBytes: request.sizeBytes}
const entry = {fileId: 'file', path: 'report.md', updatedAt: 2, kind: 'file' as const, hydration: 'ready' as const,
  sizeBytes: bytes.length, sha256: request.sha256, metadataMac: 'a'.repeat(43), downloadMac: 'b'.repeat(43)}
const metadataRequest = {action: 'metadata' as const, requestId: 'interrupted-metadata-001', operation: {kind: 'mkdir' as const, name: 'new-folder'}}

async function fixture(resolution: DriveRecoveryResult['resolution'], kind: 'content' | 'metadata' = 'content') {
  const directory = await mkdtemp(join(tmpdir(), 'drive-restoration-'))
  const cache = await AgentDriveCache.create(directory, 'cache')
  if (kind === 'content') await writeFile(join(cache.root, 'report.md'), bytes)
  else await mkdir(join(cache.root, 'new-folder'))
  const journalPath = join(directory, 'private', 'writes.sqlite')
  let journal = new SqliteDriveJournal(journalPath, context)
  const state = new SqliteDriveSyncState(join(directory, 'private', 'baseline.sqlite'), cache.root, scope)
  const target = (await cache.inventory())[0]
  if (!target) throw Error('Missing local file')
  const local = {path: target.path, identity: target.identity}
  state.write({phase: 'writing', initialized: true, baseline: [], turn: {runId: 'run', saved: []},
    operation: kind === 'content' ? {kind: 'content', request, target: local} : {kind: 'metadata', request: metadataRequest, target: local}})
  if (kind === 'content') journal.prepareContent(request, bytes)
  else journal.prepareMetadata(metadataRequest)
  const actions: string[] = []
  let failure = false, wrongExecution = false
  let remoteChange: 'none' | 'edited' | 'deleted' = 'none'
  const client = new AgentDriveClient({apiUrl: 'https://preview.invalid/api/agent-drive',
    credentials: async (): Promise<DriveCredentialsResponse> => ({protocolVersion: 1, scope, expiresAt: Date.now() + 60000,
      token: `ovdrive_${'x'.repeat(32)}.${'y'.repeat(43)}`}),
    fetch: async (_input, init) => {
      const body = JSON.parse(String(init?.body))
      actions.push(body.action)
      if (failure) return Response.json({error: 'DRIVE_BACKEND_UNAVAILABLE'}, {status: 503})
      if (body.action === 'recover') return Response.json({requestId: body.requestId,
        previousExecution: wrongExecution ? {attemptId: 'foreign', generation: 1} : previousExecution, resolution})
      assert.equal(body.action, 'manifest', 'Recovery cannot replay an upload, commit or metadata write')
      const visible = kind === 'content' ? entry : {fileId: 'folder', path: 'new-folder', updatedAt: 2, kind: 'folder', metadataMac: 'a'.repeat(43)}
      const entries = remoteChange === 'deleted' ? [] : [remoteChange === 'edited' ? {...visible, updatedAt: 3} : visible]
      return new Response([{type: 'manifest', version: 1}, ...entries.map(entry => ({type: 'entry', entry})), {type: 'complete', entries: entries.length}]
        .map(frame => JSON.stringify(frame) + '\n').join(''))
    }})
  const settle = (interrupt = false) => settleInterruptedDrive({previousExecution, journal, state, client,
    synchronizer: interrupt ? {settlePreviousWrite: async () => {throw Error('simulated crash after outcome')}}
      : new AgentDriveSynchronizer({runId: 'run', cache, client, journal, state})})
  return {directory, journalPath, state, cache, client, actions, settle,
    changeRemote: (change: typeof remoteChange) => {remoteChange = change},
    get journal() {return journal}, fail: () => {failure = true}, mismatch: () => {wrongExecution = true},
    reopen: () => {journal.close(); journal = new SqliteDriveJournal(journalPath, context)},
    clean: async () => {journal.close(); state.close(); await rm(directory, {recursive: true, force: true})}}
}

test('lost intent and commit acknowledgements settle the original upload identity and baseline without replaying a write', async () => {
  for (const phase of ['queued', 'committing']) {
    const f = await fixture({state: 'content_committed', uploadId, result})
    try {
      if (phase === 'committing') {
        f.journal.advanceContent(request.requestId, 'intent', uploadId)
        f.journal.advanceContent(request.requestId, 'uploaded', uploadId)
        f.journal.advanceContent(request.requestId, 'committing', uploadId)
      }
      await f.settle()
      assert.deepEqual(f.actions, ['recover', 'manifest'])
      assert.equal(f.state.read().phase, 'idle')
      assert.deepEqual(f.state.read().turn?.saved, [{fileId: 'file', path: 'report.md', kind: 'file'}])
      assert.equal(f.journal.find(request.requestId), undefined)
      assert.deepEqual(await readFile(join(f.cache.root, 'report.md')), bytes)
      const next = new SqliteDriveJournal(f.journalPath, nextContext)
      next.close()
    } finally {await f.clean()}
  }
})

test('definitive uncommitted outcome archives immutable bytes, fences replay and permits a new execution without adopting the old request', async () => {
  const f = await fixture({state: 'uncommitted'})
  try {
    await f.settle()
    assert.deepEqual(f.actions, ['recover'])
    assert.equal(f.state.read().phase, 'idle')
    assert.deepEqual(Buffer.from(f.journal.content(request.requestId)), bytes)
    assert.equal(f.journal.recoveryOutcome(request.requestId)?.resolution.state, 'uncommitted')
    assert.throws(() => f.journal.prepareContent(request, bytes), /REQUEST_FENCED/)
    assert.throws(() => f.journal.advanceContent(request.requestId, 'intent', uploadId), /REQUEST_FENCED/)
    assert.throws(() => f.journal.commitContent(request.requestId, uploadId, result), /REQUEST_FENCED/)
    f.reopen()
    assert.deepEqual(Buffer.from(f.journal.content(request.requestId)), bytes)
    const next = new SqliteDriveJournal(f.journalPath, nextContext)
    try {
      assert.equal(next.pending().length, 0)
      assert.throws(() => next.find(request.requestId), /EXECUTION_CHANGED/)
      assert.equal(next.prepareContent({...request, requestId: 'new-execution-request-001'}, bytes).phase.kind, 'queued')
    } finally {next.close()}
  } finally {await f.clean()}
})

test('reopening converges after the outcome was durable but baseline settlement was interrupted', async () => {
  for (const resolution of [{state: 'uncommitted' as const}, {state: 'content_committed' as const, uploadId, result}]) {
    const f = await fixture(resolution)
    try {
      await assert.rejects(f.settle(true), /simulated crash/)
      assert.equal(f.state.read().phase, 'writing')
      f.reopen()
      await f.settle()
      assert.equal(f.state.read().phase, 'idle')
      assert.equal(f.actions.filter(action => action === 'recover').length, 1)
      assert.equal(f.actions.some(action => ['upload', 'commit', 'metadata'].includes(action)), false)
    } finally {await f.clean()}
  }
})

test('unavailable or mismatched outcomes keep the complete pending intent and baseline unchanged', async () => {
  for (const mode of ['unavailable', 'foreign']) {
    const f = await fixture({state: 'uncommitted'})
    try {
      const before = f.state.read()
      if (mode === 'unavailable') f.fail(); else f.mismatch()
      await assert.rejects(f.settle())
      assert.deepEqual(f.state.read(), before)
      assert.equal(f.journal.pending().length, 1)
      assert.deepEqual(Buffer.from(f.journal.content(request.requestId)), bytes)
      assert.equal(f.journal.recoveryOutcome(request.requestId), undefined)
      assert.throws(() => new SqliteDriveJournal(f.journalPath, nextContext), /UNSAVED_OTHER_EXECUTION/)
    } finally {await f.clean()}
  }
})

test('durable recovery outcome cannot be changed to a contradictory receipt', async () => {
  const f = await fixture({state: 'uncommitted'})
  try {
    await f.settle()
    const outcome = driveRecoveryResultSchema.parse({requestId: request.requestId, previousExecution,
      resolution: {state: 'content_committed', uploadId, result}})
    assert.throws(() => f.journal.settleRecovery(request.requestId, outcome), /RECEIPT_CHANGED/)
    assert.deepEqual(Buffer.from(f.journal.content(request.requestId)), bytes)
  } finally {await f.clean()}
})

test('metadata receipt and definitive noncommit both converge after interruption without repeating a folder creation', async () => {
  for (const resolution of [{state: 'uncommitted' as const},
    {state: 'metadata_committed' as const, result: {fileId: 'folder', updatedAt: 2}}]) {
    const f = await fixture(resolution, 'metadata')
    try {
      await assert.rejects(f.settle(true), /simulated crash/)
      f.reopen()
      await f.settle()
      assert.equal(f.state.read().phase, 'idle')
      assert.equal(f.actions.filter(action => action === 'recover').length, 1)
      assert.equal(f.actions.some(action => ['upload', 'commit', 'metadata'].includes(action)), false)
      if (resolution.state === 'metadata_committed') {
        assert.deepEqual(f.state.read().turn?.saved, [{fileId: 'folder', path: 'new-folder', kind: 'folder'}])
        assert.equal(f.journal.find(metadataRequest.requestId), undefined)
      } else {
        assert.equal(f.journal.find(metadataRequest.requestId)?.kind, 'metadata')
        assert.throws(() => f.journal.advanceMetadata(metadataRequest.requestId), /REQUEST_FENCED/)
      }
    } finally {await f.clean()}
  }
})


test('later remote edits and deletion cannot trap acknowledged content or metadata in writing', async () => {
  for (const kind of ['content', 'metadata'] as const) for (const change of ['edited', 'deleted'] as const) {
    const resolution: DriveRecoveryResult['resolution'] = kind === 'content'
      ? {state: 'content_committed', uploadId, result}
      : {state: 'metadata_committed', result: {fileId: 'folder', updatedAt: 2}}
    const f = await fixture(resolution, kind)
    try {
      f.changeRemote(change)
      if (kind === 'content') await writeFile(join(f.cache.root, 'report.md'), 'Keep my later local edit')
      await f.settle()
      assert.equal(f.state.read().phase, 'idle')
      assert.equal(f.journal.pending().length, 0)
      if (kind === 'content') {
        assert.equal(await readFile(join(f.cache.root, 'report.md'), 'utf8'), 'Keep my later local edit')
        assert.equal(f.state.read().baseline.some(row => row.local?.path === 'report.md'), false,
          'Later local edits must create a separate file, never adopt the newer remote revision')
      }
    } finally {await f.clean()}
  }
})
