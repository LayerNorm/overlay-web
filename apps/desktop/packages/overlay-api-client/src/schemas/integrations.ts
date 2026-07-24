import { z } from 'zod'
import { AuthFields, PaginationQuery, UnknownResponse } from './common'

export const IntegrationListQuery = PaginationQuery.extend({
  action: z.string().optional(),
  q: z.string().optional(),
})

export const IntegrationConnectRequest = z.object({
  ...AuthFields,
  providerKey: z.string().optional(),
  toolkit: z.string().optional(),
  slug: z.string().optional(),
  redirectUrl: z.string().url().optional(),
}).passthrough()

export const IntegrationResponse = UnknownResponse
