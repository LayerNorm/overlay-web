import { z } from 'zod'

export const AuthFields = {
  accessToken: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
} as const

export const EmptyQuery = z.object({}).passthrough()
export const EmptyRequest = z.object({ ...AuthFields }).passthrough()
export const UnknownResponse = z.unknown()

export const BooleanQueryValue = z.enum(['true', 'false', '1', '0']).optional()
export const IntegerQueryValue = z
  .string()
  .regex(/^\d+$/)
  .optional()

export const IdQuery = z.string().min(1).optional()

export const PaginationQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['createdAt', 'updatedAt', 'name']).default('updatedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
})

export type PaginationQuery = z.infer<typeof PaginationQuery>

export const JsonRecord = z.record(z.string(), z.unknown())

export const FormDataBoundary = z.instanceof(FormData)
