# Development

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Use Node 20+ and npm.

## Required Web Env

Set real values locally and in the deployed environment:

```bash
NEXT_PUBLIC_CONVEX_URL=
DEV_NEXT_PUBLIC_CONVEX_URL=
NEXT_PUBLIC_APP_URL=
DEV_NEXT_PUBLIC_APP_URL=

SESSION_SECRET=
INTERNAL_API_SECRET=
SESSION_TRANSFER_KEY=
SESSION_COOKIE_ENCRYPTION_KEY=
PROVIDER_KEYS_SECRET=
HOOKS_TOKEN_SALT=

WORKOS_CLIENT_ID=
WORKOS_API_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```

Optional integrations depend on the feature being exercised:

```bash
AI_GATEWAY_API_KEY=
NEXT_PUBLIC_POSTHOG_TOKEN=
NEXT_PUBLIC_POSTHOG_HOST=
```

## Convex

Keep prod and dev Convex deployments separate.

```bash
npm run convex:push:prod
npm run convex:push:dev
npm run convex:push:all
```

If code under `convex/` changes, push both deployments before considering the app verified.

## Stripe Local Webhooks

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

## Verification

Run the smallest check that covers the change:

```bash
npm run typecheck
npm run lint
npm run build
```

For focused code edits, a targeted ESLint command against changed files is acceptable when full lint is blocked by unrelated generated/mobile issues.

## Git Hygiene

- Do not commit secrets or customer data.
- Do not revert unrelated user changes.
- Keep docs living and short; avoid dated report files unless they are intentionally archived outside the repo.
