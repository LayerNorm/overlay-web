---
title: "Docs Hosting"
description: "Serve the Mintlify docs from overlay.works/docs or docs.overlay.works (docs.getoverlay.io still redirects)."
---

Overlay docs are authored in `docs/` and hosted by Mintlify. The production web app can proxy those docs through Vercel so customers can use either `overlay.works/docs` or `docs.overlay.works` (the old `docs.getoverlay.io` redirects the same way).

## Vercel Rewrite

`next.config.ts` reads this build-time environment variable:

```bash
MINTLIFY_DOCS_URL=https://your-subdomain.mintlify.dev
```

Do not include a trailing slash or `/docs`; the app adds the required `/docs`
upstream path.

When `MINTLIFY_DOCS_URL` is set, the app adds these routes:

| Public URL | Upstream |
| --- | --- |
| `https://overlay.works/docs` | `${MINTLIFY_DOCS_URL}/docs` |
| `https://overlay.works/docs/*` | `${MINTLIFY_DOCS_URL}/docs/*` |
| `https://overlay.works/.well-known/vercel/*` | `${MINTLIFY_DOCS_URL}/.well-known/vercel/*` |
| `https://docs.overlay.works/*` and `https://docs.getoverlay.io/*` | Redirect to `https://overlay.works/docs/*` |

## Mintlify Setup

In Mintlify:

1. Connect the Git repository.
2. Set the docs content directory to `docs/`.
3. Enable **Host at `/docs`** in Mintlify for `overlay.works`.
4. Use the project's `*.mintlify.dev` URL for `MINTLIFY_DOCS_URL`. The
   `*.mintlify.app` URL is for root/custom-subpath proxies and will generate
   incorrect root-relative navigation links in this setup.
5. Keep only publishable docs in `docs/`; internal reports, authenticated screenshots, and proprietary design references stay in an access-controlled system outside this repository.

## Vercel Setup

In the Overlay Vercel project:

1. Add `MINTLIFY_DOCS_URL` in Project Settings -> Environment Variables for production and preview as needed.
2. Ensure `overlay.works` is attached to the project.
3. If using `docs.overlay.works` (or the old `docs.getoverlay.io`) through the same Vercel project, add that domain to the project too.
4. Deploy the app after the env var is set, because Next.js rewrites are generated at build time.

If a docs subdomain is pointed directly at Mintlify instead, do not add it to the Vercel project; configure the CNAME and verification records in Mintlify instead.

## Verification

Before deployment:

```bash
bun run docs:check
```

After deployment:

- `https://overlay.works/docs` loads the docs home.
- `https://overlay.works/docs/developer/contribute/run-locally` loads a nested docs page.
- `https://overlay.works/docs/sitemap.xml` and `https://overlay.works/docs/llms.txt` resolve.
- `https://docs.overlay.works` loads the docs home if that subdomain is attached to Vercel.
- The browser URL remains on the Overlay domain instead of redirecting to Mintlify.
- Docs pages declare canonical URLs under `https://overlay.works/docs/…`.
  Set the complete base, including `/docs`, in `docs/docs.json` because Mintlify
  appends the path relative to the docs root.
- The app's root sitemap lists the canonical docs URLs. It uses Mintlify's
  directory URL for navigation entries ending in `/index`, and includes the
  reference paths Mintlify generates from OpenAPI operation tags and summaries.
  Mintlify controls the separate docs sitemap's host through its domain configuration.
