import { beforeEach, expect, test, vi } from 'vitest'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import type { AuthorizationService } from '@/server/authorization/AuthorizationService'
import {
  filterCatalogResources,
} from '@/server/authorization'
import { prepareActModelCandidates } from './model-candidates'

vi.mock('server-only', () => ({}))
vi.mock('@/server/authorization', () => ({ filterCatalogResources: vi.fn() }))

const catalogFilter = vi.mocked(filterCatalogResources)

const input = {
  authorization: {} as AuthorizationService,
  context: {} as AppApiRouteContext,
  modelId: 'openai/model',
  authorizedModelIds: new Set(['openai/model', 'anthropic/fallback', 'blocked/catalog', 'google/fallback']),
}

beforeEach(() => {
  vi.resetAllMocks()
  catalogFilter.mockImplementation(async ({ values }) => values.filter(id => id !== 'blocked/catalog'))
})

test('the selected model is the only admitted candidate', async () => {
  const result = await prepareActModelCandidates(input)
  expect(result).toEqual(['openai/model'])
  expect(catalogFilter).toHaveBeenCalledWith(expect.objectContaining({
    capability: 'models.use',
    values: ['openai/model'],
  }))
})

test('retired hosted models are rejected instead of being aliased or dispatched', async () => {
  await expect(prepareActModelCandidates({
    ...input,
    modelId: 'openrouter/deepseek/deepseek-v4-flash:free',
  })).rejects.toThrow(/MODEL_RETIRED.*Select a paid model/)
  expect(catalogFilter).not.toHaveBeenCalled()
})

test('BYOK is a singleton and never mixes Overlay-funded candidates', async () => {
  const result = await prepareActModelCandidates({
    ...input,
    modelId: 'byok/key/model',
    authorizedModelIds: new Set(),
  })

  expect(result).toEqual(['byok/key/model'])
  expect(catalogFilter).not.toHaveBeenCalled()
})
