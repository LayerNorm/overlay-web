import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  DeleteProjectTreeResult,
  ProjectRecord,
  ProjectRepository,
} from './ProjectRepository'
import { ProjectRepositoryError } from './ProjectRepository'
import { ProjectService, ProjectServiceError } from './ProjectService'

const project: ProjectRecord = {
  _id: 'project_1',
  userId: 'user_1',
  name: 'Project',
  createdAt: 1,
  updatedAt: 1,
}

test('ProjectService normalizes create and explicit clear updates', async () => {
  let createArgs: Parameters<ProjectRepository['createProject']>[0] | undefined
  let updateArgs: Parameters<ProjectRepository['updateProject']>[0] | undefined
  const service = new ProjectService(repository({
    createProject: async (args) => {
      createArgs = args
      return project
    },
    updateProject: async (args) => {
      updateArgs = args
      return project
    },
  }))

  await service.createProject({
    clientId: ' client ',
    instructions: ' instructions ',
    name: ' Project ',
    parentId: null,
    userId: 'user_1',
  })
  assert.deepEqual(createArgs, {
    clientId: 'client',
    instructions: 'instructions',
    name: 'Project',
    parentId: null,
    userId: 'user_1',
  })

  await service.updateProject({
    instructions: ' ',
    parentId: null,
    projectId: 'project_1',
    userId: 'user_1',
  })
  assert.equal(updateArgs?.instructions, null)
  assert.equal(updateArgs?.parentId, null)
})

test('ProjectService rejects blank names and maps hierarchy failures', async () => {
  const service = new ProjectService(repository({
    createProject: async () => {
      throw new ProjectRepositoryError('Invalid parent project', 'invalid_parent')
    },
  }))

  await assert.rejects(
    service.createProject({ name: ' ', userId: 'user_1' }),
    (error: unknown) => error instanceof ProjectServiceError && error.statusCode === 400,
  )
  await assert.rejects(
    service.createProject({ name: 'Project', parentId: 'missing', userId: 'user_1' }),
    (error: unknown) => error instanceof ProjectServiceError && error.statusCode === 400,
  )
})

test('ProjectService maps missing updates and deletes to not found', async () => {
  const service = new ProjectService(repository({
    deleteProjectTree: async () => null,
    updateProject: async () => null,
  }))
  await assert.rejects(
    service.updateProject({ projectId: 'missing', userId: 'user_1' }),
    (error: unknown) => error instanceof ProjectServiceError && error.statusCode === 404,
  )
  await assert.rejects(
    service.deleteProjectTree({ projectId: 'missing', userId: 'user_1' }),
    (error: unknown) => error instanceof ProjectServiceError && error.statusCode === 404,
  )
})

function repository(
  overrides: Partial<ProjectRepository>,
): ProjectRepository {
  return {
    getProject: async () => project,
    listProjects: async () => [project],
    createProject: async () => project,
    updateProject: async () => project,
    deleteProjectTree: async (): Promise<DeleteProjectTreeResult> => ({
      deletedAt: 1,
      deletedIds: ['project_1'],
      deletedConversationIds: [],
      deletedFileIds: [],
      deletedNoteIds: [],
    }),
    ...overrides,
  }
}
