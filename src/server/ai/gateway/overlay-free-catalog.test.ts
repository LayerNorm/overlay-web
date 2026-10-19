import assert from 'node:assert/strict'
import test from 'node:test'
import {
  currentGatewayEndpoint,
  currentOpenRouterFreeModel,
  gatewayModelHasZeroPricing,
  parseGatewayEndpoints,
  parseGatewayModels,
} from './overlay-free-catalog'

const gatewayModel = {
  id: 'minimax/minimax-m3.1-flash',
  type: 'language',
  pricing: { input: '0', output: '0' },
}

const gatewayEndpointsResponse = {
  data: {
    id: 'minimax/minimax-m3.1-flash',
    endpoints: [{
      provider_name: 'minimax',
      context_length: 1_000_000,
      max_completion_tokens: 524_288,
      tags: ['reasoning', 'tool-use', 'vision', 'structured-output'],
      supported_parameters: ['tools', 'tool_choice', 'response_format', 'structured_outputs'],
      pricing: {
        prompt: '0', completion: '0', request: '0', image: '0', image_output: '0',
        web_search: '0', internal_reasoning: '0', input_cache_read: '0', discount: 0,
      },
    }],
  },
}

test('parses Vercel model and endpoint catalog response shapes and pricing keys', () => {
  assert.equal(gatewayModelHasZeroPricing(parseGatewayModels({ data: [gatewayModel] })[0]), true)
  const endpoints = parseGatewayEndpoints(gatewayEndpointsResponse)
  assert.equal(endpoints.length, 1)
  assert.deepEqual(currentGatewayEndpoint(
    gatewayEndpointsResponse,
    'minimax/minimax-m3.1-flash',
    'minimax',
  )?.capabilities, {
    contextWindow: 1_000_000,
    maxOutputTokens: 524_288,
    supportsTools: true,
    supportsVision: true,
    supportsJson: true,
  })
})

test('validates the exact OpenRouter free catalog entry and its native pricing keys', () => {
  const catalog = {
    data: [{
      id: 'openrouter/free',
      context_length: 200_000,
      architecture: { input_modalities: ['text', 'image'] },
      supported_parameters: ['tools', 'tool_choice', 'response_format', 'structured_outputs'],
      pricing: { prompt: '0', completion: '0' },
    }],
  }
  assert.deepEqual(currentOpenRouterFreeModel(catalog)?.capabilities, {
    contextWindow: 200_000,
    maxOutputTokens: 200_000,
    supportsTools: true,
    supportsVision: true,
    supportsJson: true,
  })
  assert.equal(currentOpenRouterFreeModel({
    data: [{ ...catalog.data[0], id: 'provider/model' }],
  }), null)
  assert.equal(currentOpenRouterFreeModel({
    data: [{ ...catalog.data[0], pricing: { prompt: '0', completion: '0.00001' } }],
  }), null)
})

test('rejects mismatched models and missing or nonzero Vercel endpoint prices', () => {
  assert.equal(currentGatewayEndpoint(gatewayEndpointsResponse, 'different/model', 'minimax'), null)
  assert.equal(currentGatewayEndpoint({ data: { id: gatewayModel.id, endpoints: [{
    ...gatewayEndpointsResponse.data.endpoints[0],
    pricing: { prompt: '0', completion: '0.000001' },
  }] } }, 'minimax/minimax-m3.1-flash', 'minimax'), null)
  assert.equal(currentGatewayEndpoint({ data: { id: gatewayModel.id, endpoints: [{
    ...gatewayEndpointsResponse.data.endpoints[0],
    pricing: { prompt: '0' },
  }] } }, 'minimax/minimax-m3.1-flash', 'minimax'), null)
})
