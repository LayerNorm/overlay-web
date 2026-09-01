import assert from 'node:assert/strict'
import test from 'node:test'
import { launchAgentExecutablePath, launchAgentLabel, launchAgentPlist } from './launchd.js'

test('macOS service definitions are restartable and escape paths safely', () => {
  assert.equal(launchAgentLabel('environment:one'), 'com.layernorm.overlay-agent-host.environment-one')
  const plist = launchAgentPlist({
    environmentId: 'environment:one',
    configPath: "/Users/test/O'Reilly/config.json",
    stateDirectory: '/Users/test/Agent & Host',
    packageSpec: '@layernorm/overlay-agent-host@0.3.1',
    executablePath: '/Users/test/.local/bin:/opt/homebrew/bin:/usr/bin:/bin',
  })
  assert.match(plist, /KeepAlive/)
  assert.match(plist, /node@24/)
  assert.match(plist, /O&apos;&quot;&apos;&quot;&apos;Reilly/)
  assert.match(plist, /Agent &amp; Host/)
  assert.match(plist, /<key>EnvironmentVariables<\/key>/)
  assert.match(plist, /\/Users\/test\/\.local\/bin:\/opt\/homebrew\/bin:\/usr\/bin:\/bin/)
})

test('macOS service PATH keeps absolute shell entries and adds common agent locations', () => {
  const path = launchAgentExecutablePath('/custom/bin:relative:/usr/bin:/custom/bin')
  assert.deepEqual(path.split(':').slice(0, 2), ['/custom/bin', '/usr/bin'])
  assert.match(path, /\/\.local\/bin/)
  assert.doesNotMatch(path, /(^|:)relative(:|$)/)
})
