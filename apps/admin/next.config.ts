import type { NextConfig } from 'next'

const convexUrl = (
  process.env.ADMIN_CONVEX_URL
  ?? (process.env.NODE_ENV !== 'production' ? process.env.DEV_NEXT_PUBLIC_CONVEX_URL : undefined)
  ?? process.env.NEXT_PUBLIC_CONVEX_URL
  ?? ''
).trim().replace(/\/+$/, '')
const convexHost = convexUrl ? new URL(convexUrl).origin : ''

const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src 'self' https://api.workos.com${convexHost ? ` ${convexHost}` : ''}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
]

const nextConfig: NextConfig = {
  headers: async () => [
    {
      headers: securityHeaders,
      source: '/:path*',
    },
  ],
  poweredByHeader: false,
  transpilePackages: [
    '@overlay/app-core',
    '@overlay/authz-contracts',
    '@overlay/modules-react',
    '@overlay/tools-core',
    '@overlay/ui',
  ],
}

export default nextConfig
