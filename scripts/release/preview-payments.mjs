import { CONFIG, PreviewBackends, previewAddress } from './preview-control.mjs'

export const PREVIEW_STRIPE_EVENTS = ['customer.subscription.created', 'customer.subscription.updated',
  'customer.subscription.deleted', 'invoice.payment_failed', 'payment_intent.succeeded',
  'payment_intent.payment_failed', 'payment_intent.canceled', 'checkout.session.completed']

export function stripeTestClient(key, fetchImpl = fetch) {
  if (typeof key !== 'string' || !/^(sk|rk)_test_[A-Za-z0-9_]+$/.test(key)) throw new Error('Preview payments require a Stripe test key')
  return async (path, { method = 'GET', body, idempotencyKey, query = {} } = {}) => {
    if (!/^\/webhook_endpoints(?:\/we_[A-Za-z0-9]+)?$/.test(path)) throw new Error('Invalid Stripe Preview API path')
    const url = new URL('https://api.stripe.com/v1' + path)
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value)
    let response
    try {
      response = await fetchImpl(url, { method, redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: { authorization: `Bearer ${key}`, ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
          ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}) },
        ...(body ? { body: new URLSearchParams(body).toString() } : {}) })
    } catch { throw new Error('Stripe Preview API network request failed') }
    let value
    try { value = await response.json() } catch { throw new Error('Stripe Preview API returned invalid JSON') }
    if (!response.ok) {
      const error = new Error(`Stripe Preview API ${response.status}`)
      error.status = response.status
      throw error
    }
    return value
  }
}

async function optional(api, id) {
  if (!/^we_[A-Za-z0-9]+$/.test(id)) throw new Error('Invalid Stripe endpoint identity')
  try { return await api('/webhook_endpoints/' + id) } catch (error) { if (error.status === 404) return null; throw error }
}

