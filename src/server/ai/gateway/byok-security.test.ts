import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CUSTOM_BYOK_PROVIDER_ID,
  DEFAULT_GATEWAY_PROVIDER_ID,
  assertByokRuntimeConnectionAllowed,
  byokEndpointMatchesPreset,
  normalizeByokEndpoint,
  resolveByokEndpointForCreate,
  resolveByokEndpointForPatch,
  type ByokRuntimeConnectionForSecurity,
} from './byok-security'

const activeOpenRouterConnection: ByokRuntimeConnectionForSecurity = {
  providerId: 'openrouter',
  endpoint: 'https://openrouter.ai/api/v1',
  enabledModelIds: ['anthropic/claude-sonnet-4.6'],
  isDefault: false,
  status: 'active',
}

test('normalizes endpoint trailing slashes for comparisons', () => {
  assert.equal(normalizeByokEndpoint(' https://openrouter.ai/api/v1/// '), 'https://openrouter.ai/api/v1')
  assert.equal(byokEndpointMatchesPreset('openrouter', 'https://openrouter.ai/api/v1/'), true)
})

test('create rejects managed default Overlay provider', () => {
  const result = resolveByokEndpointForCreate(DEFAULT_GATEWAY_PROVIDER_ID, 'https://ai-gateway.vercel.sh/v1')
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.status, 403)
    assert.match(result.error, /managed automatically/)
  }
})

test('create rejects custom endpoints for preset-locked providers', () => {
  const result = resolveByokEndpointForCreate('openrouter', 'https://attacker.example/v1')
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.status, 403)
    assert.match(result.error, /endpoint cannot be changed/)
  }
})

test('create allows preset-locked providers only at their default endpoint', () => {
  const result = resolveByokEndpointForCreate('openrouter', 'https://openrouter.ai/api/v1/')
  assert.deepEqual(result, { ok: true, endpoint: 'https://openrouter.ai/api/v1' })
})

test('create allows Vercel AI Gateway BYOK at the locked Vercel endpoint', () => {
  const result = resolveByokEndpointForCreate('user-vercel-ai-gateway', undefined)
  assert.deepEqual(result, { ok: true, endpoint: 'https://ai-gateway.vercel.sh/v1' })
})

test('create rejects custom endpoints for Vercel AI Gateway BYOK', () => {
  const result = resolveByokEndpointForCreate('user-vercel-ai-gateway', 'https://attacker.example/v1')
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.status, 403)
    assert.match(result.error, /endpoint cannot be changed/)
  }
})

test('patch rejects endpoint mutation for preset-locked providers', () => {
  const result = resolveByokEndpointForPatch(DEFAULT_GATEWAY_PROVIDER_ID, 'https://attacker.example/v1')
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.status, 403)
    assert.match(result.error, /endpoint cannot be changed/)
  }
})

test('patch rejects unknown providers', () => {
  const result = resolveByokEndpointForPatch('custom', 'https://models.example.com/v1')
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.status, 400)
    assert.match(result.error, /Unknown provider/)
  }
})

test('custom provider requires and normalizes a user HTTPS API base URL', () => {
  assert.deepEqual(
    resolveByokEndpointForCreate(CUSTOM_BYOK_PROVIDER_ID, ' https://models.example.com/v1/// '),
    { ok: true, endpoint: 'https://models.example.com/v1' },
  )
  assert.equal(byokEndpointMatchesPreset(
    CUSTOM_BYOK_PROVIDER_ID,
    'https://models.example.com/v1',
  ), true)
  assert.equal(resolveByokEndpointForCreate(CUSTOM_BYOK_PROVIDER_ID, undefined).ok, false)
})

test('custom provider rejects unsafe API base URL syntax', () => {
  for (const endpoint of [
    'http://models.example.com/v1',
    'https://user:password@models.example.com/v1',
    'https://models.example.com/v1?token=secret',
    'https://models.example.com/v1#fragment',
  ]) {
    const result = resolveByokEndpointForCreate(CUSTOM_BYOK_PROVIDER_ID, endpoint)
    assert.equal(result.ok, false, endpoint)
  }
})

test('custom provider endpoint can be changed to another valid HTTPS API URL', () => {
  assert.deepEqual(
    resolveByokEndpointForPatch(CUSTOM_BYOK_PROVIDER_ID, 'https://new.example.com/openai/v1/'),
    { ok: true, endpoint: 'https://new.example.com/openai/v1' },
  )
})

test('runtime rejects hosted default Overlay BYOK model ids', () => {
  assert.throws(
    () => assertByokRuntimeConnectionAllowed({
      providerId: DEFAULT_GATEWAY_PROVIDER_ID,
      endpoint: 'https://ai-gateway.vercel.sh/v1',
      enabledModelIds: ['openai/gpt-5.4'],
      isDefault: true,
      status: 'active',
    }, 'openai/gpt-5.4'),
    /default Overlay connection cannot be used through BYOK/,
  )
})

test('runtime rejects disabled raw model ids', () => {
  assert.throws(
    () => assertByokRuntimeConnectionAllowed(activeOpenRouterConnection, 'openai/gpt-5.4'),
    /not enabled/,
  )
})

test('runtime rejects inactive provider connections', () => {
  assert.throws(
    () => assertByokRuntimeConnectionAllowed({
      ...activeOpenRouterConnection,
      status: 'untested',
    }, 'anthropic/claude-sonnet-4.6'),
    /not active/,
  )
})

test('runtime rejects preset providers stored with a non-default endpoint', () => {
  assert.throws(
    () => assertByokRuntimeConnectionAllowed({
      ...activeOpenRouterConnection,
      endpoint: 'https://attacker.example/v1',
    }, 'anthropic/claude-sonnet-4.6'),
    /does not match the locked provider endpoint/,
  )
})

test('runtime rejects providers outside the locked preset registry', () => {
  assert.throws(() => assertByokRuntimeConnectionAllowed({
    providerId: 'custom',
    endpoint: 'https://models.example.com/v1',
    enabledModelIds: ['z-ai/glm-5.2'],
    isDefault: false,
    status: 'active',
  }, 'z-ai/glm-5.2'), /not supported/)
})

test('runtime allows an active custom provider with an enabled model', () => {
  assert.doesNotThrow(() => assertByokRuntimeConnectionAllowed({
    providerId: CUSTOM_BYOK_PROVIDER_ID,
    endpoint: 'https://models.example.com/v1',
    enabledModelIds: ['organization/model-1'],
    isDefault: false,
    status: 'active',
  }, 'organization/model-1'))
})

test('runtime allows active Vercel AI Gateway BYOK enabled models at the locked endpoint', () => {
  assert.doesNotThrow(() => assertByokRuntimeConnectionAllowed({
    providerId: 'user-vercel-ai-gateway',
    endpoint: 'https://ai-gateway.vercel.sh/v1',
    enabledModelIds: ['openai/gpt-5.4'],
    isDefault: false,
    status: 'active',
  }, 'openai/gpt-5.4'))
})

test('runtime rejects Vercel AI Gateway BYOK models at non-Vercel endpoints', () => {
  assert.throws(
    () => assertByokRuntimeConnectionAllowed({
      providerId: 'user-vercel-ai-gateway',
      endpoint: 'https://attacker.example/v1',
      enabledModelIds: ['openai/gpt-5.4'],
      isDefault: false,
      status: 'active',
    }, 'openai/gpt-5.4'),
    /does not match the locked provider endpoint/,
  )
})
