import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import { processIdentityImage } from './profile-media'

test('identity uploads accept matching image signatures and emit bounded WebP', async () => {
  const png = await sharp({
    create: { width: 32, height: 18, channels: 3, background: '#8844cc' },
  }).png().toBuffer()
  const file = new File([png], 'avatar.png', { type: 'image/png' })
  const result = await processIdentityImage(file)
  const metadata = await sharp(result).metadata()
  assert.equal(metadata.format, 'webp')
  assert.ok(metadata.width <= 512)
  assert.equal(metadata.width, metadata.height)
  assert.equal(metadata.exif, undefined)
})

test('identity uploads reject mismatched content signatures', async () => {
  const png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: '#8844cc' },
  }).png().toBuffer()
  const file = new File([png], 'avatar.jpg', { type: 'image/jpeg' })
  await assert.rejects(() => processIdentityImage(file), /IDENTITY_UPLOAD_FORMAT/)
})

test('identity uploads reject files above the byte limit', async () => {
  const file = new File([Buffer.alloc(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })
  await assert.rejects(() => processIdentityImage(file), /IDENTITY_UPLOAD_SIZE/)
})
