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

export function isPaginatedEnvelope<T = unknown>(value: unknown): value is PaginatedEnvelope<T> {
  return Boolean(
    value &&
      typeof value === 'object' &&
      Array.isArray((value as { data?: unknown }).data) &&
      typeof (value as { hasMore?: unknown }).hasMore === 'boolean',
  )
}

export function unwrapPaginatedData<T>(value: unknown, fallback: T[] = []): T[] {
  if (Array.isArray(value)) return value as T[]
  if (isPaginatedEnvelope<T>(value)) return value.data
  return fallback
}
