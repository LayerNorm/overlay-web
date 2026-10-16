import type {EmitAgentEvent} from './adapter.js'
import type {StructuredLogger} from './logger.js'
import {ControlPlaneRequestError, type AgentControlPlaneClient} from './transport.js'

/** Undefined means no account; unavailable means the failure was reported and startup must stop. */
export async function fetchProviderRunCredentials(options: {
  runId: string
  requested: boolean
  client: AgentControlPlaneClient
  emit: EmitAgentEvent
  logger: StructuredLogger
}): Promise<Record<string, string> | undefined | 'unavailable'> {
  if (!options.requested || !options.client.fetchRunCredentials) return undefined
  try {return await options.client.fetchRunCredentials(options.runId)}
  catch (error) {
    const code = error instanceof ControlPlaneRequestError ? error.code : undefined
    if (code === 'provider_account_missing') return undefined
    const needsSignIn = code === 'account_needs_reauth' || code === 'account_unavailable'
    await options.emit({type: 'failed', payload: {
      code: needsSignIn ? 'auth_required' : 'credentials_unavailable',
      message: needsSignIn ? 'This agent’s account needs to be reconnected in Settings → Agent accounts.'
        : 'The agent could not get its credentials. Try again.',
      retryable: !needsSignIn,
    }})
    options.logger.warn('run credentials unavailable', {runId: options.runId, code: code ?? 'unknown'})
    return 'unavailable'
  }
}
