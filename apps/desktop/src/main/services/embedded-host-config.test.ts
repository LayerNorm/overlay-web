import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  EMBEDDED_HOST_PACKAGE_SPEC,
  buildEmbeddedHostArgs,
  isEmbeddedHostAdapter,
  isValidServerOrigin,
  resolveNpxPath,
  ENROLLMENT_CODE_PATTERN
} from './embedded-host-config'

describe('embedded-host-config', () => {
  it('pins the same host release line as the web enrollment command', () => {
    expect(EMBEDDED_HOST_PACKAGE_SPEC).toBe('@layernorm/overlay-agent-host@0.3.5')
  })

  it('accepts only the built-in harness adapters', () => {
    expect(isEmbeddedHostAdapter('codex')).toBe(true)
    expect(isEmbeddedHostAdapter('claude-code')).toBe(true)
    expect(isEmbeddedHostAdapter('hermes')).toBe(true)
    expect(isEmbeddedHostAdapter('openclaw')).toBe(false)
    expect(isEmbeddedHostAdapter(undefined)).toBe(false)
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
    expect(ENROLLMENT_CODE_PATTERN.test('')).toBe(false)
    expect(ENROLLMENT_CODE_PATTERN.test('a')).toBe(false)
    expect(ENROLLMENT_CODE_PATTERN.test('code with spaces')).toBe(false)
    expect(ENROLLMENT_CODE_PATTERN.test('code;rm -rf ~')).toBe(false)
  })

  it('resolves npx from PATH without a shell', () => {
    const directory = mkdtempSync(join(tmpdir(), 'overlay-npx-'))
    writeFileSync(join(directory, 'npx'), '#!/bin/sh\nexit 0\n')
    expect(resolveNpxPath({ PATH: `/nonexistent:${directory}` }, (path) => {
      try {
        return path === join(directory, 'npx')
      } catch {
        return false
      }
    })).toBe(join(directory, 'npx'))
  })

  it('returns null when npx is nowhere to be found', () => {
    expect(resolveNpxPath({ PATH: '/nonexistent-dir' }, () => false)).toBeNull()
  })

  it('builds a pinned, shell-free argv array', () => {
    const args = buildEmbeddedHostArgs({
      code: 'ABCD-1234',
      adapterId: 'codex',
      origin: 'https://www.getoverlay.io',
      stateDir: '/tmp/state',
      name: 'Mac (Desktop)'
    })
    expect(args).toEqual([
      '--yes',
      '--package',
      'node@24',
      '--package',
      '@layernorm/overlay-agent-host@0.3.5',
      'overlay-agent-host',
      'connect',
      'ABCD-1234',
      '--server',
      'https://www.getoverlay.io',
      '--adapter',
      'codex',
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
