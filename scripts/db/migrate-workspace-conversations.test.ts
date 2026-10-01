import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
}))

vi.mock('../../src/server/database/lazy-convex', () => ({
  lazyConvex: {
    query: mocks.query,
    mutation: mocks.mutation,
  },
}))

vi.mock('../../src/server/shared/internal-api-secret', () => ({
  getInternalApiSecret: () => 'test-internal-secret',
}))

type AuditShape = {
  conversationsMissingResourceScope: number
  messagesMissingResourceScope: number
}

function configureConvex({
  conversationsMissingResourceScope,
  messagesMissingResourceScope,
}: AuditShape) {
  // Audit query: conversations are clean, messages may still be missing the org link.
  mocks.query.mockImplementation(async (_path: string, args: { table: 'conversations' | 'messages' }) => ({
    rows: args.table === 'conversations' ? 3 : 5,
    missingConversationScope: 0,
    missingMessageAuthor: 0,
    missingResourceScope:
      args.table === 'conversations'
        ? conversationsMissingResourceScope
        : messagesMissingResourceScope,
    continueCursor: '',
    isDone: true,
  }))

  // Migration mutations: single page, nothing left to do.
  mocks.mutation.mockImplementation(async () => ({
    rows: 0,
    migrated: 0,
    scopesBound: 0,
    continueCursor: '',
    isDone: true,
  }))
}

async function flushMicrotasks(times = 200) {
  for (let i = 0; i < times; i++) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve()
  }
}

describe('migrate-workspace-conversations audit gate', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetModules()
    mocks.query.mockReset()
    mocks.mutation.mockReset()
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((_code?: number) => undefined) as never)
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    exitSpy.mockRestore()
    errorSpy.mockRestore()
    logSpy.mockRestore()
  })

  it('fails the run when only messages are still missing the resource scope link', async () => {
    configureConvex({
      conversationsMissingResourceScope: 0,
      messagesMissingResourceScope: 2,
    })

    await import('./migrate-workspace-conversations')
    await flushMicrotasks()

    // The run must NOT report success while 2 messages still lack the organization link.
    expect(logSpy).not.toHaveBeenCalled()
    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(errorSpy).toHaveBeenCalled()

    const reported = errorSpy.mock.calls[0]?.[0]
    const message = reported instanceof Error ? reported.message : String(reported)
    expect(message).toContain('Conversation migration audit failed')
    // The surfaced audit must actually carry the outstanding message count.
    expect(message).toMatch(/"missingResourceScope":\s*[1-9]/)
  })

  it('still reports success when nothing is missing the resource scope link', async () => {
    configureConvex({
      conversationsMissingResourceScope: 0,
      messagesMissingResourceScope: 0,
    })

    await import('./migrate-workspace-conversations')
    await flushMicrotasks()

    expect(exitSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledTimes(1)

    const printed = JSON.parse(String(logSpy.mock.calls[0][0]))
    expect(printed.ok).toBe(true)
    expect(printed.after.missingResourceScope).toBe(0)
  })
})