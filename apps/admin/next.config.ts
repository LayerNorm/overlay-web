import type { NextConfig } from 'next'

// Content-Security-Policy is set per-request in src/proxy.ts so it can carry a
// nonce: a static `script-src 'self'` blocks Next's inline bootstrap scripts
// and kills hydration. These headers are nonce-independent and stay static.
const securityHeaders = [
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
