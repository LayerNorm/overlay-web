import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { saveAgentHostConfig } from './config.js'

test('enrollment restart configuration is private and excludes credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-host-config-'))
  const path = join(directory, 'nested', 'config.json')
  try {
    await saveAgentHostConfig(path, {
      environmentId: 'environment-1',
      workspaceId: 'workspace-1',
      controlPlaneUrl: 'https://getoverlay.io/api/v1/agent-environments/environment-1/host/',
      credentialEnv: 'OVERLAY_AGENT_HOST_CREDENTIAL',
      stateDirectory: directory,
      filesystem: { mode: 'selected_roots', roots: ['/workspace'] },
      adapters: [{
        id: 'hermes',
        displayName: 'Hermes',
        protocol: 'acp',
        command: 'hermes',
        args: ['acp'],
      }],
    })

    const contents = await readFile(path, 'utf8')
    assert.equal((await stat(path)).mode & 0o777, 0o600)
    assert.equal('credential' in JSON.parse(contents), false)
    assert.match(contents, /"environmentId": "environment-1"/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
