import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { credentialHelper } from './thread-work-service'

test('git gets the token for the exact repository, even with two repositories from one owner', { skip: process.platform === 'win32' }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'overlay-github-'))
  try {
    mkdirSync(join(directory, 'acme'))
    writeFileSync(join(directory, 'acme', 'web.token'), 'token-web')
    writeFileSync(join(directory, 'acme', 'api.token'), 'token-api')
    writeFileSync(join(directory, 'helper'), credentialHelper(directory))
    const ask = (path: string) => execFileSync('sh', [join(directory, 'helper'), 'get'], {
      input: `protocol=https\nhost=github.com\npath=${path}\n\n`, encoding: 'utf8',
    })
    assert.match(ask('acme/web.git'), /password=token-web/)
    assert.match(ask('acme/api.git'), /password=token-api/)
    assert.match(ask('acme/api'), /password=token-api/)
    assert.equal(ask('acme/other.git'), '')
    assert.equal(ask('other/web.git'), '')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
