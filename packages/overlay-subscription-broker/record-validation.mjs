import path from 'node:path'
import { keyFor, knownProvider, validConnectionId, validOwnerId } from './state.mjs'

export const RECORD_FIELDS = new Set([
  'ownerId', 'connectionId', 'providerId', 'status', 'apiKey', 'managementKey',
  'enabledModelIds', 'discoveredModels', 'authFiles', 'oauthState', 'authExpiresAt',
  'codexDeviceCode', 'authorizationGeneration', 'codexPollLease', 'createdAt',
])

export function providerTypes(providerId) {
  return new Set(providerId === 'kimi-ai' ? ['kimi', 'kimi-ai'] : [providerId])
}

export function hasCredentialValue(providerId, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const fields = {
    codex: ['access_token', 'refresh_token', 'id_token'],
    xai: ['access_token', 'refresh_token', 'id_token'],
    meta: ['access_token', 'dca_token', 'api_key'],
    kimi: ['access_token', 'refresh_token'],
    'kimi-ai': ['access_token', 'refresh_token'],
    devin: ['session_token', 'raw_token'],
  }[providerId] ?? []
  return fields.some((key) => typeof value[key] === 'string' && value[key].trim().length > 0)
}

function validateAuthFile(providerId, name, contents) {
  if (Buffer.byteLength(name) > 255 || !/^[A-Za-z0-9@._+-]{1,251}\.json$/.test(name) ||
      name === '.json' || name !== path.basename(name) ||
      typeof contents !== 'string' || contents.length === 0 || contents.length > 2_000_000) {
    throw new Error('Invalid encrypted subscription credentials')
  }
  let parsed
  try { parsed = JSON.parse(contents) } catch { throw new Error('Invalid encrypted subscription credentials') }
  if (!parsed || typeof parsed !== 'object' || !providerTypes(providerId).has(parsed.type) ||
      !hasCredentialValue(providerId, parsed)) {
    throw new Error('Encrypted subscription credentials belong to another provider')
  }
  if (providerId === 'codex' &&
      typeof parsed.account_id !== 'string' &&
      typeof parsed.chatgpt_account_id !== 'string') {
    throw new Error('Codex credentials are missing the account identity')
  }
}

export function validateAuthFiles(providerId, authFiles, status) {
  if (!authFiles || typeof authFiles !== 'object' || Array.isArray(authFiles)) {
    throw new Error('Invalid encrypted subscription credentials')
  }
  const entries = Object.entries(authFiles)
  validateAuthFileCount(entries, status)
  for (const [name, contents] of entries) validateAuthFile(providerId, name, contents)
}

function validateAuthFileCount(entries, status) {
  if (status === 'pending' && entries.length !== 0) {
    throw new Error('Pending subscription state contains credentials')
  }
  if (status === 'connected' && entries.length !== 1) {
    throw new Error('Subscription state must contain exactly one account')
  }
  if (status === 'error' && entries.length > 1) {
    throw new Error('Subscription state contains multiple accounts')
  }
}

function validModel(model) {
  return model && typeof model === 'object' && !Array.isArray(model) &&
    typeof model.id === 'string' && /^[A-Za-z0-9._~:/@+-]{1,100}$/.test(model.id) &&
    (model.name === undefined || (typeof model.name === 'string' && model.name.length <= 200))
}

function validateModels(record) {
  return Array.isArray(record.enabledModelIds) && record.enabledModelIds.length <= 400 &&
    new Set(record.enabledModelIds).size === record.enabledModelIds.length &&
    Array.isArray(record.discoveredModels) && record.discoveredModels.length <= 400 &&
    record.discoveredModels.every(validModel) &&
    record.enabledModelIds.every((id) =>
      typeof id === 'string' && record.discoveredModels.some((model) => model.id === id))
}

function validateCodexState(record) {
  if (record.providerId !== 'codex') {
    return record.authorizationGeneration === undefined &&
      record.codexDeviceCode === undefined && record.codexPollLease === undefined
  }
  const device = record.codexDeviceCode
  const lease = record.codexPollLease
  return typeof record.authorizationGeneration === 'string' &&
    record.authorizationGeneration.length >= 32 &&
    device && typeof device === 'object' &&
    typeof device.deviceAuthId === 'string' &&
    typeof device.userCode === 'string' &&
    typeof device.expiresAt === 'number' &&
    typeof device.interval === 'number' &&
    (lease === undefined || lease === null ||
      (typeof lease.token === 'string' && typeof lease.expiresAt === 'number'))
}

function validateAuthorizationState(record) {
  return (record.oauthState === undefined ||
      (typeof record.oauthState === 'string' && record.oauthState.length <= 512)) &&
    (record.authExpiresAt === undefined ||
      (typeof record.authExpiresAt === 'number' && Number.isFinite(record.authExpiresAt)))
}

export function validateRecord(record, identity) {
  const valid = record && typeof record === 'object' &&
    Object.keys(record).every((key) => RECORD_FIELDS.has(key)) &&
    validOwnerId(record.ownerId) && validConnectionId(record.connectionId) &&
    keyFor(record.ownerId, record.connectionId) === identity &&
    knownProvider(record.providerId) &&
    ['pending', 'connected', 'error'].includes(record.status) &&
    typeof record.apiKey === 'string' && record.apiKey.length >= 32 &&
    typeof record.managementKey === 'string' && record.managementKey.length >= 32 &&
    validateModels(record) && validateAuthorizationState(record) && validateCodexState(record)
  if (!valid) throw new Error('Encrypted subscription state is invalid; refusing to start')
  validateAuthFiles(record.providerId, record.authFiles, record.status)
}
