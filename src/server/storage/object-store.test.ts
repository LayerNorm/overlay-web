import { beforeEach, expect, test, vi } from 'vitest'

const { getUploadUrl } = vi.hoisted(() => ({ getUploadUrl: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: () => ({ objectStore: { getUploadUrl } }) }))
vi.mock('@/server/storage/r2', () => ({
  getMaxPresignedUploadBytes: vi.fn(), getR2PresignTtlSeconds: vi.fn(),
  downloadBuffer: vi.fn(), headObject: vi.fn(), uploadBuffer: vi.fn(),
}))

import { generatePresignedUploadUrl } from './object-store'

beforeEach(() => { getUploadUrl.mockReset().mockResolvedValue({ url: 'https://storage.example.test/scoped-upload' }) })

test('forwards exact binary size, checksum and short lifetime to the configured provider', async () => {
  const checksum = 'a'.repeat(64)
  expect(await generatePresignedUploadUrl('artifact', 'video/mp4', 8_000_000, 120, checksum))
    .toBe('https://storage.example.test/scoped-upload')
  expect(getUploadUrl).toHaveBeenCalledWith('artifact', 'video/mp4', {
    contentLength: 8_000_000, expiresIn: 120, checksumSha256: checksum,
  })
})

test('preserves zero-byte constraints and provider default lifetime, and caps requested lifetime', async () => {
  await generatePresignedUploadUrl('empty', 'application/octet-stream', 0)
  expect(getUploadUrl).toHaveBeenLastCalledWith('empty', 'application/octet-stream', { contentLength: 0 })
  await generatePresignedUploadUrl('artifact', 'video/mp4', 1, 86_400)
  expect(getUploadUrl).toHaveBeenLastCalledWith('artifact', 'video/mp4', { contentLength: 1, expiresIn: 900 })
})

test.each([-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])('refuses invalid size %s before minting authority', async size => {
  await expect(generatePresignedUploadUrl('artifact', 'video/mp4', size)).rejects.toThrow('STORAGE_INVALID_UPLOAD_SIZE')
  expect(getUploadUrl).not.toHaveBeenCalled()
})

test.each([0, -1, NaN, Infinity, 0.5])('refuses invalid lifetime %s before minting authority', async ttl => {
  await expect(generatePresignedUploadUrl('artifact', 'video/mp4', 1, ttl)).rejects.toThrow('STORAGE_INVALID_UPLOAD_LIFETIME')
  expect(getUploadUrl).not.toHaveBeenCalled()
})

test.each(['', 'a'.repeat(63), 'g'.repeat(64), 'A'.repeat(64)])('refuses malformed SHA-256 %s before minting authority', async checksum => {
  await expect(generatePresignedUploadUrl('artifact', 'video/mp4', 1, 60, checksum)).rejects.toThrow('STORAGE_INVALID_UPLOAD_CHECKSUM')
  expect(getUploadUrl).not.toHaveBeenCalled()
})
