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

test('S3 can use the AWS default credential chain without static keys', () => {
  const store = new S3CompatibleObjectStore({
    bucketName: 'overlay-private',
    region: 'us-east-1',
  })

  assert.equal(store.providerConfigSummary.hasAccessKeyId, false)
  assert.equal(store.providerConfigSummary.hasSecretAccessKey, false)
})

test('S3 upload constraints sign an empty body, its hexadecimal digest and the requested short lifetime', async () => {
  const store = new S3CompatibleObjectStore({ accessKeyId: 'AKIATESTKEY', secretAccessKey: 'test-secret-access-key',
    bucketName: 'overlay-private', endpointUrl: 'https://s3.example.test', region: 'us-east-1' })
  const sha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  const url = new URL((await store.getUploadUrl('users/user/files/staging/empty', 'application/octet-stream',
    { contentLength: 0, checksumSha256: sha256, expiresIn: 120 })).url)
  assert.equal(url.searchParams.get('X-Amz-Expires'), '120')
  assert.equal(url.searchParams.get('x-amz-checksum-sha256'), Buffer.from(sha256, 'hex').toString('base64'))
  assert.ok((url.searchParams.get('X-Amz-SignedHeaders') ?? '').split(';').includes('content-length'))
})
