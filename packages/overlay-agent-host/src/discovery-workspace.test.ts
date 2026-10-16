import assert from 'node:assert/strict'
import {mkdtemp, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, isAbsolute, join, relative, sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import test from 'node:test'
import {AcpAgentAdapter} from './acp-adapter'
import {AcpxAgentAdapter} from './acpx-adapter'
import {AgentDriveCache} from './drive-cache'
import {createDiscoveryWorkspace} from './discovery-workspace'

const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'acp-options-agent.ts')
const launch = [process.execPath, '--import', import.meta.resolve('tsx'), fixture]

test('live ACP and acpx catalog probes cannot become drive upload candidates', async t => {
  for (const kind of ['acp', 'acpx']) await t.test(kind, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'overlay-discovery-cache-test-'))
    const cache = await AgentDriveCache.create(directory, 'drive')
    const log = join(directory, 'probe.jsonl'), gate = join(directory, 'continue')
    const adapter = kind === 'acp'
      ? new AcpAgentAdapter({id: 'fixture', displayName: 'Fixture', command: process.execPath, args: launch.slice(1)})
      : new AcpxAgentAdapter({id: 'fixture', displayName: 'Fixture', agent: 'fixture', stateDirectory: join(directory, 'state'), registryOverrides: {fixture: launch}})
    const pending = adapter.discover({workingDirectory: cache.root, credentials: {FIXTURE_OPTIONS_LOG: log, FIXTURE_DISCOVERY_GATE: gate}})
    let probeDirectory: string | undefined
    try {
      for (let attempt = 0; attempt < 500; attempt++) {
        const content = await readFile(log, 'utf8').catch(error => {
          if (error.code !== 'ENOENT') throw error
          return ''
        })
        if (content) {
          const record = JSON.parse(content.trim().split('\n')[0])
          assert.equal(record.kind, 'discovery')
          assert.equal(typeof record.cwd, 'string')
          probeDirectory = record.cwd
          break
        }
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      assert.ok(probeDirectory, 'the real ACP child must reach its blocked session/new request')
      const tail = relative(cache.root, probeDirectory)
      assert.ok(isAbsolute(tail) || tail === '..' || tail.startsWith(`..${sep}`))
      assert.deepEqual(await cache.inventory(), [], 'a concurrent drive scan cannot see discovery state')
      if (process.platform !== 'win32') assert.equal((await stat(probeDirectory)).mode & 0o777, 0o700)
      await writeFile(gate, '')
      assert.equal((await pending).options?.model?.values[1]?.id, 'future-model')
      await assert.rejects(stat(probeDirectory), {code: 'ENOENT'})
      assert.deepEqual(await cache.inventory(), [])
    } finally {
      await writeFile(gate, '')
      await pending.catch(() => undefined)
      await rm(directory, {recursive: true, force: true, maxRetries: 10, retryDelay: 100})
    }
  })
})

test('a temporary directory inside the synced workspace is declined before creating anything', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-discovery-parent-test-'))
  try {
    assert.equal(await createDiscoveryWorkspace({workingDirectory: directory, temporaryDirectory: directory}), undefined)
    assert.deepEqual(await readdir(directory), [])
    assert.equal(await createDiscoveryWorkspace({workingDirectory: directory, temporaryDirectory: join(directory, 'missing')}), undefined)
    assert.deepEqual(await readdir(directory), [])
  } finally { await rm(directory, {recursive: true, force: true}) }
})
