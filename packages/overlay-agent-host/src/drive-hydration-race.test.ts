import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdtemp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {createRuntimeDrive} from './runtime-drive.js'

async function hydrate(race: 'once' | 'always' | 'stable' | 'moved' | 'denied' | 'unavailable' | 'local-write') {
  const directory = await mkdtemp(join(tmpdir(), 'drive-hydration-race-'))
  const project = join(directory, 'project')
  await mkdir(project)
  let version = 1, manifests = 0, downloads = 0
  const bytes = (value: number) => Buffer.from(`Verified source revision ${value}\n`)
  const entry = () => ({fileId: 'source', path: race === 'moved' && version > 1 ? 'moved.md' : 'source.md',
    updatedAt: version, kind: 'file', hydration: 'ready', sizeBytes: bytes(version).length,
    sha256: createHash('sha256').update(bytes(version)).digest('hex'), metadataMac: 'a'.repeat(43), downloadMac: 'b'.repeat(43)})
  const start = () => createRuntimeDrive({environmentId: 'environment', workspaceId: 'workspace', runId: 'run', sessionId: 'session',
    location: 'approved-root', approvedWorkingDirectory: project, filesystem: {mode: 'selected_roots', roots: [project]},
    stateDirectory: join(directory, 'private'), apiUrl: 'https://preview.invalid/api/agent-drive',
    credentials: async () => ({protocolVersion: 1, scope: {kind: 'personal', workspaceId: 'workspace', ownerUserId: 'owner'},
      expiresAt: Date.now() + 3600000, token: `ovdrive_${'x'.repeat(32)}.${'y'.repeat(43)}`}),
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      if (body.action === 'manifest') {
        manifests++
        return new Response([{type: 'manifest', version: 1}, {type: 'entry', entry: entry()}, {type: 'complete', entries: 1}]
          .map(frame => JSON.stringify(frame) + '\n').join(''))
      }
      assert.equal(body.action, 'download', 'hydration must not publish any writes')
      downloads++
      if (race === 'denied') return Response.json({error: 'DRIVE_RUN_UNAVAILABLE'}, {status: 403})
      if (race === 'local-write') {
        const cache = (await readdir(project)).find(name => name.startsWith('.overlay-drive-'))
        assert.ok(cache)
        await writeFile(join(project, cache, 'source.md'), 'Retain my concurrent local edit\n')
      }
      if (race === 'always' || ['once', 'moved', 'unavailable'].includes(race) && downloads === 1) {
        version++
        return Response.json({error: race === 'unavailable' ? 'DRIVE_FILE_UNAVAILABLE' : 'DRIVE_SOURCE_CHANGED'}, {status: race === 'unavailable' ? 404 : 409})
      }
      assert.equal(body.entry.updatedAt, version)
      return new Response(bytes(version), {status: 206, headers: {'x-overlay-drive-size': String(bytes(version).length),
        'content-range': `bytes 0-${bytes(version).length - 1}/${bytes(version).length}`}})
    }})
  return {start, stats: () => ({manifests, downloads}), localText: async () => {
    const cache = (await readdir(project)).find(name => name.startsWith('.overlay-drive-'))
    assert.ok(cache)
    return readFile(join(project, cache, 'source.md'), 'utf8')
  }, clean: () => rm(directory, {recursive: true, force: true})}
}

test('startup hydrates the current same-path revision after another agent updates its source', async () => {
  const f = await hydrate('once')
  try {
    const drive = await f.start()
    try {
      assert.equal(await readFile(join(drive.workingDirectory, 'source.md'), 'utf8'), 'Verified source revision 2\n')
      assert.deepEqual(f.stats(), {manifests: 3, downloads: 2})
    } finally {await drive.close()}
  } finally {await f.clean()}
})

test('stable hydration reuses the authenticated manifest instead of materializing it for every file', async () => {
  const f = await hydrate('stable')
  try {
    const drive = await f.start()
    try {
      assert.equal(await readFile(join(drive.workingDirectory, 'source.md'), 'utf8'), 'Verified source revision 1\n')
      assert.deepEqual(f.stats(), {manifests: 2, downloads: 1})
    } finally {await drive.close()}
  } finally {await f.clean()}
})

test('changing sources are bounded and moves or revoked execution refuse hydration', async () => {
  for (const race of ['always', 'moved', 'denied'] as const) {
    const f = await hydrate(race)
    try {
      await assert.rejects(f.start(), race === 'denied' ? /DRIVE_RUN_UNAVAILABLE/ : /DRIVE_HYDRATION_VERSION_CHANGED/)
      assert.equal(f.stats().downloads, race === 'always' ? 3 : 1)
    } finally {await f.clean()}
  }
})

for (const race of ['unavailable', 'local-write'] as const) test(`hydration preserves authority and local bytes after ${race}`, async () => {
  const f = await hydrate(race)
  try {
    if (race === 'unavailable') {
      const drive = await f.start()
      try {assert.equal(await readFile(join(drive.workingDirectory, 'source.md'), 'utf8'), 'Verified source revision 2\n')}
      finally {await drive.close()}
    } else {
      await assert.rejects(f.start(), /DRIVE_LOCAL_PATH_CONFLICT/)
      assert.equal(await f.localText(), 'Retain my concurrent local edit\n')
    }
  } finally {await f.clean()}
})
