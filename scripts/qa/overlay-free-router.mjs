import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

const GATEWAY = 'https://ai-gateway.vercel.sh/v1'
const OPENROUTER = 'https://openrouter.ai/api/v1'
const HOUR = 60 * 60 * 1000
const PREFERENCE = ['minimax/minimax-m3.1-flash', 'reflection/beam-free', 'nvidia/nemotron-3.5-lightning-free']

function price(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !value.trim()) return null
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

export function isFreePricing(pricing, required = ['prompt', 'completion']) {
  if (!pricing || !required.every(key => price(pricing[key]) === 0)) return false
  return Object.entries(pricing).every(([key, value]) =>
    key === 'discount' || (key === 'varies_by_provider' && typeof value === 'boolean') || price(value) === 0)
}

export function reportedCost(completion) {
  const usage = completion.usage ?? {}
  const gateway = completion.choices?.[0]?.message?.provider_metadata?.gateway ?? {}
  const fields = [usage.cost, usage.gateway_cost, usage.market_cost, usage.surcharge_cost,
    usage.reporting_tag_write_cost, gateway.cost, gateway.gatewayCost, gateway.marketCost,
    gateway.surchargeCost, gateway.reportingTagWriteCost]
  const present = fields.filter(value => value !== undefined)
  if (present.length === 0 || present.some(value => price(value) === null)) return null
  // The total and its components overlap; use the largest reported charge, not their sum.
  return Math.max(...present.map(price))
}

export class OverlayFreeRouter {
  constructor({ gatewayKey, openRouterKey, statePath, fetchImpl = fetch, now = Date.now }) {
    this.gatewayKey = gatewayKey
    this.openRouterKey = openRouterKey
    this.statePath = statePath
    this.fetch = fetchImpl
    this.now = now
    this.pool = []
    this.quarantine = {}
    this.lastRefresh = 0
    this.lastError = null
    this.tail = Promise.resolve()
  }

  async init() {
    if (!this.statePath) return
    try {
      const saved = JSON.parse(await readFile(this.statePath, 'utf8'))
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Invalid safety state')
      this.quarantine = saved
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Cannot read quarantine state; refusing to start')
    }
  }

  exclusive(work) {
    const result = this.tail.then(work)
    this.tail = result.catch(() => {})
    return result
  }

  async block(candidate, reason, cost) {
    this.quarantine[candidate.key] = { model: candidate.id, provider: candidate.provider, reason, cost, at: this.now() }
    candidate.status = 'quarantined'
    candidate.reason = reason
    if (this.statePath) {
      await mkdir(dirname(this.statePath), { recursive: true })
      await writeFile(`${this.statePath}.tmp`, JSON.stringify(this.quarantine, null, 2), { mode: 0o600 })
      await rename(`${this.statePath}.tmp`, this.statePath)
    }
  }

  async json(url, options = {}, timeout = 12000) {
    const response = await this.fetch(url, { ...options, signal: AbortSignal.timeout(timeout) })
    if (!response.ok) {
      await response.body?.cancel()
      const error = new Error(`Provider HTTP ${response.status}`)
      error.status = response.status
      throw error
    }
    return response.json()
  }

  async endpoints(id) {
    const result = await this.json(`${GATEWAY}/models/${id.split('/').map(encodeURIComponent).join('/')}/endpoints`)
    return result.data?.endpoints ?? []
  }

  async refresh() {
    return this.exclusive(async () => {
      try {
        const catalog = await this.json(`${GATEWAY}/models`)
        if (!Array.isArray(catalog.data)) throw new Error('Invalid model catalog')
        const models = catalog.data.filter(model => model.type === 'language' && isFreePricing(model.pricing, ['input', 'output']))
        const pool = []
        for (const model of models) {
          try {
            for (const endpoint of await this.endpoints(model.id)) {
              if (!isFreePricing(endpoint.pricing) || typeof endpoint.provider_name !== 'string') continue
              const provider = endpoint.provider_name
              const key = `${model.id}@${provider}`
              pool.push({ key, id: model.id, name: model.name, provider,
                context: endpoint.context_length, status: this.quarantine[key] ? 'quarantined' : 'unchecked',
                reason: this.quarantine[key]?.reason, verifiedAt: null, cost: null })
            }
          } catch { /* An unverifiable endpoint is excluded, never taken from stale cache. */ }
        }
        const priority = id => PREFERENCE.includes(id) ? PREFERENCE.indexOf(id) : PREFERENCE.length
        pool.sort((a, b) => priority(a.id) - priority(b.id) || a.id.localeCompare(b.id))
        this.pool = pool
        this.lastRefresh = this.now()
        this.lastError = null
        if (this.gatewayKey) {
          for (const candidate of this.pool) {
            if (this.quarantine[candidate.key]) continue
            await this.attempt(candidate, [{ role: 'user', content: 'Reply with the single word OK.' }], 256)
          }
        }
      } catch {
        this.pool = []
        this.lastError = 'Catalog refresh failed. Vercel routing is disabled until verification succeeds.'
      }
      return this.status()
    })
  }

