import assert from 'node:assert/strict'
import test from 'node:test'
import { randomBytes } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { analyzeAgentProfile, bundleFromAnalysis } from '@layernorm/overlay-agent-bridge-protocol'
import { AgentProfileError, decodeProfileBundle, encodeProfileBundle, readProfileUpload } from './agent-profile-codec'

const gz = (value: unknown) => gzipSync(Buffer.from(JSON.stringify(value)))

test('a bundle survives storage as chunks, however big, and its digest follows its contents', () => {
  // Random text does not compress, so this needs more than one chunk.
  const files = Array.from({ length: 8 }, (_, i) => ({ path: `skills/s${i}/SKILL.md`, content: randomBytes(100_000).toString('hex') }))
  const bundle = bundleFromAnalysis(analyzeAgentProfile('claude-code', files))
  assert.equal(bundle.files.length, 8)
  const stored = encodeProfileBundle(bundle)
  assert.ok(stored.chunks.length > 1, `chunks: ${stored.chunks.length}`)
  assert.ok(stored.chunks.every((chunk) => chunk.length <= 800_000))
  assert.deepEqual(decodeProfileBundle(stored.chunks).files.map((f) => f.path), files.map((f) => f.path))
  assert.equal(encodeProfileBundle(bundle).digest, stored.digest)
  assert.notEqual(encodeProfileBundle({ ...bundle, files: [] }).digest, stored.digest)
})

test('a stored bundle is cleaned again on the way out', () => {
  const dirty = { version: 1 as const, harness: 'claude-code' as const, mcpServers: {}, hooks: [], secrets: [], files: [{ path: '.credentials.json', content: '{}' }, { path: 'CLAUDE.md', content: 'ok' }] }
  const decoded = decodeProfileBundle(encodeProfileBundle(dirty).chunks)
  assert.deepEqual(decoded.files.map((f) => f.path), ['CLAUDE.md'])
})

test('uploads are read from gzip JSON and refused when empty, oversized, unreadable, or the wrong shape', () => {
  const ok = readProfileUpload(gz({ harness: 'codex', files: [{ path: 'AGENTS.md', content: 'x' }] }))
  assert.equal(ok.harness, 'codex')
  const refusal = (body: Uint8Array) => { try { readProfileUpload(body); return 'accepted' } catch (error) { return error instanceof AgentProfileError ? error.code : String(error) } }
  assert.equal(refusal(new Uint8Array()), 'profile_upload_size')
  assert.equal(refusal(new Uint8Array(5 * 1024 * 1024)), 'profile_upload_size')
  assert.equal(refusal(Buffer.from('not gzip')), 'profile_upload_unreadable')
  assert.equal(refusal(gz({ harness: 'vim', files: [] })), 'profile_upload_invalid')
  assert.equal(refusal(gz({ harness: 'codex', files: [], extra: true })), 'profile_upload_invalid')
})

test('a gzip bomb is stopped by the inflated size limit', () => {
  const bomb = gzipSync(Buffer.alloc(30 * 1024 * 1024, 0x61))
  assert.ok(bomb.byteLength < 4 * 1024 * 1024)
  assert.throws(() => readProfileUpload(bomb), /could not be read/)
})
