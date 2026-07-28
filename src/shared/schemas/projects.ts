import { z } from 'zod'
import { AuthFields, BooleanQueryValue, IdQuery, IntegerQueryValue, PaginationQuery, UnknownResponse } from './common'

/** Per-project configuration. Unknown keys are dropped server-side. */
export const ProjectSettingsInput = z.object({
  preferredModelId: z.string().min(1).max(200).optional(),
  toolPolicy: z.object({
    mode: z.enum(['inherit', 'allowlist', 'denylist']),
    toolIds: z.array(z.string().min(1)).max(200).optional(),
  }).optional(),
  enabledSkillIds: z.array(z.string().min(1)).max(200).optional(),
  enabledMcpServerIds: z.array(z.string().min(1)).max(200).optional(),
  enabledConnectorSlugs: z.array(z.string().min(1)).max(200).optional(),
  automationsEnabled: z.boolean().optional(),
  isTemplate: z.boolean().optional(),
})

export const ProjectListQuery = PaginationQuery.extend({
  projectId: IdQuery,
  updatedSince: IntegerQueryValue,
  includeArchived: BooleanQueryValue,
  includeDeleted: BooleanQueryValue,
})

export const CreateProjectRequest = z.object({
  ...AuthFields,
  name: z.string().min(1).max(200).optional(),
  parentId: z.string().min(1).nullable().optional(),
  instructions: z.string().optional(),
  knowledgeBaseId: z.string().min(1).nullable().optional(),
  clientId: z.string().optional(),
  description: z.string().optional(),
  color: z.string().optional(),
  settings: ProjectSettingsInput.optional(),
}).passthrough()

export const UpdateProjectRequest = CreateProjectRequest.partial().extend({
  ...AuthFields,
  projectId: z.string().min(1),
  archived: z.boolean().optional(),
})

export const DeleteProjectRequest = z.object({
  ...AuthFields,
  projectId: z.string().min(1).optional(),
})

export const ProjectKnowledgeBaseListQuery = z.object({
  projectId: IdQuery,
})

export const AttachProjectKnowledgeBaseRequest = z.object({
  ...AuthFields,
  projectId: z.string().min(1),
  knowledgeBaseId: z.string().min(1),
})

export const DetachProjectKnowledgeBaseRequest = AttachProjectKnowledgeBaseRequest

/** Explicit transfer between a project and a knowledge base. */
export const ProjectKnowledgeTransferRequest = z.object({
  ...AuthFields,
  projectId: z.string().min(1),
  knowledgeBaseId: z.string().min(1),
  direction: z.enum(['promote', 'copy']),
  /** Required when promoting a project file into the knowledge base. */
  fileId: z.string().min(1).optional(),
  /** Required when copying a knowledge source into the project. */
  sourceId: z.string().min(1).optional(),
  title: z.string().trim().min(1).max(240).optional(),
}).refine(
  (value) => (value.direction === 'promote' ? Boolean(value.fileId) : Boolean(value.sourceId)),
  { message: 'promote requires fileId; copy requires sourceId' },
)

export const ProjectResponse = UnknownResponse
