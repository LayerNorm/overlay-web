import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import createBundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = createBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
  openAnalyzer: false,
});

const hasSentryUploadConfig = Boolean(
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT,
);

const mintlifyDocsOrigin = process.env.MINTLIFY_DOCS_URL?.trim().replace(/\/+$/, "").replace(/\/docs$/, "");

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
  distDir: process.env.NEXT_DIST_DIR?.trim() || ".next",
  output: process.env.NEXT_OUTPUT_MODE?.trim() === "standalone" ? "standalone" : undefined,
  transpilePackages: ["@overlay/app-core"],
  async rewrites() {
    const rewrites: Array<{
      source: string;
      destination: string;
      has?: Array<{ type: "host"; value: string }>;
    }> = [];

    if (mintlifyDocsOrigin) {
      rewrites.push(
        {
          source: "/_mintlify/:path*",
          destination: `${mintlifyDocsOrigin}/_mintlify/:path*`,
        },
        {
          source: "/api/request",
          destination: `${mintlifyDocsOrigin}/_mintlify/api/request`,
        },
        {
          source: "/docs/llms.txt",
          destination: `${mintlifyDocsOrigin}/llms.txt`,
        },
        {
          source: "/docs/llms-full.txt",
          destination: `${mintlifyDocsOrigin}/llms-full.txt`,
        },
        {
          source: "/docs/sitemap.xml",
          destination: `${mintlifyDocsOrigin}/sitemap.xml`,
        },
        {
          source: "/docs/robots.txt",
          destination: `${mintlifyDocsOrigin}/robots.txt`,
        },
        {
          source: "/docs/mcp",
          destination: `${mintlifyDocsOrigin}/mcp`,
        },
        {
          source: "/docs",
          destination: `${mintlifyDocsOrigin}/docs`,
        },
        {
          source: "/docs/:match*",
          destination: `${mintlifyDocsOrigin}/docs/:match*`,
        },
        {
          source: "/mintlify-assets/:path*",
          destination: `${mintlifyDocsOrigin}/mintlify-assets/:path*`,
        },
        {
          source: "/",
          has: [{ type: "host", value: "docs.getoverlay.io" }],
          destination: mintlifyDocsOrigin,
        },
        {
          source: "/:match*",
          has: [{ type: "host", value: "docs.getoverlay.io" }],
          destination: `${mintlifyDocsOrigin}/:match*`,
        },
      );
    }

    if (
      process.env.NODE_ENV === "development" &&
      process.env.NEXT_PUBLIC_CHAT_STREAM_RELAY_LOCAL === "true"
    ) {
      const relayOrigin =
        process.env.CHAT_STREAM_RELAY_DEV_ORIGIN?.trim() || "http://127.0.0.1:8787";
      rewrites.push({
        source: "/api/chat-stream/:path*",
        destination: `${relayOrigin}/api/chat-stream/:path*`,
      });
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

export default withBundleAnalyzer(withSentryConfig(nextConfig, {
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
}));
