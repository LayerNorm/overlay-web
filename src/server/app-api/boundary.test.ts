import assert from 'node:assert/strict'
import test from 'node:test'
import type { NextRequest } from 'next/server'
import { parseApiBoundaryInput } from './boundary'

test('identity uploads defer multipart parsing until after authorization', async () => {
  for (const pathname of [
    '/api/v1/account/profile/photo',
    '/api/v1/workspaces/ws_1/profile/photo',
    '/api/v1/workspaces/ws_1/icon',
  ]) {
    let bodyParsed = false
    const request = {
      headers: new Headers({
        'content-type': 'multipart/form-data; boundary=identity-upload',
      }),
      nextUrl: new URL(`http://localhost${pathname}`),
      method: 'POST',
      clone() {
        bodyParsed = true
        return { formData: async () => new FormData() }
      },
    } as unknown as NextRequest

    const parsed = await parseApiBoundaryInput(request)

    assert.equal(parsed.error, null)
    assert.equal(bodyParsed, false)
  }
})
