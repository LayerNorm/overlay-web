import 'server-only'

import type { SandboxUsage } from '@overlay/sandbox-runtime'

const HOUR_MS = 3_600_000
const BILLING_GB_BYTES = 1_000_000_000

export const DEFAULT_VERCEL_SANDBOX_PRICING = {
  activeCpuUsdPerHour: 0.128,
  creationUsd: 0.60 / 1_000_000,
  egressUsdPerGb: 0.15,
  memoryUsdPerGbHour: 0.0212,
} as const

export type VercelSandboxPricing = {
  activeCpuUsdPerHour: number
  creationUsd: number
  egressUsdPerGb: number
  memoryUsdPerGbHour: number
}

export function vercelSandboxPricingFromEnv(): VercelSandboxPricing {
  return {
    activeCpuUsdPerHour: positiveEnv(
      'OVERLAY_VERCEL_SANDBOX_ACTIVE_CPU_USD_PER_HOUR',
      DEFAULT_VERCEL_SANDBOX_PRICING.activeCpuUsdPerHour,
    ),
    creationUsd: nonNegativeEnv(
      'OVERLAY_VERCEL_SANDBOX_CREATION_USD',
      DEFAULT_VERCEL_SANDBOX_PRICING.creationUsd,
    ),
    egressUsdPerGb: positiveEnv(
      'OVERLAY_VERCEL_SANDBOX_EGRESS_USD_PER_GB',
      DEFAULT_VERCEL_SANDBOX_PRICING.egressUsdPerGb,
    ),
    memoryUsdPerGbHour: positiveEnv(
      'OVERLAY_VERCEL_SANDBOX_MEMORY_USD_PER_GB_HOUR',
      DEFAULT_VERCEL_SANDBOX_PRICING.memoryUsdPerGbHour,
    ),
  }
}

export function calculateVercelSandboxCostUsd(args: {
  includeCreation?: boolean
  memoryGb: number
  pricing?: VercelSandboxPricing
  usage: Pick<SandboxUsage, 'activeCpuTimeMs' | 'egressBytes' | 'wallTimeMs'>
}) {
  const pricing = args.pricing ?? vercelSandboxPricingFromEnv()
  const activeCpuTimeMs = nonNegative(args.usage.activeCpuTimeMs)
  const wallTimeMs = nonNegative(args.usage.wallTimeMs)
  const egressBytes = nonNegative(args.usage.egressBytes)
  return Math.max(0,
    activeCpuTimeMs * pricing.activeCpuUsdPerHour / HOUR_MS
      + wallTimeMs * Math.max(0, args.memoryGb) * pricing.memoryUsdPerGbHour / HOUR_MS
      + egressBytes * pricing.egressUsdPerGb / BILLING_GB_BYTES
      + (args.includeCreation ? pricing.creationUsd : 0),
  )
}

export function estimateVercelSandboxReservationUsd(args: {
  includeCreation?: boolean
  maxEgressBytes: number
  maxRunTimeMs: number
  memoryGb: number
  pricing?: VercelSandboxPricing
  reservationBufferPercent?: number
  vcpus: number
}) {
  const estimated = calculateVercelSandboxCostUsd({
    includeCreation: args.includeCreation,
    memoryGb: args.memoryGb,
    pricing: args.pricing,
    usage: {
      // Vercel reports active CPU as vCPU milliseconds, so reserve for every
      // allocated vCPU being active for the entire allowed wall-clock time.
      activeCpuTimeMs: Math.max(0, args.maxRunTimeMs) * Math.max(0, args.vcpus),
      egressBytes: Math.max(0, args.maxEgressBytes),
      wallTimeMs: Math.max(0, args.maxRunTimeMs),
    },
  })
  const bufferPercent = args.reservationBufferPercent ?? sandboxReservationBufferPercent()
  return estimated * (1 + Math.max(0, bufferPercent) / 100)
}

export function sandboxProviderCostLimitUsd() {
  return positiveEnv('OVERLAY_SANDBOX_MAX_PROVIDER_COST_USD_PER_RUN', 15)
}

export function sandboxReservationBufferPercent() {
  return nonNegativeEnv('OVERLAY_VERCEL_SANDBOX_RESERVATION_BUFFER_PERCENT', 25)
}

function positiveEnv(name: string, fallback: number) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function nonNegativeEnv(name: string, fallback: number) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

function nonNegative(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}
