import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import { MonidApiError, type MonidClient, type MonidRun } from '@/server/integrations/monid/client'
import type { Entitlements } from '@/shared/app/app-contracts'
import { describePrice, executeInspectApi, executeRunApi, executeSearchApis, replaceArtifacts, type MonidToolDeps } from './monid'

const billing = { entitlements: { planKind: 'paid' } as unknown as Entitlements, programmaticSubjectId: undefined }
const context = { userId: 'user_1', workspaceId: 'ws_1', billing }

function completed(overrides: Partial<MonidRun> = {}): MonidRun {
  return {
    runId: 'run_1',
    provider: 'apollo',
    endpoint: '/people/search',
    status: 'COMPLETED',
    providerResponse: { httpStatus: 200 },
    billing: { reportedCost: { currency: 'USD', value: 120_000, unit: 'MICRO_DOLLAR' } },
    output: { people: [{ name: 'Ada' }] },
    resultCount: 1,
    ...overrides,
  }
}

type Harness = {
  deps: MonidToolDeps
  client: MonidClient
  calls: {
    run: Array<Parameters<MonidClient['run']>[0]>
    getRun: string[]
    stopRun: string[]
    charge: Array<Parameters<MonidToolDeps['charge']>[0]>
    budget: number
    saveBytes: Array<Parameters<MonidToolDeps['saveBytes']>[0]>
    saveText: Array<Parameters<MonidToolDeps['saveText']>[0]>
    download: string[]
    sleep: number[]
  }
}

function harness(options: {
  run?: (args: Parameters<MonidClient['run']>[0], attempt: number) => Promise<MonidRun>
  getRun?: (runId: string, attempt: number) => Promise<MonidRun>
  stopRun?: (runId: string) => Promise<MonidRun>
  sideEffects?: Set<string> | Error
  budget?: { ok: true; remainingCents: number } | { ok: false }
  billingEnabled?: boolean
  noKey?: boolean
  download?: (url: string) => Promise<{ bytes: Uint8Array; mimeType: string }>
  discover?: MonidClient['discover']
  inspect?: MonidClient['inspect']
  clock?: { now: number }
} = {}): Harness {
  const calls: Harness['calls'] = { run: [], getRun: [], stopRun: [], charge: [], budget: 0, saveBytes: [], saveText: [], download: [], sleep: [] }
  const clock = options.clock ?? { now: 0 }
  let runAttempt = 0
  let getAttempt = 0
  const client = {
    discover: options.discover ?? (async () => ({ items: [], total: 0 })),
    inspect: options.inspect ?? (async () => { throw new Error('no inspect') }),
    run: async (args: Parameters<MonidClient['run']>[0]) => {
      calls.run.push(args)
      return await (options.run ?? (async () => completed()))(args, runAttempt++)
    },
    getRun: async (runId: string) => {
      calls.getRun.push(runId)
      return await (options.getRun ?? (async () => completed()))(runId, getAttempt++)
    },
    stopRun: async (runId: string) => {
      calls.stopRun.push(runId)
      return await (options.stopRun ?? (async () => completed({ status: 'STOPPING' })))(runId)
    },
    listSideEffectEndpoints: async () => new Set<string>(),
  } as unknown as MonidClient
  const deps: MonidToolDeps = {
    client: async () => (options.noKey ? null : client),
    sideEffectEndpoints: async () => {
      if (options.sideEffects instanceof Error) throw options.sideEffects
      return options.sideEffects ?? new Set(['agentmail/inboxes'])
    },
    billingEnabled: async () => options.billingEnabled ?? true,
    markupBasisPoints: () => 2_500,
    ensureBudgetNotLow: async () => {
      calls.budget++
      return options.budget ?? { ok: true, remainingCents: 1_000 }
    },
    charge: async (args) => {
      calls.charge.push(args)
      return { budgetLow: false }
    },
    billableCents: (usd) => Math.ceil(usd * 100 * 1.25),
    download: async (url) => {
      calls.download.push(url)
      return await (options.download ?? (async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'model/gltf-binary' })))(url)
    },
    saveBytes: async (args) => {
      calls.saveBytes.push(args)
      return `file_${calls.saveBytes.length}`
    },
    saveText: async (args) => {
      calls.saveText.push(args)
      return 'file_json'
    },
    sleep: async (ms) => {
      calls.sleep.push(ms)
      clock.now += ms
    },
    now: () => clock.now,
  }
  return { deps, client, calls }
}

