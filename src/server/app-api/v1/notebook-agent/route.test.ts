import { beforeEach, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { DEFAULT_OVERLAY_CAPABILITIES } from '@overlay/app-core/capabilities'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'

type StopCondition = (options: { steps: unknown[] }) => boolean
type AgentSettings = {
  stopWhen: StopCondition[]
  onStepEnd: (step: { text: string; usage: { inputTokens: number; outputTokens: number } }) => Promise<void>
}

const mocks = vi.hoisted(() => ({ ensureBudgetNotLow: vi.fn(), charge: vi.fn(), reserve: vi.fn(), steps: 0 }))
vi.mock('server-only', () => ({}))
vi.mock('@/server/observability/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/server/shared/internal-api-secret', () => ({ getInternalApiSecret: () => 'secret' }))
vi.mock('@/server/ai/model-runtime', () => ({ getLanguageModel: async () => ({}) }))
vi.mock('@/server/ai/model-policy-authority', () => ({ resolveAuthorizedModelIds: async () => ({ chat: { has: () => true } }) }))
vi.mock('@/server/ai/gateway/live-model-pricing', () => ({ calculateLanguageModelTokenCostOrNull: async () => 0.01 }))
vi.mock('@/server/web/app-url', () => ({ getInternalApiBaseUrl: () => 'https://example.test' }))
vi.mock('@/server/tools/tools/overlay-executes', () => ({ executeSearchKnowledge: vi.fn() }))
vi.mock('@/server/knowledge/mention-resolver', () => ({ resolveMentionsContext: async () => '' }))
vi.mock('@/server/ai/sdk', () => ({
  tool: (definition: unknown) => definition,
  isStepCount: (count: number): StopCondition => ({ steps }) => steps.length >= count,
  // Runs model steps until a stop condition holds, like the SDK's tool loop.
  ToolLoopAgent: class {
    constructor(private readonly settings: AgentSettings) {}
    async generate() {
      const steps: unknown[] = []
      do {
        await this.settings.onStepEnd({ text: '', usage: { inputTokens: 1_000, outputTokens: 100 } })
        steps.push({})
        mocks.steps = steps.length
      } while (!this.settings.stopWhen.some(condition => condition({ steps })))
      return { text: 'done' }
    }
  },
}))
vi.mock('@/server/bootstrap', () => ({
  getOverlayServerContext: () => ({
    generationUsagePolicy: {
      getEntitlements: async () => ({ tier: 'pro', planKind: 'paid', creditsUsed: 0, creditsTotal: 100,
        budgetUsedCents: 0, budgetTotalCents: 10_000, budgetRemainingCents: 10_000 }),
      ensureBudgetNotLow: mocks.ensureBudgetNotLow,
      charge: mocks.charge,
      reserve: mocks.reserve,
    },
  }),
}))

import { POST } from './route'

const context: AppApiRouteContext = {
  params: Promise.resolve({}), auth: { userId: 'owner', accessToken: 'test', authType: 'session' },
  parsedQuery: {}, parsedJson: {}, parsedFormData: null, capabilities: DEFAULT_OVERLAY_CAPABILITIES,
  requestFingerprint: 'test', requestIdempotencyKey: null,
  workspace: {
    workspace: { id: 'workspace', kind: 'personal', name: 'QA', slug: 'qa', status: 'active', createdAt: 1, updatedAt: 1 },
    principal: { id: 'owner', userId: 'owner', workspaceId: 'workspace', type: 'human', displayName: 'QA', createdAt: 1, updatedAt: 1 },
    membership: { workspaceId: 'workspace', principalId: 'owner', role: 'owner', status: 'active', joinedAt: 1, updatedAt: 1 },
  },
}

const request = () => new NextRequest('https://example.test/api/v1/notebook-agent', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ noteContent: 'note', noteTitle: 'Title', message: 'tidy this note', modelId: 'provider/model' }),
})

async function events(response: Response) {
  return (await response.text()).trim().split('\n').map(line => JSON.parse(line) as { type: string; error?: string })
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.steps = 0
  mocks.ensureBudgetNotLow.mockResolvedValue({ ok: true, entitlements: {} })
})

test('each step is charged directly and the loop stops once a charge leaves the workspace under 2%', async () => {
  mocks.charge.mockResolvedValueOnce({ budgetLow: false }).mockResolvedValueOnce({ budgetLow: true })
  const stream = await events(await POST(request(), context))
  expect(mocks.steps).toBe(2)
  expect(mocks.charge).toHaveBeenCalledTimes(2)
  expect(mocks.charge).toHaveBeenCalledWith(expect.objectContaining({
    userId: 'owner', workspaceId: 'workspace', providerCostUsd: 0.01,
    usage: expect.objectContaining({ kind: 'agent', modelId: 'provider/model', inputTokens: 1_000, outputTokens: 100 }),
  }))
  expect(stream).toContainEqual({ type: 'error', error: 'Stopped: less than 2% of the workspace budget is left.' })
  expect(mocks.reserve).not.toHaveBeenCalled()
})

test('a workspace under 2% is refused before any step runs', async () => {
  mocks.ensureBudgetNotLow.mockResolvedValue({ ok: false, status: 402, code: 'insufficient_budget', payload: { message: 'low' } })
  const response = await POST(request(), context)
  expect(response.status).toBe(402)
  expect(mocks.steps).toBe(0)
  expect(mocks.charge).not.toHaveBeenCalled()
})
