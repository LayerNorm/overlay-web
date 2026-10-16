import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createRuntimeDrive, type RuntimeDrive } from './runtime-drive'
import type { DriveCredentialsResponse } from '@layernorm/overlay-agent-bridge-protocol'

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
