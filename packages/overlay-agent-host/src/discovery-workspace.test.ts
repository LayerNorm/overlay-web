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

// This timed isolation probe needs a protocol child, not a TypeScript compiler/SDK startup on the CI machine.
const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'acp-discovery-agent.mjs')
const launch = [process.execPath, fixture]

test('live ACP and acpx catalog probes cannot become drive upload candidates', async t => {
  const probes: Array<{kind: 'acp' | 'acpx'; initializeDelayMs: number}> = [
    {kind: 'acp', initializeDelayMs: 0}, {kind: 'acpx', initializeDelayMs: 0}, {kind: 'acpx', initializeDelayMs: 10000},
  ]
  for (const {kind, initializeDelayMs} of probes) await t.test(`${kind}${initializeDelayMs ? ' with delayed initialization' : ''}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'overlay-discovery-cache-test-'))
    const cache = await AgentDriveCache.create(directory, 'drive')
    const log = join(directory, 'probe.jsonl'), gate = join(directory, 'continue')
    const adapter = kind === 'acp'
      ? new AcpAgentAdapter({id: 'fixture', displayName: 'Fixture', command: process.execPath, args: launch.slice(1)})
      : new AcpxAgentAdapter({id: 'fixture', displayName: 'Fixture', agent: 'fixture', stateDirectory: join(directory, 'state'), registryOverrides: {fixture: launch}})
    const pending = adapter.discover({workingDirectory: cache.root, credentials: {
      FIXTURE_OPTIONS_LOG: log, FIXTURE_DISCOVERY_GATE: gate, FIXTURE_INITIALIZE_DELAY_MS: String(initializeDelayMs),
    }})
    let discoverySettled = false
    void pending.then(() => {discoverySettled = true}, () => {discoverySettled = true})
    let probeDirectory: string | undefined
    try {
      // Discovery owns its startup deadline; filesystem polling must not impose an earlier one.
      for (;;) {
        const content = await readFile(log, 'utf8').catch(error => {
          if (error.code !== 'ENOENT') throw error
          return ''
        })
        if (content) {
          const record = content.trim().split('\n').map(line => JSON.parse(line)).find(record => record.kind === 'discovery')
          if (record) {
            assert.equal(typeof record.cwd, 'string')
            probeDirectory = record.cwd
            break
          }
        }
        if (discoverySettled) break
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      const trace = await readFile(log, 'utf8').catch(() => 'No fixture boot record')
      assert.ok(probeDirectory, `the real ACP child must reach its blocked session/new request; fixture trace: ${trace}`)
      const tail = relative(cache.root, probeDirectory)
      assert.ok(isAbsolute(tail) || tail === '..' || tail.startsWith(`..${sep}`))
      assert.deepEqual(await cache.inventory(), [], 'a concurrent drive scan cannot see discovery state')
      if (process.platform !== 'win32') assert.equal((await stat(probeDirectory)).mode & 0o777, 0o700)
      await writeFile(gate, '')
      assert.equal((await pending).options?.model?.values[1]?.id, 'future-model')
      assert.ok((await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
        .every(record => record.kind !== 'unexpected-prompt' && record.method !== 'session/prompt'),
        'catalog discovery must not send a provider prompt')
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
