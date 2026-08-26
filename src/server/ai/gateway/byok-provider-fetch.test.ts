import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertByokProviderRequestUrl,
  assertPublicProviderAddresses,
} from './byok-provider-fetch'

test('provider fetch confines requests to the configured origin and base path', () => {
  assert.equal(
    assertByokProviderRequestUrl(
      'https://models.example.com/openai/v1',
      'https://models.example.com/openai/v1/chat/completions',
    ).pathname,
    '/openai/v1/chat/completions',
  )
  assert.throws(
    () => assertByokProviderRequestUrl(
      'https://models.example.com/openai/v1',
      'https://attacker.example/openai/v1/chat/completions',
    ),
    /escaped the configured API base URL/,
  )
  assert.throws(
    () => assertByokProviderRequestUrl(
      'https://models.example.com/openai/v1',
      'https://models.example.com/admin',
    ),
    /escaped the configured API base URL/,
  )
})

test('provider socket lookup rejects any private or local resolution', () => {
  assert.throws(
    () => assertPublicProviderAddresses('models.example.com', [
      { address: '104.18.1.2', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ]),
    /private or local network/,
  )
  assert.throws(
    () => assertPublicProviderAddresses('metadata.google.internal', [
      { address: '104.18.1.2', family: 4 },
    ]),
    /Local and metadata hostnames/,
  )
  assert.doesNotThrow(() => assertPublicProviderAddresses('models.example.com', [
    { address: '104.18.1.2', family: 4 },
    { address: '2606:4700:4700::1111', family: 6 },
  ]))
})
