export interface MutationSuccessResponse {
  success: boolean
  error?: string
}

export type PaginationSort = 'createdAt' | 'updatedAt' | 'name'
export type PaginationOrder = 'asc' | 'desc'

export interface PaginationQueryContract {
  cursor?: string
  limit?: number
  sort?: PaginationSort
  order?: PaginationOrder
}

export interface PaginatedEnvelope<T> {
  data: T[]
  nextCursor?: string
  hasMore: boolean
  total?: number
}
