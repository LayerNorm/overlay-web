import { defineConfig, globalIgnores } from 'eslint/config'
import { fixupPluginRules } from '@eslint/compat'
import reactPlugin from 'eslint-plugin-react'
import reactHooksPlugin from 'eslint-plugin-react-hooks'

// Same ESLint v10 compat patch as the root config: fixupPluginRules restores
// the deprecated context methods react plugins still use under v10.
const patchedReact = fixupPluginRules(reactPlugin)
const patchedReactHooks = fixupPluginRules(reactHooksPlugin)
for (const key of Object.keys(patchedReact)) {
  reactPlugin[key] = patchedReact[key]
}
for (const key of Object.keys(patchedReactHooks)) {
  reactHooksPlugin[key] = patchedReactHooks[key]
}

const nextVitals = (await import('eslint-config-next/core-web-vitals')).default
const nextTs = (await import('eslint-config-next/typescript')).default

/**
 * Hard boundary: the admin app must not reach into the customer app's source
 * tree, and must never read the customer app's secrets. `ADMIN_CONVEX_SECRET`
 * (Stage 1) / `ADMIN_API_SECRET` (Stage 2) may only be read by the single
 * Convex module `src/server/convex-admin.ts`.
 */
const adminBoundaryRules = {
  files: ['src/**/*.{ts,tsx,js,jsx,mts}'],
  ignores: ['src/server/convex-admin.ts'],
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: "MemberExpression[object.name='process'][property.name='ADMIN_CONVEX_SECRET'], MemberExpression[object.name='process'][property.name='ADMIN_API_SECRET']",
        message: 'The admin Convex secret may only be read inside src/server/convex-admin.ts.',
      },
      {
        selector: "MemberExpression[object.name='process'][property.name='INTERNAL_API_SECRET'], MemberExpression[object.name='process'][property.name='INTERNAL_SERVICE_AUTH_SECRET'], MemberExpression[object.name='process'][property.name='SESSION_SECRET'], MemberExpression[object.name='process'][property.name='STRIPE_SECRET_KEY'], MemberExpression[object.name='process'][property.name='PROVIDER_KEYS_SECRET']",
        message: 'The admin app never holds web-app or provider secrets. See docs/plans/ADMIN_CONSOLE_SEPARATION_PLAN.md.',
      },
    ],
  },
}

const convexModuleBoundaryRules = {
  files: ['src/**/*.{ts,tsx,js,jsx,mts}'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['../../../src/*', '../../src/*', '../src/*', 'src/*'],
            message: 'apps/admin must not import the customer app source tree (src/**). Copy what you need or use packages/*.',
          },
        ],
      },
    ],
  },
}

// The Convex secret module may not be imported by client-side code. The file
// carries `server-only`; this rule makes the boundary explicit at lint time.
const convexSecretClientBoundary = {
  files: ['src/app/**/*.{ts,tsx}', 'src/features/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}'],
  ignores: ['**/route.ts'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['**/server/convex-admin', '*/server/convex-admin', '@/server/convex-admin'],
            message: 'convex-admin holds the admin Convex secret; it may only be imported from server route handlers and other src/server modules.',
          },
        ],
      },
    ],
  },
}

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  adminBoundaryRules,
  convexModuleBoundaryRules,
  convexSecretClientBoundary,
  globalIgnores(['.next/**', 'node_modules/**', 'next-env.d.ts']),
])
