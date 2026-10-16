import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { agentHostConfigSchema, loadAgentHostConfig, saveAgentHostConfig } from './config.js'

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
    // Windows does not expose POSIX owner/group/other permission bits through
    // stat().mode. The host still writes the file with the restrictive mode on
    // POSIX systems, where that guarantee is meaningful and enforceable.
    if (process.platform !== 'win32') {
      assert.equal((await stat(path)).mode & 0o777, 0o600)
    }
    assert.equal('credential' in JSON.parse(contents), false)
    assert.match(contents, /"environmentId": "environment-1"/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})


test('native restoration is an explicit per-adapter opt-in requiring durable lifecycle and survives private config reload', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-native-config-'))
  const path = join(directory, 'config.json')
  const base = {environmentId: 'environment', workspaceId: 'workspace', controlPlaneUrl: 'https://example.com/host/',
    stateDirectory: directory, filesystem: {mode: 'selected_roots' as const, roots: ['/workspace']}}
  try {
    for (const adapter of [
      {manifest: 'claude-code' as const},
      {id: 'direct', displayName: 'Direct', protocol: 'acp' as const, command: 'agent'},
      {id: 'codex', displayName: 'Codex', protocol: 'acpx' as const, agent: 'codex'},
    ]) {
      assert.equal(agentHostConfigSchema.safeParse({...base, adapters: [adapter]}).success, true)
      assert.equal(agentHostConfigSchema.safeParse({...base, adapters: [{...adapter, fencedSessionRestoration: true}]}).success, false)
      await writeFile(path, JSON.stringify({...base, durableLifecycle: true, adapters: [{...adapter, fencedSessionRestoration: true}]}), {mode: 0o600})
      const loaded = await loadAgentHostConfig(path)
      assert.equal(loaded.durableLifecycle, true)
      assert.equal('fencedSessionRestoration' in loaded.adapters[0] && loaded.adapters[0].fencedSessionRestoration, true)
    }
    assert.equal(agentHostConfigSchema.safeParse({...base, durableLifecycle: true, adapters: [
      {id: 'fake', displayName: 'Fake', protocol: 'fake', fencedSessionRestoration: true},
    ]}).success, false)
    assert.equal(agentHostConfigSchema.safeParse({...base, durableLifecycle: true, adapters: [
      {id: 'eve', displayName: 'Eve', protocol: 'eve', host: 'https://example.com', fencedSessionRestoration: true},
    ]}).success, false)
  } finally {await rm(directory, {recursive: true, force: true})}
})
