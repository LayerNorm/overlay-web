import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createRuntimeDrive, type RuntimeDrive } from './runtime-drive'
import type { DriveCredentialsResponse } from '@layernorm/overlay-agent-bridge-protocol'
import {SqliteDriveJournal} from './drive-journal'
import {DriveRequestError} from './drive-client'

const scope = { kind: 'personal' as const, workspaceId: 'workspace', ownerUserId: 'owner' }
const credential = (): DriveCredentialsResponse => ({ protocolVersion: 1, scope, expiresAt: Date.now() + 3600000,
  token: `ovdrive_${'x'.repeat(32)}.${'y'.repeat(43)}` })
const emptyManifest = () => new Response('{"type":"manifest","version":1}\n{"type":"complete","entries":0}\n')
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'runtime-drive-')), project = join(directory, 'project')
  await mkdir(project)
  await writeFile(join(project, 'original.txt'), 'outside the dedicated drive')
  const options = { environmentId: 'environment', workspaceId: 'workspace', runId: 'run', sessionId: 'session',
    location: 'approved-root' as const, approvedWorkingDirectory: project,
    filesystem: { mode: 'selected_roots' as const, roots: [project] }, stateDirectory: join(directory, 'private'),
    apiUrl: 'https://preview.invalid/api/agent-drive', credentials: async () => credential(), fetch: async () => emptyManifest() }
  return { directory, project, options, clean: () => rm(directory, { recursive: true, force: true }) }
}

test('runtime drive consumes renewed scope, hydrates before returning and holds ownership through close', async () => {
  const f = await fixture()
  let drive: RuntimeDrive | undefined
  try {
    drive = await createRuntimeDrive(f.options)
    assert.equal(drive.workingDirectory.startsWith(join(await realpath(f.project), '.overlay-drive-')), true)
    assert.deepEqual(await drive.sync(true), [])
    assert.equal(await readFile(join(f.project, 'original.txt'), 'utf8'), 'outside the dedicated drive')
    await assert.rejects(createRuntimeDrive(f.options), /DRIVE_CACHE_BUSY/)
    await drive.close()
    await drive.close()
    await assert.rejects(drive.sync(), /DRIVE_CLOSED/)
    drive = await createRuntimeDrive(f.options)
    assert.deepEqual(await drive.sync(true), [])
  } finally { await drive?.close(); await f.clean() }
})

test('failed hydration releases ownership so the same execution can retry without a new folder', async () => {
  const f = await fixture()
  try {
    await assert.rejects(createRuntimeDrive({ ...f.options, fetch: async () => new Response(null, { status: 503 }) }), /503/)
    const drive = await createRuntimeDrive(f.options)
    await drive.close()
  } finally { await f.clean() }
})

