import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import test from 'node:test'
import { R2ObjectStore } from '../r2'
import { AgentDriveClient } from '../../../../packages/overlay-agent-host/src/drive-client'

test('R2 constrained uploads sign the checksum header sent by the real drive client', async () => {
  const store = new R2ObjectStore({ accessKeyId: 'TESTACCESSKEY', secretAccessKey: 'test-secret',
    bucketName: 'overlay-private', endpointUrl: 'https://r2.example.test', presignTtlSeconds: 120 })
  for (const bytes of [Buffer.alloc(0), Buffer.from('full drive bytes ✓\n')]) {
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const upload = await store.getUploadUrl('users/test/staging/report.txt', 'text/plain', {
      checksumSha256: sha256, contentLength: bytes.length, expiresIn: 120,
    })
    let puts = 0
    const client = new AgentDriveClient({ apiUrl: 'https://preview.example.test/api/agent-drive',
      credentials: async () => { throw Error('Staging PUT must not request a drive credential') },
      fetch: async (input, init) => {
        const url = new URL(String(input)), headers = new Headers(init?.headers)
        assert.equal(url.searchParams.has('x-amz-checksum-sha256'), false, 'R2 rejects a hoisted checksum duplicated in headers')
        const signed = (url.searchParams.get('X-Amz-SignedHeaders') ?? '').split(';')
        assert.ok(signed.includes('x-amz-checksum-sha256'))
        assert.ok(signed.includes('content-length'))
        assert.equal(headers.get('x-amz-checksum-sha256'), Buffer.from(sha256, 'hex').toString('base64'))
        assert.equal(headers.get('authorization'), null)
        assert.equal(init?.method, 'PUT')
        puts++
        return new Response(null, { status: 200 })
      },
    })
    await client.upload({ state: 'pending', uploadId: randomUUID(), url: upload.url,
      headers: { 'content-type': 'text/plain', 'x-amz-checksum-sha256': Buffer.from(sha256, 'hex').toString('base64') },
      sizeBytes: bytes.length, expiresIn: 120 }, bytes, sha256)
    assert.equal(puts, 1)
  }
})
