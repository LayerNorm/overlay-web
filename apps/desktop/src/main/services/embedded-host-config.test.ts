import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  EMBEDDED_HOST_PACKAGE_SPEC,
  buildEmbeddedHostArgs,
  buildEmbeddedHostRunArgs,
  embeddedHostPackageSpec,
  verificationPhraseFrom,
  isValidServerOrigin,
  resolveNpxPath,
  ENROLLMENT_CODE_PATTERN
} from './embedded-host-config'

describe('embedded-host-config', () => {
  it('pins the same host release line as the web enrollment command', () => {
    expect(EMBEDDED_HOST_PACKAGE_SPEC).toBe('@layernorm/overlay-agent-host@0.5.0')
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

  it('resolves npx from PATH without a shell', () => {
    const directory = mkdtempSync(join(tmpdir(), 'overlay-npx-'))
    writeFileSync(join(directory, 'npx'), '#!/bin/sh\nexit 0\n')
    expect(
      resolveNpxPath({ PATH: `/nonexistent:${directory}` }, (path) => {
        try {
          return path === join(directory, 'npx')
        } catch {
          return false
        }
      })
    ).toBe(join(directory, 'npx'))
  })

  it('returns null when npx is nowhere to be found', () => {
    expect(resolveNpxPath({ PATH: '/nonexistent-dir' }, () => false)).toBeNull()
  })

  it('builds a pinned, shell-free argv array', () => {
    const args = buildEmbeddedHostArgs({
      code: 'ABCD-1234',
      origin: 'https://www.getoverlay.io',
      stateDir: '/tmp/state',
      name: 'Mac (Desktop)'
    })
    expect(args).toEqual([
      '--yes',
      '--package',
      'node@24',
      '--package',
      '@layernorm/overlay-agent-host@0.5.0',
      'overlay-agent-host',
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
    expect(argv.slice(0, 6)).toEqual(['--yes', '--package', 'node@24', '--package', EMBEDDED_HOST_PACKAGE_SPEC, 'overlay-agent-host'])
  })

  it('restarts a saved host from its configuration without an enrollment code', () => {
    expect(buildEmbeddedHostRunArgs({ configPath: '/tmp/host/config.json' })).toEqual([
      '--yes', '--package', 'node@24', '--package', EMBEDDED_HOST_PACKAGE_SPEC, 'overlay-agent-host', 'run', '--config', '/tmp/host/config.json'
    ])
  })

  it('reads the verification phrase the host prints', () => {
    expect(verificationPhraseFrom('Verify this phrase in Overlay: amber-river-sage')).toBe('amber-river-sage')
    expect(verificationPhraseFrom('Waiting for approval…')).toBeNull()
    expect(verificationPhraseFrom('Verify this phrase in Overlay: amber; rm -rf ~')).toBeNull()
  })

  it('uses a local host package only in unpackaged development builds', () => {
    const env = { OVERLAY_DESKTOP_DEV_HOST_PACKAGE: '/tmp/layernorm-overlay-agent-host-0.5.0.tgz' }
    expect(embeddedHostPackageSpec(env, false)).toBe('/tmp/layernorm-overlay-agent-host-0.5.0.tgz')
    expect(embeddedHostPackageSpec(env, true)).toBe(EMBEDDED_HOST_PACKAGE_SPEC)
    expect(embeddedHostPackageSpec({ OVERLAY_DESKTOP_DEV_HOST_PACKAGE: 'evil@latest' }, false)).toBe(EMBEDDED_HOST_PACKAGE_SPEC)
  })
})
