import { beforeEach, expect, test, vi } from 'vitest'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import type { AuthorizationService } from '@/server/authorization/AuthorizationService'
import {
  filterCatalogResources,
} from '@/server/authorization'
import { isGatewayCreditLow } from '@/server/ai/gateway/gateway-credits'
import { getChatModelFallbackCandidates, getLowCreditFallbackAttemptModelIds } from '@/shared/ai/gateway/model-fallbacks'
import { prepareActModelCandidates } from './model-candidates'

vi.mock('server-only', () => ({}))
vi.mock('@/server/ai/gateway/gateway-credits', () => ({ isGatewayCreditLow: vi.fn() }))
vi.mock('@/shared/ai/gateway/model-fallbacks', () => ({
  getChatModelFallbackCandidates: vi.fn(),
  getLowCreditFallbackAttemptModelIds: vi.fn(),
}))
vi.mock('@/shared/ai/gateway/model-data', () => ({ modelUsesAiGatewayTransport: vi.fn(() => true) }))
vi.mock('@/server/authorization', () => ({ filterCatalogResources: vi.fn() }))

const creditLow = vi.mocked(isGatewayCreditLow)
const regularCandidates = vi.mocked(getChatModelFallbackCandidates)
const lowCreditCandidates = vi.mocked(getLowCreditFallbackAttemptModelIds)
const catalogFilter = vi.mocked(filterCatalogResources)

const input = {
  authorization: {} as AuthorizationService,
  context: {} as AppApiRouteContext,
  modelId: 'openai/model',
  paid: true,
  onlyAllowZdrModels: false,
  requiresVision: false,
  authorizedModelIds: new Set(['openai/model', 'anthropic/fallback', 'blocked/catalog', 'google/fallback']),
}

beforeEach(() => {
  vi.resetAllMocks()
  creditLow.mockResolvedValue(false)
  regularCandidates.mockReturnValue(['anthropic/fallback', 'blocked/account', 'blocked/catalog', 'google/fallback'])
  lowCreditCandidates.mockImplementation(({ modelId, paidFallbackModelIds }) => [
    'openrouter/free', modelId, ...paidFallbackModelIds,
  ])
  catalogFilter.mockImplementation(async ({ values }) => values.filter(id => id !== 'blocked/catalog'))
})

test('normal candidates retain fallback order after account and catalog filtering', async () => {
  const result = await prepareActModelCandidates({
    ...input,
    requiresVision: true,
  })

  expect(result).toEqual(['openai/model', 'anthropic/fallback', 'google/fallback'])
  expect(regularCandidates).toHaveBeenCalledWith(expect.objectContaining({
    modelId: 'openai/model',
    onlyAllowZdrModels: false,
    requiresVision: true,
    maxCandidates: 4,
  }))
  expect(catalogFilter).toHaveBeenCalledWith(expect.objectContaining({
    capability: 'models.use',
    values: ['openai/model', 'anthropic/fallback', 'blocked/catalog', 'google/fallback'],
  }))
})

test('low-credit candidates use low-credit order after account authorization', async () => {
  creditLow.mockResolvedValue(true)
  const result = await prepareActModelCandidates({
    ...input,
    authorizedModelIds: new Set([...input.authorizedModelIds, 'openrouter/free']),
  })

  expect(result).toEqual(['openrouter/free', 'openai/model', 'anthropic/fallback', 'google/fallback'])
  expect(lowCreditCandidates).toHaveBeenCalledWith(expect.objectContaining({
    modelId: 'openai/model',
    paid: true,
    requiresVision: false,
    paidFallbackModelIds: ['anthropic/fallback', 'blocked/catalog', 'google/fallback'],
    maxCandidates: 5,
  }))
})

test('ZDR requests do not use low-credit routing and retain ZDR constraints', async () => {
  creditLow.mockResolvedValue(true)
  const result = await prepareActModelCandidates({
    ...input,
    onlyAllowZdrModels: true,
  })

  expect(result).toEqual(['openai/model', 'anthropic/fallback', 'google/fallback'])
  expect(creditLow).not.toHaveBeenCalled()
  expect(regularCandidates).toHaveBeenCalledWith(expect.objectContaining({ onlyAllowZdrModels: true }))
})

test('BYOK is a singleton and never mixes Overlay-funded candidates', async () => {
  const result = await prepareActModelCandidates({
    ...input,
    modelId: 'byok/key/model',
    authorizedModelIds: new Set(),
  })

  expect(result).toEqual(['byok/key/model'])
  expect(regularCandidates).not.toHaveBeenCalled()
  expect(catalogFilter).not.toHaveBeenCalled()
})
