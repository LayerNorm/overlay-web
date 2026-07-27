#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const PROVIDER_EXECUTION_ACK = 'I_UNDERSTAND_THIS_MAY_INCUR_PROVIDER_COSTS'
const MAX_RESPONSE_BYTES = 8_192
const PRODUCTION_HOSTS = new Set(['getoverlay.io', 'www.getoverlay.io'])

export async function runHostileClientMatrix(config, options = {}) {
  validateConfig(config)
  const env = options.env ?? process.env
  const fetchImpl = options.fetchImpl ?? fetch
  const executeProviders =
    options.executeProviders ??
    env.OVERLAY_HOSTILE_CLIENT_EXECUTE_PROVIDER === '1'

  if (
    executeProviders &&
    env.OVERLAY_HOSTILE_CLIENT_ACK !== PROVIDER_EXECUTION_ACK
  ) {
    throw new Error(
      `Set OVERLAY_HOSTILE_CLIENT_ACK=${PROVIDER_EXECUTION_ACK} before running cost-bearing provider cases.`,
    )
  }

  const runId = config.runId || `hostile-${new Date().toISOString()}`
  const report = {
    schemaVersion: 1,
    runId,
    startedAt: new Date().toISOString(),
    sourceCommit: config.sourceCommit || null,
    executeProviders,
    targets: [],
    passed: false,
  }

  for (const target of config.targets) {
    assertSafeTarget(target, env)
    const token = env[target.tokenEnv]?.trim()
    if (!token) throw new Error(`Missing token environment variable ${target.tokenEnv}`)

    const targetReport = {
      name: target.name,
      backend: target.backend,
      provider: target.provider,
      baseUrl: new URL(target.baseUrl).origin,
      route: target.request.path,
      cases: [],
      providerExecution: executeProviders ? 'requested' : 'skipped',
      externalEvidenceRequired: [
        'provider invocation count',
        'provider charge or usage entry',
        'Overlay reservation and reconciliation records',
        'security event correlation by runId',
      ],
      passed: false,
    }
    report.targets.push(targetReport)

    await recordCase(targetReport, 'discovery', async () => {
      const response = await fetchImpl(new URL('/api/v1/discovery', target.baseUrl), {
        headers: { 'x-overlay-security-run-id': runId },
      })
      expectStatus(response, target.expected?.discovery ?? [200])
      return summarizeResponse(response)
    })

    await recordCase(targetReport, 'missing-authentication', async () => {
      const response = await sendTargetRequest(fetchImpl, target, {
        env,
        runId,
      })
      expectStatus(response, target.expected?.unauthenticated ?? [401])
      return summarizeResponse(response)
    })

    await recordCase(targetReport, 'invalid-bearer-token', async () => {
      const response = await sendTargetRequest(fetchImpl, target, {
        env,
        runId,
        token: 'hostile-invalid-token',
      })
      expectStatus(response, target.expected?.invalidToken ?? [401])
      return summarizeResponse(response)
    })

    await recordCase(targetReport, 'identity-substitution', async () => {
      const response = await sendTargetRequest(fetchImpl, target, {
        claimedUserId: `forged-${runId}`,
        env,
        runId,
        token,
      })
      expectStatus(response, target.expected?.identitySubstitution ?? [401])
      return summarizeResponse(response)
    })

    await recordCase(targetReport, 'missing-idempotency-key', async () => {
      const response = await sendTargetRequest(fetchImpl, target, {
        env,
        runId,
        token,
      })
      expectStatus(response, target.expected?.missingIdempotency ?? [428])
      return summarizeResponse(response)
    })

    if (target.deniedMutation?.bodyPatch) {
      await recordCase(targetReport, 'server-policy-substitution', async () => {
        const response = await sendTargetRequest(fetchImpl, target, {
          bodyPatch: target.deniedMutation.bodyPatch,
          env,
          idempotencyKey: `${runId}-${target.name}-denied`,
          runId,
          token,
        })
        expectStatus(
          response,
          target.deniedMutation.expectedStatuses ?? [403],
        )
        return summarizeResponse(response)
      })
    }

    if (executeProviders) {
      await recordCase(targetReport, 'concurrency-disconnect-replay', async () => {
        const idempotencyKey = `${runId}-${target.name}-provider`
        const request = {
          env,
          idempotencyKey,
          runId,
          token,
        }
        const [first, second] = await Promise.all([
          sendTargetRequest(fetchImpl, target, request),
          sendTargetRequest(fetchImpl, target, request),
        ])
        const successStatuses = target.expected?.success ?? [200, 201, 202]
        const responses = [first, second]
        const successful = responses.filter((response) =>
          successStatuses.includes(response.status),
        )
        const blocked = responses.filter((response) => response.status === 409)
        if (successful.length !== 1 || blocked.length !== 1) {
          throw new Error(
            `Expected one provider request and one 409 concurrency rejection; received ${responses.map((response) => response.status).join(', ')}`,
          )
        }

        await successful[0].body?.cancel().catch(() => undefined)
        const retry = await sendTargetRequest(fetchImpl, target, request)
        if (target.idempotencyKind === 'json') {
          expectStatus(retry, successStatuses)
          if (retry.headers.get('idempotency-replayed') !== 'true') {
            throw new Error('Expected Idempotency-Replayed: true on JSON replay')
          }
        } else {
          expectStatus(retry, [409])
        }
        const conflictingReplay = await sendTargetRequest(fetchImpl, target, {
          ...request,
          bodyPatch: { hostileReplayNonce: `${runId}-different-body` },
        })
        expectStatus(conflictingReplay, [409])
        targetReport.providerExecution = 'completed'
        return {
          concurrentStatuses: responses.map((response) => response.status),
          retry: await summarizeResponse(retry),
          conflictingReplay: await summarizeResponse(conflictingReplay),
          disconnectedSuccessfulStream: true,
        }
      })
    }

    targetReport.passed = targetReport.cases.every((entry) => entry.passed)
  }

  report.completedAt = new Date().toISOString()
  report.passed = report.targets.every((target) => target.passed)
  return report
}

