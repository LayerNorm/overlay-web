import { beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ byok: vi.fn(), catalog: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/server/ai/model-runtime', () => ({ assertUserCanUseByokModel: mocks.byok }))
vi.mock('@/server/ai/model-policy-authority', () => ({ resolveCatalogModelIds: mocks.catalog }))

import { assertAgentModelSelectable } from './agent-model-selection'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.catalog.mockResolvedValue({ chat: new Set(['provider/real-model']) })
  mocks.byok.mockResolvedValue({})
})

test('a catalog model is accepted and an invented one is refused with the default named', async () => {
  await expect(assertAgentModelSelectable('provider/real-model', 'user', 'workspace')).resolves.toBeUndefined()
  await expect(assertAgentModelSelectable('gpt-made-up', 'user', 'workspace')).rejects.toMatchObject({
    code: 'validation', message: expect.stringMatching(/"gpt-made-up" is not a model Overlay offers.*default/),
  })
  expect(mocks.byok).not.toHaveBeenCalled()
})

test('a connected model is checked against the person\'s own connection instead of the catalog', async () => {
  await expect(assertAgentModelSelectable('byok/connection/model', 'user', 'workspace')).resolves.toBeUndefined()
  expect(mocks.byok).toHaveBeenCalledExactlyOnceWith('byok/connection/model', 'user', 'workspace')
  mocks.byok.mockRejectedValueOnce(new Error('BYOK connection not found.'))
  await expect(assertAgentModelSelectable('byok/other/model', 'user', 'workspace')).rejects.toMatchObject({ code: 'validation' })
  expect(mocks.catalog).not.toHaveBeenCalled()
})