const runInput = { provider: 'apollo', endpoint: '/people/search', input: { body: { q: 'cto' } } }

// ── run_api: billing ─────────────────────────────────────────────────────────

test('a finished run is charged Monid\'s reported cost once, keyed by its run id', async () => {
  const h = harness()
  const result = await executeRunApi(context, runInput, { toolCallId: 'call_1' }, h.deps)
  assert.equal(result.success, true)
  assert.equal(h.calls.charge.length, 1)
  assert.deepEqual(h.calls.charge[0], {
    billing,
    userId: 'user_1',
    workspaceId: 'ws_1',
    operationId: 'monid.run:run_1',
    providerCostUsd: 0.12,
    modelId: 'monid/apollo/people/search',
  })
  assert.equal((result as { chargedUsd: number }).chargedUsd, 0.15)
  assert.equal(h.calls.run[0]!.idempotencyKey, 'overlay-call_1')
  assert.equal(h.calls.run[0]!.tag, 'ws_1')
  assert.deepEqual(h.calls.run[0]!.input, { body: { q: 'cto' } })
})

test('maxCost is the remaining budget with the markup taken out', async () => {
  const h = harness({ budget: { ok: true, remainingCents: 1_000 } })
  await executeRunApi(context, runInput, { toolCallId: 'c' }, h.deps)
  assert.equal(h.calls.run[0]!.maxCost, 8)

  const odd = harness({ budget: { ok: true, remainingCents: 333 } })
  await executeRunApi(context, runInput, { toolCallId: 'c' }, odd.deps)
  assert.equal(odd.calls.run[0]!.maxCost, 2.664)
})

test('without billing (self-hosted) no maxCost is sent', async () => {
  const h = harness({ billingEnabled: false })
  await executeRunApi(context, runInput, { toolCallId: 'c' }, h.deps)
  assert.equal(h.calls.run[0]!.maxCost, undefined)
})

test('a workspace with no budget left is refused before Monid is called', async () => {
  const low = harness({ budget: { ok: false } })
  const refused = await executeRunApi(context, runInput, { toolCallId: 'c' }, low.deps)
  assert.equal(refused.success, false)
  assert.equal((refused as { error: string }).error, 'insufficient_budget')
  assert.equal(low.calls.run.length, 0)

  const empty = harness({ budget: { ok: true, remainingCents: 0 } })
  const zero = await executeRunApi(context, runInput, { toolCallId: 'c' }, empty.deps)
  assert.equal((zero as { error: string }).error, 'insufficient_budget')
  assert.equal(empty.calls.run.length, 0)
})

test('a run estimated above maxCost is refused and charges nothing', async () => {
  const h = harness({ run: async () => { throw new MonidApiError(400, 'MAX_COST_EXCEEDED', 'too much') } })
  const result = await executeRunApi(context, runInput, { toolCallId: 'c' }, h.deps)
  assert.equal((result as { error: string }).error, 'insufficient_budget')
  assert.match((result as { message: string }).message, /\$8\.00/)
  assert.equal(h.calls.charge.length, 0)
})

test('a run without a billing context never starts', async () => {
  const h = harness()
  const result = await executeRunApi({ userId: 'u' }, runInput, {}, h.deps)
  assert.equal((result as { error: string }).error, 'billing_unavailable')
  assert.equal(h.calls.run.length, 0)
  assert.equal(h.calls.budget, 0)
})

test('without a Monid key every tool reports the service unavailable', async () => {
  const h = harness({ noKey: true })
  assert.equal((await executeRunApi(context, runInput, {}, h.deps) as { error: string }).error, 'service_unavailable')
  assert.equal((await executeSearchApis(context, { query: 'x' }, h.deps) as { error: string }).error, 'service_unavailable')
  assert.equal((await executeInspectApi(context, { provider: 'a', endpoint: '/b' }, h.deps) as { error: string }).error, 'service_unavailable')
})

test('a zero-cost or missing reported cost charges nothing', async () => {
  const free = harness({ run: async () => completed({ billing: { reportedCost: { currency: 'USD', value: 0, unit: 'CENT' } } }) })
  const result = await executeRunApi(context, runInput, {}, free.deps)
  assert.equal(result.success, true)
  assert.equal(free.calls.charge.length, 0)
  assert.equal((result as { chargedUsd: number }).chargedUsd, 0)

  const missing = harness({ run: async () => completed({ billing: undefined }) })
  await executeRunApi(context, runInput, {}, missing.deps)
  assert.equal(missing.calls.charge.length, 0)
})

