import {z} from 'zod'
import {DriveRequestError} from './drive-client.js'
import {ControlPlaneRequestError} from './transport.js'

const networkFailure = z.object({cause: z.object({code: z.enum([
  'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENETUNREACH', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET',
])})})

export function isRetryablePreparationFailure(error: unknown): boolean {
  if (error instanceof ControlPlaneRequestError && ['provider_account_missing', 'account_needs_reauth', 'account_unavailable'].includes(error.code ?? '')) return false
  if (error instanceof DriveRequestError || error instanceof ControlPlaneRequestError)
    return error.status === 429 || (error.status >= 500 && error.status <= 599)
  if (error instanceof DOMException) return error.name === 'AbortError' || error.name === 'TimeoutError'
  return error instanceof TypeError && networkFailure.safeParse(error).success
}
