import assert from 'node:assert/strict'
import test from 'node:test'

import { ByokGateway } from './adapters/byok-gateway'
import { BYOK_PROVIDER_PRESETS, getByokPreset } from './adapters/byok-presets'

test('BYOK provider registry contains only fixed HTTPS vendor endpoints', () => {
  assert.ok(BYOK_PROVIDER_PRESETS.length > 0)
  for (const preset of BYOK_PROVIDER_PRESETS) {
    assert.equal(new URL(preset.defaultBaseURL).protocol, 'https:')
    assert.equal(getByokPreset(preset.id), preset)
  }
})

test('BYOK gateway rejects unknown providers, missing keys, and endpoint overrides', () => {
  assert.throws(() => new ByokGateway({
    connection: { providerId: 'unknown', endpoint: 'https://attacker.example/v1' },
    apiKey: 'secret',
  }), /Unknown BYOK provider preset/)

  assert.throws(() => new ByokGateway({
    connection: { providerId: 'openrouter', endpoint: 'https://attacker.example/v1' },
    apiKey: 'secret',
  }), /locked provider endpoint/)

  assert.throws(() => new ByokGateway({
    connection: { providerId: 'openrouter', endpoint: 'https://openrouter.ai/api/v1' },
    apiKey: null,
  }), /requires an API key/)
})