/** Dependency-free: trusted controller does not install packages or execute PR code. */
export class PreviewPayments {
  constructor({ api, backends }) { this.api = api; this.backends = backends }
  async list() {
    const items = []; const seen = new Set()
    let after
    do {
      const page = await this.api('/webhook_endpoints', { query: { limit: '100', ...(after ? { starting_after: after } : {}) } })
      if (!Array.isArray(page.data)) throw new Error('Invalid Stripe Preview inventory')
      for (const endpoint of page.data) {
        if (seen.has(endpoint.id)) throw new Error('Stripe Preview inventory repeated an endpoint')
        seen.add(endpoint.id); items.push(endpoint)
      }
      after = page.has_more ? page.data.at(-1)?.id : undefined
      if ((page.has_more && !after) || items.length > 10_000) throw new Error('Stripe Preview inventory is incomplete')
    } while (after)
    return items
  }
  owned(endpoint, number) {
    return endpoint.metadata?.overlayPreviewProject === String(CONFIG.convexProjectId)
      && endpoint.metadata?.overlayPreviewPr === String(number)
  }
  validate(endpoint, number, backend) {
    new PreviewBackends({ api: null }).validate(backend, number)
    if (!endpoint || !/^we_[A-Za-z0-9]+$/.test(endpoint.id) || endpoint.livemode !== false || !this.owned(endpoint, number)
      || endpoint.metadata.overlayPreviewBackend !== backend.name
      || endpoint.url !== `https://${backend.name}.convex.site/stripe/webhook`) {
      throw new Error('Stripe Preview endpoint ownership mismatch')
    }
    return endpoint
  }
  async inventory() {
    const numbers = new Set()
    for (const endpoint of await this.list()) {
      if (endpoint.metadata?.overlayPreviewProject !== String(CONFIG.convexProjectId)) continue
      const number = Number(endpoint.metadata?.overlayPreviewPr)
      previewAddress(number)
      const backend = await this.backends.find(number)
      // Keep a missing owner's PR discoverable. Its individual cleanup fails
      // closed without blocking reconciliation of unrelated healthy previews.
      if (backend) this.validate(endpoint, number, backend)
      numbers.add(number)
    }
    return [...numbers]
  }
  async provision(number, { readState, saveState }) {
    previewAddress(number)
    const backend = await this.backends.find(number)
    if (!backend) throw new Error('Preview payments require an owned backend')
    new PreviewBackends({ api: null }).validate(backend, number)
    const matches = (await this.list()).filter(endpoint => this.owned(endpoint, number))
    if (matches.length > 1) throw new Error('Ambiguous Stripe Preview endpoints')
    const existing = matches[0] && this.validate(matches[0], number, backend)
    const state = await readState()
    if (existing && existing.id === state?.id && state?.secret) {
      const required = PREVIEW_STRIPE_EVENTS.every(event => existing.enabled_events?.includes(event))
      if (!required || existing.status !== 'enabled') {
        const body = [['disabled', 'false'], ...PREVIEW_STRIPE_EVENTS.map(event => ['enabled_events[]', event])]
        await this.api('/webhook_endpoints/' + existing.id, { method: 'POST', body })
      }
      const checked = this.validate(await optional(this.api, existing.id), number, backend)
      if (checked.status !== 'enabled' || !PREVIEW_STRIPE_EVENTS.every(event => checked.enabled_events?.includes(event))) {
        throw new Error('Stripe Preview endpoint configuration readback failed')
      }
      return { id: existing.id, reused: true }
    }
    const body = [['url', `https://${backend.name}.convex.site/stripe/webhook`],
      ['description', `Overlay isolated PR ${number} Preview`],
      ...PREVIEW_STRIPE_EVENTS.map(event => ['enabled_events[]', event]),
      ['metadata[overlayPreviewPr]', String(number)], ['metadata[overlayPreviewProject]', String(CONFIG.convexProjectId)],
      ['metadata[overlayPreviewBackend]', backend.name]]
    // Replaying this exact creation recovers the original secret after a lost
    // response/persist failure, within Stripe's idempotency retention window.
    const created = this.validate(await this.api('/webhook_endpoints', { method: 'POST', body,
      idempotencyKey: `overlay-preview-${number}-${backend.name}` }), number, backend)
    if (existing && created.id !== existing.id) {
      // The original idempotency response expired. Remove only the new duplicate;
      // never silently rotate a still-owned endpoint with an unknown secret.
      await this.deleteConfirmed(created.id)
      throw new Error('Stripe signing secret recovery expired; inspect the existing owned endpoint')
    }
    if (!created.secret?.startsWith('whsec_')) throw new Error('Stripe Preview signing secret is unavailable')
    await saveState({ id: created.id, secret: created.secret })
    const checked = this.validate(await optional(this.api, created.id), number, backend)
    if (checked.status !== 'enabled') throw new Error('Stripe Preview endpoint is not enabled')
    return { id: created.id, reused: false }
  }
  async deleteConfirmed(id) {
    try { await this.api('/webhook_endpoints/' + id, { method: 'DELETE' }) } catch (error) {
      if (await optional(this.api, id)) throw error
      return
    }
    if (await optional(this.api, id)) throw new Error('Stripe Preview endpoint deletion readback failed')
  }
  async remove(number) {
    previewAddress(number)
    const matches = (await this.list()).filter(endpoint => this.owned(endpoint, number))
    if (!matches.length) return
    const backend = await this.backends.find(number)
    if (!backend) throw new Error('Stripe Preview cleanup requires a verifiable backend owner')
    for (const endpoint of matches) this.validate(endpoint, number, backend)
    for (const endpoint of matches) await this.deleteConfirmed(endpoint.id)
    if ((await this.list()).some(endpoint => this.owned(endpoint, number))) throw new Error('Stripe Preview cleanup is incomplete')
  }
}

/** Reuse the existing Preview-only key; never add a production or per-PR token. */
export function previewPaymentsFromVercel(vercel, backends, fetchImpl = fetch) {
  let client
  async function getClient() {
    if (client) return client
    const result = await vercel(`/v10/projects/${CONFIG.projectId}/env`)
    if (!Array.isArray(result.envs) || result.pagination?.next) throw new Error('Preview credential inventory is incomplete')
    const entries = result.envs.filter(entry => entry.key === 'STRIPE_SECRET_KEY' && !entry.gitBranch
      && entry.target?.includes('preview'))
    if (entries.length !== 1 || entries[0].target.some(target => target !== 'preview')) throw new Error('Expected one Preview-only Stripe credential')
    const entry = entries[0]
    const value = await vercel(`/v1/projects/${CONFIG.projectId}/env/${encodeURIComponent(entry.id)}`)
    client = stripeTestClient(value.value, fetchImpl)
    return client
  }
  return new PreviewPayments({ backends, api: async (...args) => (await getClient())(...args) })
}
