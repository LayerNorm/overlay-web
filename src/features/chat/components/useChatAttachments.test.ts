import assert from 'node:assert/strict'
import test from 'node:test'
import {
  IMAGE_ATTACHMENT_MAX_DATA_URL_CHARS,
  IMAGE_ATTACHMENTS_MAX_TOTAL_DATA_URL_CHARS,
  attachedImagesTotalDataUrlChars,
} from './useChatAttachments'

test('attachedImagesTotalDataUrlChars sums payload sizes', () => {
  assert.equal(attachedImagesTotalDataUrlChars([]), 0)
  assert.equal(
    attachedImagesTotalDataUrlChars([{ dataUrl: 'x'.repeat(100) }, { dataUrl: 'y'.repeat(250) }]),
    350,
  )
})

test('image size caps keep the message JSON body under the request limit', () => {
  // Two attachments at the per-image cap must still fit under the total cap…
  assert.ok(IMAGE_ATTACHMENT_MAX_DATA_URL_CHARS * 2 <= IMAGE_ATTACHMENTS_MAX_TOTAL_DATA_URL_CHARS)
  // …while the total stays safely below the ~4.5 MB platform body limit
  // (base64 chars ≈ bytes × 4/3, plus JSON overhead).
  assert.ok(IMAGE_ATTACHMENTS_MAX_TOTAL_DATA_URL_CHARS < 4_500_000)
})