// ── run_api: read-only enforcement ───────────────────────────────────────────

test('endpoints with side effects are never run', async () => {
  const h = harness()
  const result = await executeRunApi(context, { provider: 'agentmail', endpoint: '/inboxes' }, {}, h.deps)
  assert.equal((result as { error: string }).error, 'not_read_only')
  assert.equal(h.calls.run.length, 0)
  assert.equal(h.calls.budget, 0)
  // A path without its leading slash is the same endpoint.
  const bare = await executeRunApi(context, { provider: 'agentmail', endpoint: 'inboxes' }, {}, h.deps)
  assert.equal((bare as { error: string }).error, 'not_read_only')
})

test('when the side-effect catalog cannot be read, nothing runs', async () => {
  const h = harness({ sideEffects: new Error('catalog down') })
  const result = await executeRunApi(context, runInput, {}, h.deps)
  assert.equal((result as { error: string }).error, 'service_unavailable')
  assert.equal(h.calls.run.length, 0)
})

// ── run_api: async runs ──────────────────────────────────────────────────────

test('an accepted run is polled with backoff until it finishes, then charged once', async () => {
  const h = harness({
    run: async () => completed({ status: 'READY', billing: undefined, output: undefined }),
    getRun: async (_id, attempt) => (attempt < 3 ? completed({ status: 'RUNNING', billing: undefined, output: undefined }) : completed()),
  })
  const result = await executeRunApi(context, runInput, { toolCallId: 'c' }, h.deps)
  assert.equal(result.success, true)
  assert.equal(h.calls.getRun.length, 4)
  assert.deepEqual(h.calls.sleep, [2000, 3000, 4500, 6750])
  assert.equal(h.calls.charge.length, 1)
})

test('a run still going after the wait is stopped and not charged', async () => {
  const h = harness({
    run: async () => completed({ status: 'RUNNING', billing: undefined }),
    getRun: async () => completed({ status: 'RUNNING', billing: undefined }),
    stopRun: async () => completed({ status: 'STOPPING', billing: undefined }),
  })
  const result = await executeRunApi(context, runInput, {}, h.deps)
  assert.equal((result as { error: string }).error, 'timed_out')
  assert.equal(h.calls.stopRun.length, 1)
  assert.equal(h.calls.charge.length, 0)
  assert.ok(h.calls.sleep.reduce((a, b) => a + b, 0) >= 10 * 60_000)
})

test('a run that finishes while it is being stopped is still charged', async () => {
  let stopped = false
  const h = harness({
    run: async () => completed({ status: 'RUNNING', billing: undefined }),
    getRun: async () => (stopped ? completed() : completed({ status: 'RUNNING', billing: undefined })),
    stopRun: async () => { stopped = true; return completed() },
  })
  const result = await executeRunApi(context, runInput, {}, h.deps)
  assert.equal(result.success, true)
  assert.equal(h.calls.charge.length, 1)
})

test('cancelling the tool call stops the run', async () => {
  const controller = new AbortController()
  const h = harness({
    run: async () => completed({ status: 'RUNNING', billing: undefined }),
    getRun: async () => completed({ status: 'RUNNING', billing: undefined }),
  })
  const original = h.deps.sleep
  h.deps.sleep = async (ms, signal) => {
    await original(ms, signal)
    controller.abort()
  }
  const result = await executeRunApi(context, runInput, { abortSignal: controller.signal }, h.deps)
  assert.equal(h.calls.stopRun.length, 1)
  assert.equal(result.success, false)
  assert.equal(h.calls.charge.length, 0)
})

test('a key still being started is asked again with the same key', async () => {
  const h = harness({
    run: async (_args, attempt) => {
      if (attempt === 0) throw new MonidApiError(409, 'IDEMPOTENCY_KEY_IN_USE', 'in use')
      return completed()
    },
  })
  const result = await executeRunApi(context, runInput, { toolCallId: 'same' }, h.deps)
  assert.equal(result.success, true)
  assert.equal(h.calls.run.length, 2)
  assert.equal(h.calls.run[0]!.idempotencyKey, h.calls.run[1]!.idempotencyKey)
  assert.equal(h.calls.charge.length, 1)
})

// ── run_api: failures ────────────────────────────────────────────────────────

