import assert from 'node:assert/strict'
import test from 'node:test'
import { launchAgentLabel, launchAgentPlist } from './launchd.js'

test('macOS service definitions are restartable and escape paths safely', () => {
  assert.equal(launchAgentLabel('environment:one'), 'com.layernorm.overlay-agent-host.environment-one')
  const plist = launchAgentPlist({
    environmentId: 'environment:one',
    configPath: "/Users/test/O'Reilly/config.json",
    stateDirectory: '/Users/test/Agent & Host',
    packageSpec: '@layernorm/overlay-agent-host@0.3.0',
  })
  assert.match(plist, /KeepAlive/)
  assert.match(plist, /node@24/)
  assert.match(plist, /O&apos;&quot;&apos;&quot;&apos;Reilly/)
  assert.match(plist, /Agent &amp; Host/)
})