test('runtime restoration settles the original write before hydration and saves only definitively uncommitted bytes with a new request', async () => {
  for (const outcome of ['committed', 'uncommitted', 'uncommitted-with-retry']) {
    const f = await fixture()
    let drive: RuntimeDrive | undefined
    const content = Buffer.from('Retain the complete interrupted file 🙂\n')
    const sha256 = createHash('sha256').update(content).digest('hex')
    const result = {fileId: 'saved-file', updatedAt: 2, name: 'report.md', conflict: false, objectStored: true, sha256, sizeBytes: content.length}
    const sourceUpload = '24b3d8ed-21b2-43f3-9617-000000000001', nextUpload = '24b3d8ed-21b2-43f3-9617-000000000002'
    const intents: string[] = [], commits: string[] = []
    let restored = false, published = false, recovered = false, recoveryReads = 0, lostRetry = false
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (String(input) === 'https://storage.invalid/staging') return new Response(null)
      const body = JSON.parse(String(init?.body))
      if (body.action === 'manifest') return new Response([{type: 'manifest', version: 1}, ...(published ? [{type: 'entry', entry: {
        fileId: result.fileId, path: 'report.md', updatedAt: 2, kind: 'file', hydration: 'ready', sha256, sizeBytes: content.length,
        metadataMac: 'a'.repeat(43), downloadMac: 'b'.repeat(43)}}] : []), {type: 'complete', entries: published ? 1 : 0}]
        .map(frame => JSON.stringify(frame) + '\n').join(''))
      if (body.action === 'recover') {
        assert.equal(restored, true); assert.equal(body.requestId, intents[0])
        recovered = true; recoveryReads++
        return Response.json({requestId: body.requestId, previousExecution: {attemptId: 'source', generation: 1},
          resolution: outcome === 'committed' ? {state: 'content_committed', uploadId: sourceUpload, result} : {state: 'uncommitted'}})
      }
      if (body.action === 'upload') {
        if (restored) {assert.equal(recovered, true); assert.notEqual(body.requestId, intents[0])}
        if (restored && published) {
          assert.equal(body.requestId, intents[1])
          return Response.json({state: 'committed', uploadId: nextUpload, result})
        }
        intents.push(body.requestId)
        return Response.json({state: 'pending', uploadId: restored ? nextUpload : sourceUpload,
          url: 'https://storage.invalid/staging', headers: {'content-type': 'text/markdown',
            'x-amz-checksum-sha256': Buffer.from(sha256, 'hex').toString('base64')}, sizeBytes: content.length, expiresIn: 120})
      }
      assert.equal(body.action, 'commit')
      commits.push(body.uploadId)
      if (!restored) {published = outcome === 'committed'; throw Error('lost original commit acknowledgement')}
      assert.equal(body.uploadId, nextUpload); published = true
      if (outcome === 'uncommitted-with-retry' && !lostRetry) {lostRetry = true; throw new DriveRequestError(503, 'DRIVE_BACKEND_UNAVAILABLE')}
      return Response.json(result)
    }
    try {
      drive = await createRuntimeDrive({...f.options, fetch, sessionId: 'source', execution: {attemptId: 'source', generation: 1}})
      const root = drive.workingDirectory
      await writeFile(join(root, 'report.md'), content)
      await assert.rejects(drive.sync(), /lost original commit acknowledgement/)
      await drive.close(); drive = undefined
      restored = true
      const restoredOptions = {...f.options, fetch, sessionId: 'next', execution: {attemptId: 'next', generation: 2},
        previousExecution: {attemptId: 'source', generation: 1}}
      if (outcome === 'uncommitted-with-retry') await assert.rejects(createRuntimeDrive(restoredOptions), /503/)
      drive = await createRuntimeDrive(restoredOptions)
      assert.equal(drive.workingDirectory, root)
      assert.deepEqual(await readFile(join(root, 'report.md')), content)
      assert.deepEqual(await drive.sync(true), [{fileId: result.fileId, path: 'report.md', kind: 'file'}])
      assert.equal(intents.length, outcome === 'committed' ? 1 : 2)
      assert.equal(recoveryReads, 1)
      assert.deepEqual(commits, outcome === 'committed' ? [sourceUpload] : [sourceUpload, nextUpload])
      await drive.close(); drive = undefined
      if (outcome !== 'committed') {
        const journal = new SqliteDriveJournal(join(f.options.stateDirectory, 'drive', createHash('sha256').update(root).digest('hex').slice(0, 32), 'writes.sqlite'),
          {environmentId: 'environment', runId: 'run', sessionId: 'source', scope, execution: {attemptId: 'source', generation: 1}})
        const originalRequest = intents[0]
        if (!originalRequest) throw Error('Missing original request')
        try {assert.deepEqual(Buffer.from(journal.content(originalRequest)), content)} finally {journal.close()}
      }
    } finally {await drive?.close(); await f.clean()}
  }
})

test('a cloud working directory requires an explicit matching filesystem grant and foreign scopes are refused', async () => {
  const f = await fixture()
  try {
    await assert.rejects(createRuntimeDrive({ ...f.options, location: 'cloud' }), /OUTSIDE_FILESYSTEM_GRANT/)
    await assert.rejects(createRuntimeDrive({ ...f.options, credentials: async () => ({ ...credential(), scope: { ...scope, workspaceId: 'foreign' } }) }), /SCOPE_CHANGED/)
  } finally { await f.clean() }
})

test('an escaping local parent symlink is refused before any cache is created outside the grant', async () => {
  const f = await fixture(), outside = join(f.directory, 'outside'), link = join(f.project, 'linked')
  try {
    await mkdir(outside)
    await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(createRuntimeDrive({ ...f.options, approvedWorkingDirectory: link }), /outside.*filesystem grant/)
    assert.deepEqual(await readdir(outside), [])
  } finally { await f.clean() }
})
