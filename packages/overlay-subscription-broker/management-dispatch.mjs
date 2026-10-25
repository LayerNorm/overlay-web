import { assertEnabledProvider, knownProvider, subscriptionError, validConnectionId, validOwnerId } from './state.mjs'
import {
  callbackAuthorization,
  pollAuthorization,
  refreshAuthorization,
  startAuthorization,
  setModels,
} from './authorization.mjs'
import {
  getCodexDeviceCode,
  importCodex,
  releaseCodexPoll,
  startCodexAuthorization,
} from './codex-authorization.mjs'
import { disconnect } from './worker-lifecycle.mjs'

export async function handleManagement(pathname, body) {
  validateManagementRequest(pathname, body)
  return await dispatchManagementAction(pathname, body)
}

function validateManagementRequest(pathname, body) {
  if (!validOwnerId(body.ownerId) || !validConnectionId(body.connectionId)) {
    throw subscriptionError(400, 'Invalid owner or connection')
  }
  if (pathname.endsWith('/start') || pathname.endsWith('/start-codex')) return
  if (!knownProvider(body.providerId)) throw subscriptionError(400, 'Unsupported subscription provider')
  validateProviderRoute(pathname, body.providerId)
}

function validateProviderRoute(pathname, providerId) {
  if (pathname.endsWith('/poll') || pathname.endsWith('/refresh') ||
      pathname.endsWith('/callback') || pathname.endsWith('/import-codex')) {
    assertEnabledProvider(providerId)
  }
  if (pathname.endsWith('/codex-device') || pathname.endsWith('/codex-release') ||
      pathname.endsWith('/import-codex')) {
    if (providerId !== 'codex') throw subscriptionError(400, 'Codex provider is required')
  }
  if (pathname.endsWith('/poll') && providerId === 'codex') {
    throw subscriptionError(400, 'Codex authorization must use the device-code poll route')
  }
  if (pathname.endsWith('/callback') && providerId !== 'devin') {
    throw subscriptionError(400, 'Devin provider is required')
  }
}

async function dispatchManagementAction(pathname, body) {
  const routes = [
    ['/start', startAuthorization],
    ['/start-codex', startCodexAuthorization],
    ['/codex-device', getCodexDeviceCode],
    ['/codex-release', releaseCodexPoll],
    ['/poll', pollAuthorization],
    ['/refresh', refreshAuthorization],
    ['/callback', callbackAuthorization],
    ['/import-codex', importCodex],
    ['/models', setModels],
    ['/disconnect', disconnect],
  ]
  const match = routes.find(([suffix]) => pathname.endsWith(suffix))
  if (!match) throw subscriptionError(404, 'Route not found')
  return await match[1](body)
}
