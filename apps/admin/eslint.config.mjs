import { defineConfig, globalIgnores } from 'eslint/config'
import { fixupPluginRules } from '@eslint/compat'
import reactPlugin from 'eslint-plugin-react'
import reactHooksPlugin from 'eslint-plugin-react-hooks'

// Patch eslint-plugin-react and eslint-plugin-react-hooks in-place before
// eslint-config-next imports them. ESLint v10 removed context.getFilename()
// which these plugins still use. fixupPluginRules restores the deprecated
// context methods so the plugins work under ESLint v10. Mirrors the root
// eslint.config.mjs.
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

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'next-env.d.ts', 'node_modules/**']),
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['src/shared/**/*.ts', 'src/shared/**/*.tsx'],
    ignores: ['src/shared/**/*.test.ts', 'src/shared/**/*.test.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/server', '@/server/*', '../server/*'],
              message: 'src/shared must not import server-only code.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['*/src/*', '../../../src/*'],
              message: 'apps/admin must not import from the web app src/.',
            },
          ],
        },
      ],
    },
  },
])