test('Monid account problems are reported as unavailable, not as the user\'s fault', async () => {
  for (const status of [401, 402, 403]) {
    const h = harness({ run: async () => { throw new MonidApiError(status, 'X', 'account') } })
    const result = await executeRunApi(context, runInput, {}, h.deps)
    assert.equal((result as { error: string }).error, 'service_unavailable', String(status))
    assert.equal(h.calls.charge.length, 0)
  }
})

test('bad input, unknown endpoints and rate limits come back as fixable errors', async () => {
  const cases: Array<[number, string, string]> = [[400, 'VALIDATION', 'invalid_input'], [404, 'NOT_FOUND', 'not_found'], [429, 'RATE', 'rate_limited'], [500, 'X', 'service_error']]
  for (const [status, code, expected] of cases) {
    const h = harness({ run: async () => { throw new MonidApiError(status, code, 'nope') } })
    assert.equal((await executeRunApi(context, runInput, {}, h.deps) as { error: string }).error, expected)
  }
})

test('a timed-out run (408) settles with whatever Monid reports', async () => {
  const h = harness({ run: async () => { throw new MonidApiError(408, 'HTTP_408', 'timeout', completed({ status: 'TIMED_OUT', billing: undefined })) } })
  const result = await executeRunApi(context, runInput, {}, h.deps)
  assert.equal((result as { error: string }).error, 'timed_out')
  assert.equal(h.calls.charge.length, 0)
})

test('failed, blocked and stopped runs are reported with any reported cost charged', async () => {
  for (const status of ['FAILED', 'BLOCKED', 'STOPPED'] as const) {
    const h = harness({ run: async () => completed({ status, reason: 'cap', billing: { reportedCost: { currency: 'USD', value: 0, unit: 'CENT' } } }) })
    const result = await executeRunApi(context, runInput, {}, h.deps)
    assert.equal(result.success, false)
    assert.equal((result as { error: string }).error, status.toLowerCase())
    assert.equal(h.calls.charge.length, 0)
  }
})

test('a provider error inside a completed run is shown and its reported cost charged', async () => {
  const h = harness({
    run: async () => completed({
      providerResponse: { httpStatus: 422, error: { message: 'q is required' } },
      billing: { reportedCost: { currency: 'USD', value: 1, unit: 'CENT' } },
    }),
  })
  const result = await executeRunApi(context, runInput, {}, h.deps) as { success: boolean; error: string; providerError: unknown }
  assert.equal(result.success, false)
  assert.equal(result.error, 'provider_error')
  assert.deepEqual(result.providerError, { message: 'q is required' })
  assert.equal(h.calls.charge.length, 1)
})

// ── run_api: files and large output ──────────────────────────────────────────

test('files in the output are saved to Files and replaced with Overlay links', async () => {
  const link = 'https://files.monid.ai/runs/run_1/model.glb?sig=abc'
  const h = harness({
    run: async () => completed({
      provider: 'meshy',
      endpoint: '/text-to-3d/preview',
      output: { model: { download_link: link, content_type: 'model/gltf-binary', link_expires_at: '2026-12-01T00:00:00Z' }, thumbnails: [{ download_link: 'https://files.monid.ai/x', content_type: 'image/png' }] },
    }),
  })
  const result = await executeRunApi({ ...context, agentId: 'agent_1' }, { provider: 'meshy', endpoint: '/text-to-3d/preview' }, {}, h.deps) as {
    success: boolean; output: { model: { file: { fileId: string; url: string; name: string } }; thumbnails: Array<{ file: { name: string } }> }; files: unknown[]
  }
  assert.equal(result.success, true)
  assert.deepEqual(h.calls.download, [link, 'https://files.monid.ai/x'])
  assert.equal(result.output.model.file.fileId, 'file_1')
  assert.equal(result.output.model.file.url, '/api/v1/files/file_1/content')
  assert.equal(result.output.model.file.name, 'model.glb')
  assert.equal(result.output.thumbnails[0]!.file.name, 'meshy-text-to-3d-preview-2.png')
  assert.equal(result.files.length, 2)
  assert.equal(h.calls.saveBytes[0]!.scope, 'personal')
  assert.equal(h.calls.saveBytes[0]!.byAgent, true)
  assert.equal(h.calls.saveBytes[0]!.mimeType, 'model/gltf-binary')
  assert.ok(!JSON.stringify(result).includes('sig=abc'), 'the signed Monid link is not handed back')
})

