import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Stripe from 'stripe'
import { loadLocalEnv, readArg } from './convex-admin-utils.ts'

loadLocalEnv()

function resolveStripeSecretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY || process.env.DEV_STRIPE_SECRET_KEY
  if (!key) {
    throw new Error('Missing STRIPE_SECRET_KEY or DEV_STRIPE_SECRET_KEY in .env.local')
  }
  if (!key.startsWith('sk_test_')) {
    const allowLive = readArg('allow-live', 'false') === 'true'
    if (!allowLive) {
      throw new Error('Refusing to run against a non-test Stripe key without --allow-live=true.')
    }
  }
  return key
}

const stripe = new Stripe(resolveStripeSecretKey())

const PRODUCT_METADATA_KEY = 'overlay_kind'
const PRODUCT_METADATA_VALUE = 'variable_paid_plan_v2'
const TOPUP_PRODUCT_METADATA_VALUE = 'budget_topup_v2'
const PORTAL_METADATA_VALUE = 'variable_paid_plan_portal_v2'

function readBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (configured) return configured
  const envPath = resolve(process.cwd(), '.env.local')
  try {
    const raw = readFileSync(envPath, 'utf8')
    const match = raw.match(/^NEXT_PUBLIC_APP_URL=(.+)$/m)
    return match?.[1]?.trim() || 'http://localhost:3000'
  } catch {
    return 'http://localhost:3000'
  }
}

async function findProductByMetadata(value: string) {
  let startingAfter: string | undefined
  while (true) {
    const page = await stripe.products.list({
      active: true,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    const match = page.data.find((product) => product.metadata?.[PRODUCT_METADATA_KEY] === value)
    if (match) return match
    if (!page.has_more || page.data.length === 0) return null
    startingAfter = page.data[page.data.length - 1]?.id
  }
}

async function ensureProduct(args: {
  name: string
  metadataValue: string
  description?: string
}) {
  const existing = await findProductByMetadata(args.metadataValue)
  if (existing) return existing
  return await stripe.products.create({
    name: args.name,
    description: args.description,
    metadata: {
      [PRODUCT_METADATA_KEY]: args.metadataValue,
    },
  })
}

async function ensureRecurringUnitPrice(productId: string) {
  const prices = await stripe.prices.list({
    product: productId,
    active: true,
    type: 'recurring',
    limit: 100,
  })
  const existing = prices.data.find((price) =>
    price.currency === 'usd' &&
    price.unit_amount === 100 &&
    price.recurring?.interval === 'month',
  )
  if (existing) return existing

  return await stripe.prices.create({
    product: productId,
    currency: 'usd',
    unit_amount: 100,
    recurring: {
      interval: 'month',
      usage_type: 'licensed',
    },
    metadata: {
      [PRODUCT_METADATA_KEY]: PRODUCT_METADATA_VALUE,
    },
  })
}

async function ensureTopUpUnitPrice(productId: string) {
  const prices = await stripe.prices.list({
    product: productId,
    active: true,
    type: 'one_time',
    limit: 100,
  })
  const existing = prices.data.find((price) => price.currency === 'usd' && price.unit_amount === 100)
  if (existing) return existing

  return await stripe.prices.create({
    product: productId,
    currency: 'usd',
    unit_amount: 100,
    metadata: {
      [PRODUCT_METADATA_KEY]: TOPUP_PRODUCT_METADATA_VALUE,
      unitAmountCents: '100',
    },
  })
}

async function ensurePortalConfiguration() {
  const configs = await stripe.billingPortal.configurations.list({ active: true, limit: 100 })
  const existing = configs.data.find((config) => config.metadata?.[PRODUCT_METADATA_KEY] === PORTAL_METADATA_VALUE)
  const payload: Stripe.BillingPortal.ConfigurationCreateParams = {
    name: 'Overlay Variable Paid Plan',
    default_return_url: `${readBaseUrl()}/account`,
    business_profile: {
      headline: 'Manage your Overlay paid plan, budget, and payment method.',
    },
    metadata: {
      [PRODUCT_METADATA_KEY]: PORTAL_METADATA_VALUE,
    },
    features: {
      customer_update: {
        enabled: false,
      },
      invoice_history: {
        enabled: true,
      },
      payment_method_update: {
        enabled: true,
      },
      subscription_cancel: {
        enabled: true,
        mode: 'at_period_end',
        proration_behavior: 'none',
      },
      // Named-plan changes must pass through Overlay's guarded preview and
      // confirmation flow. The portal remains available for payment recovery
      // and cancellation, but cannot edit the raw unit quantity.
      subscription_update: { enabled: false },
    },
  }

  if (existing) {
    return await stripe.billingPortal.configurations.update(existing.id, payload)
  }

  return await stripe.billingPortal.configurations.create(payload)
}

async function main() {
  const paidProduct = await ensureProduct({
    name: 'Overlay Paid Plan',
    metadataValue: PRODUCT_METADATA_VALUE,
    description: 'Variable monthly paid plan for Overlay with slider-based quantity billing.',
  })
  const topUpProduct = await ensureProduct({
    name: 'Overlay Budget Top-Up',
    metadataValue: TOPUP_PRODUCT_METADATA_VALUE,
    description: 'One-time budget top-ups for the current billing period.',
  })

  const paidUnitPrice = await ensureRecurringUnitPrice(paidProduct.id)
  const topUpUnitPrice = await ensureTopUpUnitPrice(topUpProduct.id)
  const portalConfiguration = await ensurePortalConfiguration()

  const mode = process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') ? 'live' : 'sandbox'
  console.log(`\nStripe ${mode} resources ready:\n`)
  console.log(`STRIPE_PAID_UNIT_PRICE_ID=${paidUnitPrice.id}`)
  console.log(`STRIPE_TOPUP_UNIT_PRICE_ID=${topUpUnitPrice.id}`)
  console.log(`STRIPE_PORTAL_CONFIGURATION_ID=${portalConfiguration.id}`)
}

void main().catch((error) => {
  console.error('[stripe-variable-pricing-setup] Failed:', error)
  process.exitCode = 1
})
