import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import createBundleAnalyzer from "@next/bundle-analyzer";
import { withWorkflow } from "workflow/next";

const withBundleAnalyzer = createBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
  openAnalyzer: false,
});

const hasSentryUploadConfig = Boolean(
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT,
);

const mintlifyDocsOrigin = process.env.MINTLIFY_DOCS_URL?.trim().replace(/\/+$/, "");

const staticSecurityHeaders = [
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "SAMEORIGIN",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value:
      "accelerometer=(), ambient-light-sensor=(), autoplay=(self), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(self), midi=(), payment=(), publickey-credentials-get=(self), usb=(), xr-spatial-tracking=()",
  },
  ...(process.env.NODE_ENV === "production"
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains; preload",
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  distDir: process.env.NEXT_DIST_DIR?.trim() || ".next",
  output: process.env.NEXT_OUTPUT_MODE?.trim() === "standalone" ? "standalone" : undefined,
  transpilePackages: ["@overlay/app-core"],
  // Vercel's build container OOMs in `Running TypeScript` on the externalized
  // harness .d.ts trees; typecheck stays enforced via `npm run typecheck`.
  typescript: process.env.OVERLAY_SKIP_BUILD_TYPECHECK === "1"
    ? { ignoreBuildErrors: true }
    : undefined,
  // Managed-harness adapters are server-only and lazily imported — resolve
  // them from node_modules at runtime instead of bundling. This also keeps
  // the ~134MB pi-coding-agent tree and pi-mcp-adapter's raw .ts entry out of
  // the Turbopack trace (Node 24 type-strips it at require time).
  serverExternalPackages: [
    "@ai-sdk/harness",
    "@ai-sdk/harness-acp",
    "@ai-sdk/harness-claude-code",
    "@ai-sdk/harness-codex",
    "@ai-sdk/harness-opencode",
    "@ai-sdk/harness-pi",
    "@ai-sdk/sandbox-vercel",
    "@ai-sdk/workflow-harness",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-coding-agent",
    "pi-mcp-adapter",
  ],
  // Explicit server action body size limit. Prevents DoS via large payloads.
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  async redirects() {
    if (!mintlifyDocsOrigin) return [];

    const docsHost = [{ type: "host" as const, value: "docs.getoverlay.io" }];

    return [
      {
        source: "/docs",
        has: docsHost,
        destination: "https://www.getoverlay.io/docs",
        permanent: false,
      },
      {
        source: "/docs/:path*",
        has: docsHost,
        destination: "https://www.getoverlay.io/docs/:path*",
        permanent: false,
      },
      {
        source: "/:path*",
        has: docsHost,
        destination: "https://www.getoverlay.io/docs/:path*",
        permanent: false,
      },
    ];
  },
  async rewrites() {
    const rewrites: Array<{
      source: string;
      destination: string;
      has?: Array<{ type: "host"; value: string }>;
    }> = [];

    if (mintlifyDocsOrigin) {
      rewrites.push(
        {
          source: "/.well-known/vercel/:path*",
          destination: `${mintlifyDocsOrigin}/.well-known/vercel/:path*`,
        },
        {
          source: "/docs",
          destination: `${mintlifyDocsOrigin}/docs`,
        },
        {
          source: "/docs/:match*",
          destination: `${mintlifyDocsOrigin}/docs/:match*`,
        },
      );
    }

    return rewrites;
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: staticSecurityHeaders,
      },
      {
        // Prevent browsers from caching HTML pages — stale HTML with outdated
        // CSS bundle hashes is the primary cause of users seeing unstyled pages
        // after a new deployment.
        source: "/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Pragma",
            value: "no-cache",
          },
        ],
      },
    ];
  },
};

export default withWorkflow(
  withBundleAnalyzer(
    withSentryConfig(nextConfig, {
      silent: !process.env.CI,
      webpack: {
        disableSentryConfig: !hasSentryUploadConfig,
        treeshake: {
          removeDebugLogging: true,
        },
      },
      ...(hasSentryUploadConfig
        ? {
            authToken: process.env.SENTRY_AUTH_TOKEN,
            org: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT,
            widenClientFileUpload: true,
          }
        : {}),
    }),
  ),
);
