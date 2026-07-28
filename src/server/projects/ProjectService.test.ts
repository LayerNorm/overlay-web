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
    archived: true,
    instructions: ' ',
    knowledgeBaseId: null,
    parentId: null,
    projectId: 'project_1',
    userId: 'user_1',
  })
  assert.equal(typeof updateArgs?.archivedAt, 'number')
  assert.equal(updateArgs?.instructions, null)
  assert.equal(updateArgs?.knowledgeBaseId, null)
  assert.equal(updateArgs?.parentId, null)
})

test('ProjectService verifies knowledge-base access before attaching it', async () => {
  const accessChecks: Array<{ knowledgeBaseId: string; userId: string }> = []
  let createArgs: Parameters<ProjectRepository['createProject']>[0] | undefined
  let updateArgs: Parameters<ProjectRepository['updateProject']>[0] | undefined
  const service = new ProjectService(repository({
    createProject: async (args) => {
      createArgs = args
      return { ...project, knowledgeBaseId: args.knowledgeBaseId }
    },
    updateProject: async (args) => {
      updateArgs = args
      return { ...project, knowledgeBaseId: args.knowledgeBaseId }
    },
  }), {
    assertKnowledgeBaseAccess: async (args) => {
      accessChecks.push(args)
    },
  })

  await service.createProject({
    knowledgeBaseId: ' kb_1 ',
    name: 'Project',
    userId: 'user_1',
  })
  await service.updateProject({
    knowledgeBaseId: ' kb_2 ',
    projectId: 'project_1',
    userId: 'user_1',
  })
  await service.updateProject({
    knowledgeBaseId: null,
    projectId: 'project_1',
    userId: 'user_1',
  })

  assert.deepEqual(accessChecks, [
    { knowledgeBaseId: 'kb_1', userId: 'user_1' },
    { knowledgeBaseId: 'kb_2', userId: 'user_1' },
  ])
  assert.equal(createArgs?.knowledgeBaseId, 'kb_1')
  assert.equal(updateArgs?.knowledgeBaseId, null)
})

test('ProjectService does not persist a knowledge base when access is denied', async () => {
  let mutationCalls = 0
  const service = new ProjectService(repository({
    updateProject: async () => {
      mutationCalls += 1
      return project
    },
  }), {
    assertKnowledgeBaseAccess: async () => {
      throw new ProjectServiceError('Knowledge base not found', 404)
    },
  })

  await assert.rejects(
    service.updateProject({
      knowledgeBaseId: 'foreign_kb',
      projectId: 'project_1',
      userId: 'user_1',
    }),
    (error: unknown) => error instanceof ProjectServiceError && error.statusCode === 404,
  )
  assert.equal(mutationCalls, 0)
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
      deletedMemoryIds: [],
      deletedNoteIds: [],
    }),
    ...overrides,
  }
}

test('createProject persists settings rather than dropping them', async () => {
  const calls: Array<Record<string, unknown>> = []
  const service = new ProjectService({
    async createProject(args: Record<string, unknown>) {
      calls.push(args)
      return { _id: 'p1', name: 'P', userId: 'u1', createdAt: 1, updatedAt: 1 }
    },
  } as unknown as ProjectRepository)

  await service.createProject({
    name: 'P',
    settings: { toolPolicy: { mode: 'allowlist', toolIds: ['search_knowledge_base'] } },
    userId: 'u1',
  })
  assert.deepEqual(
    (calls[0]!.settings as Record<string, unknown>)?.toolPolicy,
    { mode: 'allowlist', toolIds: ['search_knowledge_base'] },
    'settings supplied at creation must reach the repository',
  )
})

test('updateProject persists settings rather than dropping them', async () => {
  const calls: Array<Record<string, unknown>> = []
  const service = new ProjectService({
    async updateProject(args: Record<string, unknown>) {
      calls.push(args)
      return { _id: 'p1', name: 'P', userId: 'u1', createdAt: 1, updatedAt: 1 }
    },
  } as unknown as ProjectRepository)

  await service.updateProject({
    projectId: 'p1',
    settings: { automationsEnabled: false },
    userId: 'u1',
  })
  assert.equal((calls[0]!.settings as Record<string, unknown>)?.automationsEnabled, false)
})

test('duplicating copies configuration but no private working data', async () => {
  const created: Array<Record<string, unknown>> = []
  const service = new ProjectService({
    async getProject() {
      return {
        _id: 'source',
        name: 'Client Alpha',
        userId: 'u1',
        instructions: 'Write formally.',
        settings: {
          preferredModelId: 'anthropic/claude',
          toolPolicy: { mode: 'denylist', toolIds: ['generate_image'] },
          isTemplate: true,
        },
        createdAt: 1,
        updatedAt: 1,
      }
    },
    async createProject(args: Record<string, unknown>) {
      created.push(args)
      return { _id: 'copy', name: String(args.name), userId: 'u1', createdAt: 2, updatedAt: 2 }
    },
  } as unknown as ProjectRepository)

  const copy = await service.duplicateProject({ sourceProjectId: 'source', userId: 'u1' })
  assert.equal(copy._id, 'copy')

  const args = created[0]!
  assert.equal(args.name, 'Client Alpha copy')
  assert.equal(args.instructions, 'Write formally.')
  const settings = args.settings as Record<string, unknown>
  assert.equal(settings.preferredModelId, 'anthropic/claude')
  assert.deepEqual(settings.toolPolicy, { mode: 'denylist', toolIds: ['generate_image'] })
  // An instance of a template is not itself a template.
  assert.equal(settings.isTemplate, undefined)
  // Nothing that could carry another engagement's private content.
  for (const forbidden of ['clientId', 'conversations', 'files', 'notes', 'outputs']) {
    assert.equal(args[forbidden], undefined, `duplicate must not carry ${forbidden}`)
  }
})

test('duplicating a project that does not exist is a not-found', async () => {
  const service = new ProjectService({
    async getProject() { return null },
  } as unknown as ProjectRepository)
  await assert.rejects(
    () => service.duplicateProject({ sourceProjectId: 'missing', userId: 'u1' }),
    (error: unknown) => error instanceof ProjectServiceError && error.statusCode === 404,
  )
})

test('listTemplates returns only projects flagged as templates', async () => {
  const service = new ProjectService({
    async listProjects() {
      return [
        { _id: 'a', name: 'A', userId: 'u1', settings: { isTemplate: true }, createdAt: 1, updatedAt: 1 },
        { _id: 'b', name: 'B', userId: 'u1', settings: {}, createdAt: 1, updatedAt: 1 },
        { _id: 'c', name: 'C', userId: 'u1', createdAt: 1, updatedAt: 1 },
      ]
    },
  } as unknown as ProjectRepository)
  assert.deepEqual((await service.listTemplates({ userId: 'u1' })).map((p) => p._id), ['a'])
})
