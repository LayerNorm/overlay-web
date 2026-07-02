/**
 * Layer boundary rules for Phase 1.5 (imported by eslint.config.mjs).
 */

export const FEATURE_DOMAINS = [
  'account',
  'auth',
  'automations',
  'billing',
  'chat',
  'files',
  'integrations',
  'knowledge',
  'landing',
  'marketing',
  'notebook',
  'projects',
  'share',
  'tools',
]

/** Server domains that must not import sibling domains (infra paths are exempt). */
export const SERVER_DOMAINS = [
  'agent',
  'ai',
  'auth',
  'billing',
  'chat',
  'knowledge',
  'observability',
  'security',
  'storage',
  'tools',
  'web',
]

const SERVER_INFRA_DOMAINS = ['observability']

const LEGACY_COMPONENT_BOUNDARY_DEBT_FILES = [
  'src/components/layout/PageNavbar.tsx',
  'src/components/providers/GuestGateProvider.tsx',
  'src/components/providers/OnboardingProvider.tsx',
]

const LEGACY_FEATURE_BOUNDARY_DEBT_FILES_BY_DOMAIN = {
  account: ['src/features/account/components/OnboardingTour.tsx'],
  chat: [
    'src/features/chat/components/ChatExperience.tsx',
    'src/features/chat/components/MarkdownMessage.tsx',
    'src/features/chat/components/chat-interface/types.ts',
  ],
  marketing: [
    'src/features/marketing/components/MarketingFooter.tsx',
    'src/features/marketing/components/StaticMarketingShell.tsx',
  ],
  notebook: ['src/features/notebook/components/NotebookEditor.tsx'],
  projects: ['src/features/projects/components/ProjectsView.tsx'],
}

function otherFeatureImportPatterns(selfDomain) {
  return FEATURE_DOMAINS.filter((d) => d !== selfDomain).map(
    (d) => `@/features/${d}/*`,
  )
}

function otherServerImportPatterns(selfDomain) {
  return SERVER_DOMAINS.filter((d) => d !== selfDomain && !SERVER_INFRA_DOMAINS.includes(d)).map(
    (d) => `@/server/${d}/*`,
  )
}

function restrictedPatterns(groups, message) {
  return groups.map((group) => ({
    group: Array.isArray(group) ? group : [group],
    message,
  }))
}

function noRestrictedImports(severity, patterns) {
  return [
    severity,
    {
      patterns,
    },
  ]
}

/** @returns {import('eslint').Linter.Config[]} */
export function createArchitectureBoundaryConfigs() {
  const configs = []

  // src/app — thin routes; no direct asset/type barrel imports.
  configs.push({
    files: ['src/app/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': noRestrictedImports(
        'error',
        restrictedPatterns(
          ['@/assets', '@/assets/*', '@/types', '@/types/*'],
          'App routes may import @/features, @/components, @/server, @/shared, @/hooks, @/contexts, or @overlay packages only.',
        ),
      ),
    },
  })

  // Cross-feature isolation (per domain). Flat config merges by override — split
  // components vs non-components so a later block does not drop cross-feature rules.
  for (const domain of FEATURE_DOMAINS) {
    const crossFeaturePatterns = restrictedPatterns(
      otherFeatureImportPatterns(domain),
      `features/${domain} must not import other feature folders. Use @/shared or lift shared UI to src/components.`,
    )
    const serverPatterns = restrictedPatterns(
      ['@/server', '@/server/*'],
      'Feature components must not import @/server. Use API routes, hooks, or @/shared.',
    )

    configs.push({
      files: [`src/features/${domain}/**/*.{ts,tsx}`],
      ignores: [`src/features/${domain}/**/components/**`],
      rules: {
        'no-restricted-imports': noRestrictedImports(
          'error',
          crossFeaturePatterns,
        ),
      },
    })

    configs.push({
      files: [`src/features/${domain}/**/components/**/*.{ts,tsx}`],
      rules: {
        'no-restricted-imports': noRestrictedImports('error', [
          ...crossFeaturePatterns,
          ...serverPatterns,
        ]),
      },
    })
  }

  // Shared components — no feature or server coupling.
  configs.push({
    files: ['src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': noRestrictedImports(
        'error',
        restrictedPatterns(
          ['@/features/*', '@/server/*'],
          'src/components is for shared UI only. Import from @/shared or pass feature UI via app/layout composition.',
        ),
      ),
    },
  })

  // Existing migration debt is documented in internal-docs/migration-notes.md.
  // Keep these visible as warnings so production builds do not fail before the
  // remaining feature composition work burns the debt down. New files still fail.
  configs.push({
    files: LEGACY_COMPONENT_BOUNDARY_DEBT_FILES,
    rules: {
      'no-restricted-imports': noRestrictedImports(
        'warn',
        restrictedPatterns(
          ['@/features/*', '@/server/*'],
          'src/components is for shared UI only. Import from @/shared or pass feature UI via app/layout composition.',
        ),
      ),
    },
  })

  for (const [domain, files] of Object.entries(
    LEGACY_FEATURE_BOUNDARY_DEBT_FILES_BY_DOMAIN,
  )) {
    configs.push({
      files,
      rules: {
        'no-restricted-imports': noRestrictedImports(
          'warn',
          restrictedPatterns(
            otherFeatureImportPatterns(domain),
            `features/${domain} must not import other feature folders. Use @/shared or lift shared UI to src/components.`,
          ),
        ),
      },
    })
  }

  // Post-migration src/lib — shared-only facade.
  configs.push({
    files: ['src/lib/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': noRestrictedImports(
        'error',
        restrictedPatterns(
          [
            '@/features',
            '@/features/*',
            '@/components',
            '@/components/*',
            '@/server',
            '@/server/*',
            '@/app',
            '@/app/*',
            '@/hooks',
            '@/hooks/*',
            '@/contexts',
            '@/contexts/*',
          ],
          'src/lib (legacy) may only re-export or import from @/shared.',
        ),
      ),
    },
  })

  // Server domain isolation (infra: env + database remain importable from any domain).
  for (const domain of SERVER_DOMAINS) {
    configs.push({
      files: [`src/server/${domain}/**/*.{ts,tsx}`],
      rules: {
        'no-restricted-imports': noRestrictedImports(
          'warn',
          restrictedPatterns(
            otherServerImportPatterns(domain),
            `Prefer not to import other src/server domains from server/${domain}. Use @/shared or a narrow facade.`,
          ),
        ),
      },
    })
  }

  return configs
}
