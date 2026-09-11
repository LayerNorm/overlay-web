function mask(value: string | undefined | null, start = 8, end = 6): string | null {
  if (!value) return null
  if (value.length <= start + end) return value
  return `${value.slice(0, start)}…${value.slice(-end)}`
}

const report = {
  nodeEnv: process.env.NODE_ENV ?? null,
  convexUrl: process.env.DEV_NEXT_PUBLIC_CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL || null,
  hasInternalApiSecret: Boolean(process.env.INTERNAL_API_SECRET),
  hasSessionSecret: Boolean(process.env.SESSION_SECRET),
  workosClientId: process.env.DEV_WORKOS_CLIENT_ID || process.env.WORKOS_CLIENT_ID || null,
  workosApiKeyPresent: Boolean(process.env.DEV_WORKOS_API_KEY || process.env.WORKOS_API_KEY),
  previews: {
    devWorkosClientId: mask(process.env.DEV_WORKOS_CLIENT_ID),
    workosClientId: mask(process.env.WORKOS_CLIENT_ID),
    convexUrl: mask(process.env.DEV_NEXT_PUBLIC_CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL || null, 20, 16),
    internalApiSecret: mask(process.env.INTERNAL_API_SECRET),
    sessionSecret: mask(process.env.SESSION_SECRET),
  },
}

const missing: string[] = []
if (!report.convexUrl) missing.push('DEV_NEXT_PUBLIC_CONVEX_URL or NEXT_PUBLIC_CONVEX_URL')
if (!report.hasInternalApiSecret) missing.push('INTERNAL_API_SECRET')
if (!report.hasSessionSecret) missing.push('SESSION_SECRET')
if (!report.workosClientId) missing.push('DEV_WORKOS_CLIENT_ID or WORKOS_CLIENT_ID')
if (!report.workosApiKeyPresent) missing.push('DEV_WORKOS_API_KEY or WORKOS_API_KEY')

console.log(JSON.stringify({ ok: missing.length === 0, report, missing }, null, 2))

if (missing.length > 0) {
  process.exit(1)
}