  status() {
    return { model: 'overlay-free', gatewayConfigured: Boolean(this.gatewayKey),
      openRouterConfigured: Boolean(this.openRouterKey), lastRefresh: this.lastRefresh,
      nextRefresh: this.lastRefresh ? this.lastRefresh + HOUR : null, error: this.lastError,
      candidates: this.pool.map(candidate => ({ ...candidate,
        status: this.quarantine[candidate.key] ? 'quarantined'
          : candidate.verifiedAt && this.now() - candidate.verifiedAt >= HOUR ? 'expired' : candidate.status })),
      quarantine: Object.values(this.quarantine),
      fallbackQuarantined: Boolean(this.quarantine['openrouter/free@openrouter']) }
  }

  async attempt(candidate, messages, maxTokens = 1024, timeout = 25000) {
    const started = this.now()
    const trace = { model: candidate.id, provider: candidate.provider, status: 'failed', cost: null }
    const openRouter = candidate.provider === 'openrouter'
    try {
      if (!openRouter) {
        const endpoint = (await this.endpoints(candidate.id)).find(item => item.provider_name === candidate.provider)
        if (!endpoint || !isFreePricing(endpoint.pricing)) {
          await this.block(candidate, 'Pricing changed or cannot be verified', null)
          return { trace: { ...trace, status: 'quarantined', reason: candidate.reason } }
        }
      }
      const completion = await this.json(`${openRouter ? OPENROUTER : GATEWAY}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openRouter ? this.openRouterKey : this.gatewayKey}` },
        body: JSON.stringify({ model: candidate.id, messages, max_tokens: maxTokens, stream: false,
          ...(openRouter ? {} : { providerOptions: { gateway: { only: [candidate.provider], models: [] } } }) }),
      }, timeout)
      const cost = reportedCost(completion)
      trace.cost = cost
      const text = completion.choices?.[0]?.message?.content
      const routedProvider = completion.choices?.[0]?.message?.provider_metadata?.gateway?.routing?.finalProvider
      if (cost !== 0 || (!openRouter && routedProvider && routedProvider !== candidate.provider)) {
        const reason = cost === null ? 'Cost was not reported' : cost > 0 ? `Nonzero charge: $${cost}` : 'Unexpected provider'
        await this.block(candidate, reason, cost)
        trace.status = 'quarantined'
        trace.reason = reason
      } else {
        candidate.verifiedAt = this.now()
        candidate.status = 'ready'
        candidate.cost = 0
        candidate.reason = null
        trace.status = 'success'
      }
      trace.actualModel = completion.model
      trace.durationMs = this.now() - started
      // A completed answer is returned even when its receipt quarantines future calls.
      if (typeof text === 'string' && text.trim()) {
        return { text, trace, usage: completion.usage, generationId: completion.id,
          warning: trace.status === 'quarantined' ? `${candidate.name ?? candidate.id} quarantined: ${trace.reason}. It will not receive further requests.` : null }
      }
      if (trace.status !== 'quarantined') throw new Error('No text returned within the output limit')
      return { trace }
    } catch (error) {
      candidate.status = this.quarantine[candidate.key] ? 'quarantined' : 'cooldown'
      candidate.retryAt = this.now() + 60000
      candidate.reason = error.status ? `HTTP ${error.status}` : 'Request failed or timed out'
      trace.reason = candidate.reason
      trace.durationMs = this.now() - started
      return { trace }
    }
  }

  async generate(messages, { fallbackOnly = false } = {}) {
    return this.exclusive(async () => {
      const attempts = []
      const deadline = this.now() + 90000
      if (this.gatewayKey && !fallbackOnly && this.now() - this.lastRefresh < HOUR) {
        for (const candidate of this.pool) {
          if (this.now() > deadline - 15000) break
          if (this.quarantine[candidate.key] || !candidate.verifiedAt || this.now() - candidate.verifiedAt >= HOUR || candidate.retryAt > this.now()) continue
          const result = await this.attempt(candidate, messages)
          attempts.push(result.trace)
          if (result.text) return { ...result, attempts, model: 'overlay-free' }
        }
      }
      const fallback = { key: 'openrouter/free@openrouter', id: 'openrouter/free', provider: 'openrouter' }
      if (this.openRouterKey && !this.quarantine[fallback.key]) {
        const result = await this.attempt(fallback, messages)
        attempts.push(result.trace)
        if (result.text) return { ...result, attempts, model: 'overlay-free' }
      } else {
        attempts.push({ model: 'openrouter/free', provider: 'openrouter', status: 'skipped',
          reason: this.openRouterKey ? 'Quarantined' : 'OpenRouter key is not configured' })
      }
      return { model: 'overlay-free', error: 'No verified free model is available. No paid fallback was used.', attempts }
    })
  }
}