test('in a room others can read, files are saved to the workspace', async () => {
  const h = harness({ run: async () => completed({ output: { download_link: 'https://f/x.pdf', content_type: 'application/pdf' } }) })
  await executeRunApi({ ...context, sharedRoom: true }, runInput, {}, h.deps)
  assert.equal(h.calls.saveBytes[0]!.scope, 'workspace')
  assert.equal(h.calls.saveBytes[0]!.byAgent, false)
})

test('a file that cannot be downloaded is reported, and the run still succeeds and is charged', async () => {
  const h = harness({
    run: async () => completed({ output: { download_link: 'http://169.254.169.254/latest', content_type: 'text/plain' } }),
    download: async () => { throw new Error('URL is not allowed') },
  })
  const result = await executeRunApi(context, runInput, {}, h.deps) as { success: boolean; fileErrors: string[]; output: { savedToFiles: boolean } }
  assert.equal(result.success, true)
  assert.deepEqual(result.fileErrors, ['URL is not allowed'])
  assert.equal(result.output.savedToFiles, false)
  assert.equal(h.calls.saveBytes.length, 0)
  assert.equal(h.calls.charge.length, 1)
})

test('at most ten files are saved from one run', async () => {
  const output = Array.from({ length: 14 }, (_, i) => ({ download_link: `https://f/${i}.png`, content_type: 'image/png' }))
  const h = harness({ run: async () => completed({ output }) })
  await executeRunApi(context, runInput, {}, h.deps)
  assert.equal(h.calls.saveBytes.length, 10)
})

test('a large output is saved whole to Files and previewed', async () => {
  const people = Array.from({ length: 2_000 }, (_, i) => ({ name: `Person ${i}`, title: 'VP of Sales', company: `Company ${i}` }))
  const h = harness({ run: async () => completed({ output: { total: 2_000, people } }) })
  const result = await executeRunApi(context, runInput, {}, h.deps) as {
    success: boolean; outputTruncated: boolean; fullOutputFile: { fileId: string; name: string }
    output: { total: number; people: { firstItems: unknown[]; totalItems: number } }
  }
  assert.equal(result.success, true)
  assert.equal(result.outputTruncated, true)
  assert.equal(result.fullOutputFile.fileId, 'file_json')
  assert.equal(result.fullOutputFile.name, 'apollo-people-search-run_1.json')
  assert.equal(result.output.total, 2_000)
  assert.equal(result.output.people.totalItems, 2_000)
  assert.ok(result.output.people.firstItems.length > 10)
  assert.ok(JSON.stringify(result).length < 60_000)
  assert.equal(JSON.parse(h.calls.saveText[0]!.text).people.length, 2_000)
  assert.equal(h.calls.saveText[0]!.mimeType, 'application/json')
})

test('a large top-level array is previewed by items', async () => {
  const rows = Array.from({ length: 3_000 }, (_, i) => ({ id: i, text: 'x'.repeat(30) }))
  const h = harness({ run: async () => completed({ output: rows }) })
  const result = await executeRunApi(context, runInput, {}, h.deps) as { output: { firstItems: unknown[]; totalItems: number } }
  assert.equal(result.output.totalItems, 3_000)
  assert.ok(result.output.firstItems.length > 0 && result.output.firstItems.length < 3_000)
})

test('artifacts nested deeply are still found, and plain data is untouched', async () => {
  const seen: string[] = []
  const output = await replaceArtifacts(
    { a: [{ b: { download_link: 'https://x/1', link_expires_at: 't' } }], note: 'download_link', n: 3, nothing: null },
    async (artifact) => { seen.push(artifact.download_link); return { fileId: 'f', url: 'u', name: 'n', mimeType: 'm', sizeBytes: 1 } },
  )
  assert.deepEqual(seen, ['https://x/1'])
  assert.deepEqual(output, { a: [{ b: { file: { fileId: 'f', url: 'u', name: 'n', mimeType: 'm', sizeBytes: 1 } } }], note: 'download_link', n: 3, nothing: null })
  // A bare object with a download_link but no file metadata is not treated as a file.
  const notFile = await replaceArtifacts({ download_link: 'https://x' }, async () => { throw new Error('should not save') })
  assert.deepEqual(notFile, { download_link: 'https://x' })
})

// ── search_apis and inspect_api ──────────────────────────────────────────────

