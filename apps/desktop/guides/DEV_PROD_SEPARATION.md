# Development vs Production Environment Separation

This guide explains how the overlay application separates development and production environments across all services.

## Overview

The overlay ecosystem consists of:
- **Desktop App** (Electron) - The main overlay application
- **Landing Page** (Next.js) - Website at getoverlay.io / localhost:3000
- **Convex** - Backend database and functions
- **Stripe** - Payment processing
- **WorkOS** - Authentication

All services have separate dev and prod configurations that are automatically selected based on `NODE_ENV`.

---

## Environment Summary

| Component | Dev Mode | Prod Mode |
|-----------|----------|-----------|
| **Landing Page URL** | `http://localhost:3000` | `https://getoverlay.io` |
| **Convex Deployment** | your-dev-deployment | your-prod-deployment |
| **Stripe** | Sandbox (test keys) | Live (production keys) |
| **WorkOS** | Staging environment | Production environment |
| **Deep Links** | `overlay://` | `overlay://` |

---

## Running in Development Mode

### 1. Desktop App (Electron)

```bash
cd /path/to/overlay-desktop
npm run dev
```

This will:
- Use `DEV_WORKOS_CLIENT_ID` for authentication
- Connect to `http://localhost:3000` for auth pages
- Use staging WorkOS environment

### 2. Landing Page (Next.js)

```bash
cd /path/to/overlay-server
npm run dev
```

This will:
- Run on `http://localhost:3000`
- Use `DEV_NEXT_PUBLIC_CONVEX_URL` for the development Convex deployment
- Use `DEV_STRIPE_SECRET_KEY` and `DEV_STRIPE_*_PRICE_ID` (sandbox)
- Use `DEV_WORKOS_*` credentials (staging)

### 3. Convex

```bash
cd /path/to/overlay-server
npx convex dev
```

This connects to your development Convex deployment.

---

## Environment Variables

All environment variables are stored in `.env.local` (never commit this file):

### WorkOS (Authentication)

```env
# Development (Staging)
DEV_WORKOS_CLIENT_ID=client_...
DEV_WORKOS_API_KEY=sk_test_...

# Production
WORKOS_CLIENT_ID=client_...
WORKOS_API_KEY=sk_...
```

### Stripe (Payments)

```env
# Development (Sandbox)
DEV_STRIPE_SECRET_KEY=sk_test_...
DEV_STRIPE_PRO_PRICE_ID=price_...
DEV_STRIPE_MAX_PRICE_ID=price_...

# Production (Live)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PRO_PRICE_ID=price_...
STRIPE_MAX_PRICE_ID=price_...
```

### Convex (Database)

```env
# Development
DEV_CONVEX_URL=https://your-dev-deployment.convex.cloud
DEV_NEXT_PUBLIC_CONVEX_URL=https://your-dev-deployment.convex.cloud

# Production
NEXT_PUBLIC_CONVEX_URL=https://your-prod-deployment.convex.cloud
```

---

## How Environment Selection Works

### Landing Page (Next.js)

The landing page uses `process.env.NODE_ENV` to determine which credentials to use:

```typescript
const IS_DEV = process.env.NODE_ENV === 'development'
const CONVEX_URL = IS_DEV
  ? process.env.DEV_NEXT_PUBLIC_CONVEX_URL
  : process.env.NEXT_PUBLIC_CONVEX_URL

const stripeSecretKey = IS_DEV
  ? process.env.DEV_STRIPE_SECRET_KEY
  : process.env.STRIPE_SECRET_KEY
```

### Desktop App (Electron)

The desktop app uses `import.meta.env.DEV` or `import.meta.env.IS_DEV`:

```typescript
const IS_DEV = import.meta.env.IS_DEV === 'true' || import.meta.env.DEV
export const WORKOS_CLIENT_ID = IS_DEV
  ? import.meta.env.DEV_WORKOS_CLIENT_ID
  : import.meta.env.WORKOS_CLIENT_ID

export const CUSTOM_AUTH_BASE_URL = IS_DEV
  ? 'http://localhost:3000'
  : 'https://getoverlay.io'
```

---

## Deep Links

Deep links always use `overlay://` protocol for both dev and prod. This is because:
1. WorkOS redirect URIs are registered with `overlay://auth/callback`
2. The Electron app registers the `overlay://` protocol handler

---

## Desktop App Auth Flow (Desktop → Landing → Desktop)

### Flow 1: Sign-in from Desktop App Onboarding

1. **User clicks "Sign In" in desktop app**
2. **Desktop app opens browser** to `{CUSTOM_AUTH_BASE_URL}/auth/sign-in?redirect=overlay://auth/callback&force=true`
   - Dev: `http://localhost:3000/auth/sign-in?redirect=overlay://auth/callback&force=true`
   - Prod: `https://getoverlay.io/auth/sign-in?redirect=overlay://auth/callback&force=true`
3. **Landing page auto sign-out** - If coming from desktop (`overlay://` redirect or `force=true`), any existing session is cleared automatically
4. **User signs in** via Google/Apple/Email on the branded landing page
5. **WorkOS callback** → Landing page syncs user to the backend
6. **Deep link redirect** → `overlay://auth/callback?code=...`
7. **Desktop app receives code** and exchanges for tokens

### Flow 2: "Open in App" from Landing Page Account

When a user is signed into the landing page and clicks "Open in App":

1. **User clicks "Open in App"** on the account page
2. **Landing page generates auth deep link** via `/api/auth/desktop-link`
3. **Deep link contains session data** → `overlay://auth/session?data={base64_encoded_session}`
4. **Desktop app receives session** and stores it directly (no code exchange needed)
5. **Desktop app signs in with the landing page account** - replacing any existing session

This makes the **landing page the central hub** for account management. Whatever account is signed into the landing page controls what account is used in the desktop app.

---

## Clearing Desktop App Data (For Testing)

To reset the desktop app and test onboarding again:

```bash
# For development builds (Electron)
rm -rf ~/Library/Application\ Support/Electron

# For production builds
rm -rf ~/Library/Application\ Support/overlay
```

This clears:
- Auth session
- Onboarding state
- User preferences
- Local storage

---

## Stripe Sandbox Testing

In dev mode, you can use Stripe test cards:

| Card Number | Description |
|-------------|-------------|
| `4242 4242 4242 4242` | Successful payment |
| `4000 0000 0000 3220` | 3D Secure required |
| `4000 0000 0000 0002` | Declined |

Use any future expiry date and any CVC.

---

## Troubleshooting

### "Failed to sync user profile" Error

This usually means the Convex deployment URL mismatch. Check:
1. Landing page is using the correct Convex URL for the environment
2. The Convex dev server is running: `npx convex dev`

### Stripe Price ID Not Found

Ensure you're using the correct price IDs for the environment:
- Dev: `DEV_STRIPE_*_PRICE_ID`
- Prod: `STRIPE_*_PRICE_ID`

### WorkOS "Invalid Redirect URI"

The redirect URI must match exactly what's registered in WorkOS:
- Always use `overlay://auth/callback`
- Check you're using the correct WorkOS environment (staging vs production)

### Desktop App Not Receiving Auth Callback

1. Ensure the `overlay://` protocol handler is registered
2. Check the landing page deep link is correct
3. Verify the desktop app is running and listening for deep links

---

## Production Deployment Checklist

Before deploying to production:

1. Set `NODE_ENV=production` on Vercel/hosting
2. Ensure production env vars are set (without `DEV_` prefix)
3. Verify Stripe is using live keys
4. Confirm Convex is pointing to the production deployment
5. Check WorkOS is using production credentials
6. Test the full auth flow end-to-end
