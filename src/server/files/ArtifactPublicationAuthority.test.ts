import { beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getOverlayServerContext: vi.fn(),
  refreshNativeHarnessAccess: vi.fn(),
  refreshPersonalHarnessAccess: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: mocks.getOverlayServerContext }))
vi.mock('@/server/harness/native-access', () => ({ refreshNativeHarnessAccess: mocks.refreshNativeHarnessAccess }))
vi.mock('@/server/harness/personal-access', () => ({ refreshPersonalHarnessAccess: mocks.refreshPersonalHarnessAccess }))

import { authorizeComputerPublication } from './ArtifactPublicationAuthority'

const reference = {
  actorUserId: 'user',
  runId: 'run',
  workflowRunId: 'workflow',
}
const access = {
  actorUserId: 'user',
  workspaceId: 'workspace',
  runId: 'run',
  workflowRunId: 'workflow',
} as never

beforeEach(() => {
  vi.resetAllMocks()
  mocks.getOverlayServerContext.mockReturnValue({
    authorizationService: {
      resolveSubject: vi.fn().mockResolvedValue('subject'),
      checkResolvedCapability: vi.fn().mockReturnValue({ allowed: true }),
    },
  })
  mocks.refreshNativeHarnessAccess.mockResolvedValue({})
  mocks.refreshPersonalHarnessAccess.mockResolvedValue({})
})

test('refreshes both native tool grants and checks file-upload capability', async () => {
  const result = await authorizeComputerPublication({
    userId: 'user',
    workspaceId: 'workspace',
    artifactPublicationAuthority: { kind: 'native', access, context: {} as never },
  })
  expect(result).toEqual(reference)
  expect(mocks.refreshNativeHarnessAccess.mock.calls.map(call => call[2]))
    .toEqual(['computer_publish_file', 'write_file'])
})

test('refreshes both personal tool grants and fails closed without workspace authority', async () => {
  await expect(authorizeComputerPublication({
    userId: 'user',
    workspaceId: 'workspace',
    artifactPublicationAuthority: { kind: 'personal', access, context: {} as never },
  })).resolves.toEqual(reference)
  expect(mocks.refreshPersonalHarnessAccess.mock.calls.map(call => call[2]))
    .toEqual(['computer_publish_file', 'write_file'])
  await expect(authorizeComputerPublication({
    userId: 'user',
    artifactPublicationAuthority: { kind: 'personal', access, context: {} as never },
  })).rejects.toThrow('HARNESS_PUBLICATION_NOT_AUTHORIZED')
})

test('rejects when the files.upload capability is unavailable', async () => {
  mocks.getOverlayServerContext.mockReturnValue({
    authorizationService: {
      resolveSubject: vi.fn().mockResolvedValue('subject'),
      checkResolvedCapability: vi.fn().mockReturnValue({ allowed: false }),
    },
  })
  await expect(authorizeComputerPublication({
    userId: 'user',
    workspaceId: 'workspace',
    artifactPublicationAuthority: { kind: 'native', access, context: {} as never },
  })).rejects.toThrow('HARNESS_PUBLICATION_NOT_AUTHORIZED')
})
