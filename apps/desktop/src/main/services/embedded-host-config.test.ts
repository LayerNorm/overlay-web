import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildEmbeddedHostArgs,
  buildEmbeddedHostRunArgs,
  resolveCliProxyBinary,
  resolveEmbeddedHostRuntime,
  verificationPhraseFrom,
  isValidServerOrigin,
  ENROLLMENT_CODE_PATTERN
} from './embedded-host-config'

describe('embedded-host-config', () => {
  it('pins the same host release line as the web enrollment command', () => {
    const bundle = JSON.parse(readFileSync(join(process.cwd(), 'agent-host-bundle/package.json'), 'utf8'))
    expect(bundle.dependencies).toEqual({ '@layernorm/overlay-agent-host': '0.7.0' })
  })

  it('accepts https origins and http loopback only', () => {
    expect(isValidServerOrigin('https://www.getoverlay.io')).toBe(true)
    expect(isValidServerOrigin('http://localhost:3000')).toBe(true)
    expect(isValidServerOrigin('http://127.0.0.1:3000')).toBe(true)
    expect(isValidServerOrigin('http://192.168.1.2:3000')).toBe(false)
    expect(isValidServerOrigin('https://evil.example')).toBe(true)
    expect(isValidServerOrigin('not a url')).toBe(false)
  })

  it('rejects malformed enrollment codes', () => {
    expect(ENROLLMENT_CODE_PATTERN.test('ABCD-1234-xyz')).toBe(true)
    expect(ENROLLMENT_CODE_PATTERN.test('_base64url-123_')).toBe(true)
    expect(ENROLLMENT_CODE_PATTERN.test('')).toBe(false)
    expect(ENROLLMENT_CODE_PATTERN.test('a')).toBe(false)
    expect(ENROLLMENT_CODE_PATTERN.test('code with spaces')).toBe(false)
    expect(ENROLLMENT_CODE_PATTERN.test('code;rm -rf ~')).toBe(false)
  })

  const cli = 'overlay-agent-host.mjs'
  const locations = { resourcesPath: '/Applications/Overlay.app/Contents/Resources', appPath: '/repo' }

  it('runs the host and Node.js that ship inside a packaged app', () => {
    expect(resolveEmbeddedHostRuntime({ packaged: true, ...locations }, { PATH: '' }, () => true)).toEqual({
      nodePath: '/Applications/Overlay.app/Contents/Resources/agent-host/node',
      cliPath: `/Applications/Overlay.app/Contents/Resources/agent-host/${cli}`
    })
  })

  it('uses the built bundle in a checkout', () => {
    expect(resolveEmbeddedHostRuntime({ packaged: false, ...locations }, {}, () => true)).toEqual({
      nodePath: '/repo/agent-host-bundle/runtime/node',
      cliPath: `/repo/agent-host-bundle/runtime/${cli}`
    })
  })

  it('returns null when the bundle is missing', () => {
    expect(resolveEmbeddedHostRuntime({ packaged: true, ...locations }, {}, () => false)).toBeNull()
  })

  it('builds a shell-free argv array', () => {
    const args = buildEmbeddedHostArgs({
      code: 'ABCD-1234',
      origin: 'https://www.getoverlay.io',
      stateDir: '/tmp/state',
      name: 'Mac (Desktop)'
    })
    expect(args).toEqual([
      'connect',
      'ABCD-1234',
      '--server',
      'https://www.getoverlay.io',
      '--local-tools',
      '--state-dir',
      '/tmp/state',
      '--name',
      'Mac (Desktop)',
      '--kind',
      'local',
      '--run'
    ])
    // No shell metacharacters can sneak in through the fixed argv shape.
    expect(args.every((arg) => typeof arg === 'string')).toBe(true)
  })
})

describe('local tools (this Mac as a Computer)', () => {
  const base = { code: 'ABCD-1234', origin: 'https://www.getoverlay.io', stateDir: '/tmp/host', name: 'Mac (Desktop)' }

  it('starts a local-tools host with no third-party harness', () => {
    const argv = buildEmbeddedHostArgs(base)
    expect(argv).toContain('--local-tools')
    expect(argv).not.toContain('--adapter')
    expect(argv[0]).toBe('connect')
  })

  it('restarts a saved host from its configuration without an enrollment code', () => {
    expect(buildEmbeddedHostRunArgs({ configPath: '/tmp/host/config.json' })).toEqual(['run', '--config', '/tmp/host/config.json'])
  })

  it('reads the verification phrase the host prints', () => {
    expect(verificationPhraseFrom('Verify this phrase in Overlay: amber-river-sage')).toBe('amber-river-sage')
    expect(verificationPhraseFrom('Waiting for approval…')).toBeNull()
    expect(verificationPhraseFrom('Verify this phrase in Overlay: amber; rm -rf ~')).toBeNull()
  })

  it('runs another host checkout only in unpackaged development builds', () => {
    const env = { OVERLAY_DESKTOP_DEV_HOST_CLI: '/work/overlay-agent-host/src/cli.mjs' }
    const locations = { resourcesPath: '/res', appPath: '/repo' }
    expect(resolveEmbeddedHostRuntime({ packaged: false, ...locations }, env, () => true)?.cliPath).toBe(env.OVERLAY_DESKTOP_DEV_HOST_CLI)
    expect(resolveEmbeddedHostRuntime({ packaged: true, ...locations }, env, () => true)?.cliPath).toMatch(/^\/res\/agent-host\//)
    expect(
      resolveEmbeddedHostRuntime({ packaged: false, ...locations }, { OVERLAY_DESKTOP_DEV_HOST_CLI: 'evil.mjs' }, () => true)?.cliPath
    ).toMatch(/^\/repo\/agent-host-bundle\//)
  })
})

describe('resolveCliProxyBinary', () => {
  it('finds the plan proxy beside the bundled Node.js, packaged or not', () => {
    const locations = { resourcesPath: '/App/Resources', appPath: '/repo' }
    expect(resolveCliProxyBinary({ packaged: true, ...locations }, () => true)).toBe('/App/Resources/agent-host/cli-proxy-api')
    expect(resolveCliProxyBinary({ packaged: false, ...locations }, () => true)).toBe('/repo/agent-host-bundle/runtime/cli-proxy-api')
    expect(resolveCliProxyBinary({ packaged: true, ...locations }, () => false)).toBeNull()
  })
})
