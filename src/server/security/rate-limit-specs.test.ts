import assert from 'node:assert/strict'
import test from 'node:test'
import { getEndpointRateLimitSpecs } from './rate-limit-specs'

test('owner-funded routes receive user, organization, risk, IP, and global limits', () => {
  const rules = getEndpointRateLimitSpecs({
    deviceRiskKey: 'risk_1',
    ip: '203.0.113.5',
    method: 'POST',
    organizationId: 'org_1',
    pathname: '/api/v1/generate-image',
    userId: 'user_1',
  })
  const byBucket = new Map(rules.map((rule) => [rule.bucket, rule]))

  assert.equal(byBucket.get('generation:image:ip')?.key, '203.0.113.5')
  assert.equal(byBucket.get('generation:image:user')?.key, 'user_1')
  assert.equal(byBucket.get('owner-funded:user')?.key, 'user_1')
  assert.equal(byBucket.get('owner-funded:organization')?.key, 'org_1')
  assert.equal(byBucket.get('owner-funded:device-risk')?.key, 'risk_1')
  assert.equal(byBucket.get('owner-funded:global')?.key, 'global')
})

test('non-owner-funded routes do not consume provider-wide buckets', () => {
  const rules = getEndpointRateLimitSpecs({
    deviceRiskKey: 'risk_1',
    ip: '203.0.113.5',
    method: 'GET',
    organizationId: 'org_1',
    pathname: '/api/v1/files/presign',
    userId: 'user_1',
  })
  assert.equal(
    rules.some((rule) => rule.bucket.startsWith('owner-funded:')),
    false,
  )
})
