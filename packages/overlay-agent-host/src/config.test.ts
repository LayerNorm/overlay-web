import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { RETIRED_HARNESS_CONFIG_MESSAGE, loadAgentHostConfig, saveAgentHostConfig } from './config.js'

const base = {
  environmentId: 'environment-1',
  workspaceId: 'workspace-1',
  controlPlaneUrl: 'https://overlay.works/api/v1/agent-environments/environment-1/',
  credentialEnv: 'OVERLAY_AGENT_HOST_CREDENTIAL',
  filesystem: { mode: 'selected_roots' as const, roots: ['/workspace'] },
  localTools: true as const,
}

test('enrollment restart configuration is private and excludes credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-host-config-'))
  const path = join(directory, 'nested', 'config.json')
  try {
    await saveAgentHostConfig(path, { ...base, stateDirectory: directory })
    const contents = await readFile(path, 'utf8')
    if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777, 0o600)
    assert.equal('credential' in JSON.parse(contents), false)
    assert.equal((await loadAgentHostConfig(path)).localTools, true)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('a configuration written for a third-party agent is refused with a reconnect message', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-host-config-'))
  const path = join(directory, 'config.json')
  try {
    const { localTools: _localTools, ...legacy } = base
    void _localTools
    await writeFile(path, JSON.stringify({ ...legacy, stateDirectory: directory, adapters: [{ manifest: 'codex' }] }))
    await assert.rejects(loadAgentHostConfig(path), new RegExp(RETIRED_HARNESS_CONFIG_MESSAGE.slice(0, 40)))
    await writeFile(path, JSON.stringify({ ...base, stateDirectory: directory, adapters: [], durableLifecycle: true }))
    assert.equal((await loadAgentHostConfig(path)).environmentId, 'environment-1')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
