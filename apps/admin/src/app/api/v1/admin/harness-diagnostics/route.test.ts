import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'
import { GET } from './route'
import { createHarnessDiagnosticHandler } from './handler'
import type { AdminRouteContext } from '@/server/guard'

function context(role: 'admin' | 'auditor' | 'billing_admin' | 'support'): AdminRouteContext {
  return { operator: { principal: { role } } } as AdminRouteContext
}

function request(query: string): NextRequest {
  return new NextRequest(`https://admin.example.invalid/api/v1/admin/harness-diagnostics${query}`)
}

test('diagnostic lookup rejects invalid, repeated, and extra query parameters', async () => {
  const handler = createHarnessDiagnosticHandler(async () => assert.fail('lookup must not run'))
  for (const query of ['', '?diagnosticId=', '?diagnosticId=has%20spaces',
    '?diagnosticId=hd_one&diagnosticId=hd_two', '?diagnosticId=hd_one&extra=true']) {
    const response = await handler(request(query), context('admin'))
    assert.equal(response.status, 400, query)
  }
})

test('billing-only operators receive 403 without calling the backend', async () => {
  const handler = createHarnessDiagnosticHandler(async () => assert.fail('billing-only role must be denied'))
  const response = await handler(request('?diagnosticId=hd_test'), context('billing_admin'))
  assert.equal(response.status, 403)
})

test('diagnostic lookup sends only the requested ID and returns the bounded result', async () => {
  const result = { found: true, diagnosticId: 'hd_test', runId: 'run-safe', causeUnavailable: true }
  const lookedUp: string[] = []
  const handler = createHarnessDiagnosticHandler(async diagnosticId => {
    lookedUp.push(diagnosticId)
    return result
  })
  for (const role of ['admin', 'auditor', 'support'] as const) {
    const response = await handler(request('?diagnosticId=hd_test'), context(role))
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await response.json(), result)
  }
  assert.deepEqual(lookedUp, ['hd_test', 'hd_test', 'hd_test'])
})

test('the authenticated route wrapper returns 401 before lookup for anonymous requests', async () => {
  const response = await GET(request('?diagnosticId=hd_test'))
  assert.equal(response.status, 401)
})