async function recordCase(targetReport, name, run) {
  const startedAt = Date.now()
  try {
    const evidence = await run()
    targetReport.cases.push({
      name,
      passed: true,
      durationMs: Date.now() - startedAt,
      evidence,
    })
  } catch (error) {
    targetReport.cases.push({
      name,
      passed: false,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function sendTargetRequest(fetchImpl, target, options) {
  const url = new URL(target.request.path, target.baseUrl)
  for (const [name, value] of Object.entries(target.request.query ?? {})) {
    url.searchParams.set(name, String(value))
  }
  const method = (target.request.method ?? 'POST').toUpperCase()
  if (method === 'GET') {
    for (const [name, value] of Object.entries(options.bodyPatch ?? {})) {
      url.searchParams.set(name, String(value))
    }
    if (options.claimedUserId) url.searchParams.set('userId', options.claimedUserId)
  }
  const headers = new Headers(target.request.headers ?? {})
  headers.set('x-overlay-security-run-id', options.runId)
  if (options.token) headers.set('authorization', `Bearer ${options.token}`)
  if (options.idempotencyKey) {
    headers.set('idempotency-key', options.idempotencyKey)
  }

  let body
  if (method === 'GET' || method === 'HEAD') {
    body = undefined
  } else if (target.request.bodyType === 'multipart') {
    const form = new FormData()
    for (const [name, value] of Object.entries(target.request.fields ?? {})) {
      form.set(name, String(value))
    }
    for (const [name, value] of Object.entries(options.bodyPatch ?? {})) {
      form.set(name, String(value))
    }
    if (options.claimedUserId) form.set('userId', options.claimedUserId)
    const file = target.request.file
    if (file) {
      const filePath = options.env[file.pathEnv]?.trim()
      if (!filePath) throw new Error(`Missing file path environment variable ${file.pathEnv}`)
      const bytes = fs.readFileSync(filePath)
      form.set(
        file.field,
        new Blob([bytes], { type: file.contentType || 'application/octet-stream' }),
        file.filename || path.basename(filePath),
      )
    }
    body = form
  } else {
    headers.set('content-type', 'application/json')
    body = JSON.stringify({
      ...(target.request.json ?? {}),
      ...(options.bodyPatch ?? {}),
      ...(options.claimedUserId ? { userId: options.claimedUserId } : {}),
    })
  }

  return fetchImpl(url, {
    method,
    headers,
    body,
  })
}

function expectStatus(response, expected) {
  if (!expected.includes(response.status)) {
    throw new Error(
      `Expected HTTP ${expected.join(' or ')}, received ${response.status}`,
    )
  }
}

async function summarizeResponse(response) {
  const summary = {
    status: response.status,
    cacheControl: response.headers.get('cache-control'),
    idempotencyStatus: response.headers.get('idempotency-status'),
    idempotencyReplayed: response.headers.get('idempotency-replayed'),
    retryAfter: response.headers.get('retry-after'),
    requestId: response.headers.get('x-request-id'),
  }
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('json')) return summary

  const text = (await response.clone().text()).slice(0, MAX_RESPONSE_BYTES)
  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === 'object') {
      summary.code = stringValue(parsed.code)
      summary.error = stringValue(parsed.error)
    }
  } catch {
    summary.unparseableJson = true
  }
  return summary
}

function stringValue(value) {
  return typeof value === 'string' ? value.slice(0, 256) : null
}

function validateConfig(config) {
  if (!config || config.schemaVersion !== 1 || !Array.isArray(config.targets)) {
    throw new Error('Hostile-client matrix config must use schemaVersion 1 and include targets[]')
  }
  if (config.targets.length === 0) throw new Error('At least one target is required')
  const names = new Set()
  for (const target of config.targets) {
    if (!target.name || names.has(target.name)) {
      throw new Error(`Target names must be present and unique: ${target.name || '<missing>'}`)
    }
    names.add(target.name)
    if (!target.backend || !target.provider || !target.baseUrl || !target.tokenEnv) {
      throw new Error(`Target ${target.name} is missing backend, provider, baseUrl, or tokenEnv`)
    }
    if (!target.request?.path?.startsWith('/api/v1/')) {
      throw new Error(`Target ${target.name} must use an /api/v1/ route`)
    }
  }
}

function assertSafeTarget(target, env) {
  const url = new URL(target.baseUrl)
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error(`Target ${target.name} must use HTTPS unless it is local`)
  }
  if (
    PRODUCTION_HOSTS.has(url.hostname) &&
    env.OVERLAY_HOSTILE_CLIENT_ALLOW_PRODUCTION !== '1'
  ) {
    throw new Error(
      `Refusing production target ${url.hostname}; use a dedicated test deployment. Set OVERLAY_HOSTILE_CLIENT_ALLOW_PRODUCTION=1 only for an explicitly approved production drill.`,
    )
  }
}

async function main() {
  const configPath = valueArg('--config')
  if (!configPath) throw new Error('Usage: desktop-hostile-client-matrix.mjs --config=<path> [--output=<private-path>]')
  const config = JSON.parse(fs.readFileSync(path.resolve(configPath), 'utf8'))
  const report = await runHostileClientMatrix(config)
  const outputPath = valueArg('--output')
  const rendered = `${JSON.stringify(report, null, 2)}\n`
  if (outputPath) {
    fs.writeFileSync(path.resolve(outputPath), rendered, { mode: 0o600 })
    console.log(`Hostile-client evidence written to ${path.resolve(outputPath)}`)
  } else {
    process.stdout.write(rendered)
  }
  if (!report.passed) process.exitCode = 1
}

function valueArg(prefix) {
  return process.argv.find((arg) => arg.startsWith(`${prefix}=`))?.slice(prefix.length + 1)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
