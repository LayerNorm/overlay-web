import assert from 'node:assert/strict'
import test from 'node:test'
import { POST } from './route'

test('dependency callback refuses absent/wrong secrets and invalid requests', async () => {
  const previous = process.env.INTERNAL_API_SECRET
  process.env.INTERNAL_API_SECRET = 'work-callback-test'
  const request = (secret?: string, body = '{}') => new Request('https://example.test/api/v1/work/resume-assignment', { method: 'POST', headers: secret ? { 'x-internal-api-secret': secret } : {}, body })
  try {
    assert.equal((await POST(request())).status, 401)
    assert.equal((await POST(request('wrong'))).status, 401)
    assert.equal((await POST(request('work-callback-test', '{'))).status, 400)
    assert.equal((await POST(request('work-callback-test', 'null'))).status, 400)
    assert.equal((await POST(request('work-callback-test'))).status, 400)
    delete process.env.INTERNAL_API_SECRET
    assert.equal((await POST(request('work-callback-test'))).status, 503)
  } finally {
    if (previous === undefined) delete process.env.INTERNAL_API_SECRET
    else process.env.INTERNAL_API_SECRET = previous
  }
})
