import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import { S3CompatibleObjectStore } from './s3-compatible-object-store'

test('S3 presigned URLs are short-lived, scoped, and never expose the secret key', async () => {
  const secretAccessKey = 'test-secret-access-key-that-must-not-leak'
  const store = new S3CompatibleObjectStore({
    accessKeyId: 'AKIATESTKEY',
    bucketName: 'overlay-private',
    endpointUrl: 'https://s3.example.test',
    forcePathStyle: true,
    presignTtlSeconds: 60,
    region: 'us-east-1',
    secretAccessKey,
  })
  const key = 'users/user_1/files/file_1/report.txt'
  const upload = new URL((await store.getUploadUrl(key, 'text/plain')).url)
  const download = new URL(await store.getDownloadUrl(key))

  for (const url of [upload, download]) {
    assert.equal(url.searchParams.get('X-Amz-Expires'), '60')
    assert.match(decodeURIComponent(url.pathname), /overlay-private\/users\/user_1\/files\/file_1\/report\.txt$/)
    assert.equal(url.toString().includes(secretAccessKey), false)
    assert.match(url.searchParams.get('X-Amz-Credential') ?? '', /^AKIATESTKEY\//)
  }
})

test('S3 presign lifetime is capped at fifteen minutes', async () => {
  const store = new S3CompatibleObjectStore({
    accessKeyId: 'AKIATESTKEY',
    bucketName: 'overlay-private',
    endpointUrl: 'https://s3.example.test',
    presignTtlSeconds: 86_400,
    region: 'us-east-1',
    secretAccessKey: 'test-secret-access-key',
  })
  const url = new URL(await store.getDownloadUrl('users/user_1/files/file_1/report.txt'))
  assert.equal(url.searchParams.get('X-Amz-Expires'), '900')
})
