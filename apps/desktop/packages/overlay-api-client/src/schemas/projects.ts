import { z } from 'zod'
import { AuthFields, BooleanQueryValue, IdQuery, IntegerQueryValue, PaginationQuery, UnknownResponse } from './common'

export const ProjectListQuery = PaginationQuery.extend({
  projectId: IdQuery,
  updatedSince: IntegerQueryValue,
  includeDeleted: BooleanQueryValue,
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
})

export const DeleteProjectRequest = z.object({
  ...AuthFields,
  projectId: z.string().min(1).optional(),
})

export const ProjectResponse = UnknownResponse
