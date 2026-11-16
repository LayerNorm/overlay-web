import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { R2ObjectStore } from '../r2'

test('R2 constrained uploads sign the checksum, create-only and length headers without hoisting the checksum', async () => {
  const store = new R2ObjectStore({ accessKeyId: 'TESTACCESSKEY', secretAccessKey: 'test-secret',
    bucketName: 'overlay-private', endpointUrl: 'https://r2.example.test', presignTtlSeconds: 120 })
  for (const bytes of [Buffer.alloc(0), Buffer.from('full upload bytes ✓\n')]) {
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const upload = await store.getUploadUrl('users/test/staging/report.txt', 'text/plain', {
      checksumSha256: sha256, contentLength: bytes.length, createOnly: true, expiresIn: 120,
    })
    const url = new URL(upload.url)
    assert.equal(url.searchParams.has('x-amz-checksum-sha256'), false, 'R2 rejects a hoisted checksum duplicated in headers')
    const signed = (url.searchParams.get('X-Amz-SignedHeaders') ?? '').split(';')
    assert.ok(signed.includes('x-amz-checksum-sha256'))
    assert.ok(signed.includes('if-none-match'))
    assert.ok(signed.includes('content-length'))
  }
})
