import type { PaginationQuery } from '../shared/types'
import type { ResourceGrant } from '@overlay/authz-contracts'

export interface ProjectQuery extends PaginationQuery {
  projectId?: string
  updatedSince?: number
  includeArchived?: boolean
  includeDeleted?: boolean
}

export type ProjectShareDirectoryEntry = {
  id: string
  name: string
  description?: string
  email?: string
  profilePictureUrl?: string
}

export type ProjectShareDirectoryResponse = {
  users: ProjectShareDirectoryEntry[]
  groups: ProjectShareDirectoryEntry[]
  roles: ProjectShareDirectoryEntry[]
}

export type ProjectGrantsResponse = {
  grants: ResourceGrant[]
}
