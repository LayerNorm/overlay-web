import type { NextConfig } from 'next'

const connectSources = [
  "'self'",
  // Convex deployments reachable from this console (prod, staging, per-PR
  // preview, engineer dev backends) all live on the convex.cloud wildcard.
  'https://*.convex.cloud',
  'wss://*.convex.cloud',
  'https://api.workos.com',
  process.env.NODE_ENV === 'development' ? 'http://localhost:* http://127.0.0.1:* ws://localhost:*' : '',
].filter(Boolean).join(' ')

const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: [
      `default-src 'self'`,
      `script-src 'self' 'unsafe-inline'`,
      `style-src 'self' 'unsafe-inline'`,
      `img-src 'self' data:`,
      `font-src 'self' data:`,
      `connect-src ${connectSources}`,
      `frame-ancestors 'none'`,
      `base-uri 'self'`,
      `form-action 'self'`,
    ].join('; '),
  },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
  ...(process.env.NODE_ENV === 'production'
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' }]
    : []),
]

const nextConfig: NextConfig = {
  // Inside the monorepo, Turbopack would otherwise infer the repo root as the
  // project root and pick up the customer app's src/proxy.ts,
  // instrumentation, and sentry config files.
  transpilePackages: ['@overlay/app-core', '@overlay/authz-contracts', '@overlay/tools-core', '@overlay/ui'],
  poweredByHeader: false,
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
}

export default nextConfig