test('search_apis returns compact ranked cards with readable prices', async () => {
  const h = harness({
    discover: async (args) => {
      assert.equal(args.query, '3d model of a chair')
      return {
        total: 2,
        items: [
          { provider: 'meshy', providerDisplayName: 'Meshy', endpoint: '/text-to-3d/preview', displayName: 'Text to 3D', displayDescription: 'Make a model', price: { type: 'PER_CALL', amount: { value: 0.2, currency: 'USD' } }, tags: [], categories: ['3d-generation'], metrics: { status: 'healthy', runTimeMs: { p50: 61_000 } } },
          { provider: 'x', endpoint: '/y', price: { type: 'PER_RESULT', amount: { value: 0.002, currency: 'USD' } }, tags: ['free'] },
        ],
      }
    },
  })
  const result = await executeSearchApis(context, { query: '3d model of a chair' }, h.deps) as { success: boolean; results: Array<Record<string, unknown>> }
  assert.equal(result.success, true)
  assert.deepEqual(result.results[0], {
    provider: 'meshy', endpoint: '/text-to-3d/preview', name: 'Text to 3D', providerName: 'Meshy', description: 'Make a model',
    price: '$0.20 per call', health: 'healthy', typicalSeconds: 61,
  })
  assert.equal(result.results[1]!.price, '$0.002 per result')
  assert.deepEqual(result.results[1]!.tags, ['free'])
})

test('search_apis reports Monid failures without throwing', async () => {
  const h = harness({ discover: async () => { throw new MonidApiError(429, 'RATE', 'slow') } })
  assert.equal((await executeSearchApis(context, { query: 'x' }, h.deps) as { error: string }).error, 'rate_limited')
})

test('inspect_api says whether an endpoint can run', async () => {
  const detail = { provider: 'agentmail', endpoint: '/inboxes', description: 'Create inbox', input: { body: { type: 'object' } }, price: { type: 'PER_CALL', amount: { value: 0.01, currency: 'USD' } } }
  const blocked = harness({ inspect: async () => detail })
  const no = await executeInspectApi(context, { provider: 'agentmail', endpoint: '/inboxes' }, blocked.deps) as { canRun: boolean; whyNot: string; input: unknown }
  assert.equal(no.canRun, false)
  assert.match(no.whyNot, /does not run/)
  assert.deepEqual(no.input, { body: { type: 'object' } })

  const ok = harness({ inspect: async () => ({ ...detail, provider: 'apollo', endpoint: '/people/search' }) })
  const yes = await executeInspectApi(context, { provider: 'apollo', endpoint: '/people/search' }, ok.deps) as { canRun: boolean; whyNot?: string }
  assert.equal(yes.canRun, true)
  assert.equal(yes.whyNot, undefined)

  const unknown = harness({ inspect: async () => detail, sideEffects: new Error('down') })
  const maybe = await executeInspectApi(context, { provider: 'apollo', endpoint: '/people/search' }, unknown.deps) as { canRun: boolean; whyNot: string }
  assert.equal(maybe.canRun, false)
  assert.match(maybe.whyNot, /could not confirm/)
})

test('inspect_api truncates a huge schema', async () => {
  const huge = { type: 'object', properties: Object.fromEntries(Array.from({ length: 3_000 }, (_, i) => [`field_${i}`, { type: 'string', description: 'a field' }])) }
  const h = harness({ inspect: async () => ({ provider: 'apollo', endpoint: '/x', input: { body: huge } }) })
  const result = await executeInspectApi(context, { provider: 'apollo', endpoint: '/x' }, h.deps) as { input: { truncated: boolean; schema: string } }
  assert.equal(result.input.truncated, true)
  assert.equal(result.input.schema.length, 30_000)
})

test('describePrice reads every price shape', () => {
  assert.equal(describePrice(undefined), undefined)
  assert.equal(describePrice({ type: 'PER_CALL', amount: { value: 0, currency: 'USD' } }), 'free')
  assert.equal(describePrice({ type: 'PER_CALL', amount: { value: 1.5, currency: 'USD' } }), '$1.50 per call')
  assert.equal(describePrice({ type: 'PER_CALL', amount: { value: 0.03, currency: 'USD' } }), '$0.03 per call')
  assert.equal(describePrice({ type: 'PER_UNIT', unit: 'second', amount: { value: 0.0004, currency: 'USD' } }), '$0.0004 per second')
  assert.equal(
    describePrice({ type: 'PER_UNIT_MATRIX', amount: { value: 0.3, currency: 'USD' }, selectors: [{ key: 'texture_resolution' }] }),
    'from $0.30 (varies by texture_resolution)',
  )
  assert.equal(describePrice({ type: 'TIERED' }), 'TIERED')
})
