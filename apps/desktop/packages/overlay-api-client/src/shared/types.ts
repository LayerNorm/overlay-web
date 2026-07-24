export type QueryValue = string | number | boolean | null | undefined
export type QueryParams = Record<string, QueryValue>
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface CreateOverlayAppClientOptions {
  baseUrl?: string
  fetch?: FetchLike
  getAuthHeaders?: () => HeadersInit | Promise<HeadersInit>
}

export interface ErrorResponse {
  error?: string
  message?: string
}

export interface Pagination {
  limit?: number
  hasMore?: boolean
  earliestCreatedAt?: number
}

export type PaginationSort = 'createdAt' | 'updatedAt' | 'name'
export type PaginationOrder = 'asc' | 'desc'

export interface PaginationQuery {
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
