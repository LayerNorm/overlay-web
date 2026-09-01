import { z } from 'zod'
import { AuthFields, BooleanQueryValue, IdQuery, IntegerQueryValue, PaginationQuery, UnknownResponse } from './common'

export const ProjectListQuery = PaginationQuery.extend({
  projectId: IdQuery,
  updatedSince: IntegerQueryValue,
  includeDeleted: BooleanQueryValue,
  archived: BooleanQueryValue,
})

export const CreateProjectRequest = z.object({
  ...AuthFields,
  name: z.string().min(1).max(200).optional(),
  parentId: z.string().min(1).nullable().optional(),
  instructions: z.string().optional(),
  clientId: z.string().optional(),
  description: z.string().optional(),
  color: z.string().optional(),
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

export const ProjectResponse = UnknownResponse

export const ProjectExportQuery = z.object({
  projectId: z.string().min(1),
}).passthrough()

export const ProjectShareDirectoryQuery = z.object({}).passthrough()

export const ProjectKnowledgeBaseListQuery = z.object({
  projectId: IdQuery,
}).passthrough()

export const AttachProjectKnowledgeBaseRequest = z.object({
  ...AuthFields,
  projectId: z.string().min(1),
  knowledgeBaseId: z.string().min(1),
}).passthrough()

export const DetachProjectKnowledgeBaseRequest = z.object({
  projectId: z.string().min(1),
  knowledgeBaseId: z.string().min(1),
}).passthrough()

export const ProjectKnowledgeTransferRequest = z.object({
  ...AuthFields,
  projectId: z.string().min(1).optional(),
  knowledgeBaseId: z.string().min(1).optional(),
  direction: z.enum(['promote', 'copy', 'save-answer']),
  fileId: z.string().min(1).optional(),
  sourceId: z.string().min(1).optional(),
  conversationId: z.string().min(1).optional(),
  messageId: z.string().min(1).optional(),
  content: z.string().optional(),
  title: z.string().optional(),
}).passthrough()

export const ProjectTemplateListQuery = PaginationQuery.extend({
  updatedSince: IntegerQueryValue,
  includeDeleted: BooleanQueryValue,
}).passthrough()

export const DuplicateProjectRequest = z.object({
  ...AuthFields,
  sourceProjectId: z.string().min(1),
  name: z.string().min(1).max(200).optional(),
}).passthrough()

export const ProjectGrantListQuery = z.object({
  ...AuthFields,
  projectId: z.string().min(1),
}).passthrough()

export const CreateProjectGrantRequest = z.object({
  ...AuthFields,
  projectId: z.string().min(1),
  principalId: z.string().min(1),
  principalType: z.enum(['user', 'group', 'role']),
  accessRole: z.enum(['viewer', 'editor']),
}).passthrough()

export const DeleteProjectGrantRequest = z.object({
  ...AuthFields,
  projectId: z.string().min(1),
  grantId: z.string().min(1),
}).passthrough()
