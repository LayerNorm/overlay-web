import type { PaginationQuery } from '../shared/types'

export interface ProjectQuery extends PaginationQuery {
  projectId?: string
  updatedSince?: number
  includeDeleted?: boolean
}
