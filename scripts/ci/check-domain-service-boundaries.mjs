import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function findRouteFiles(dir, prefix = '') {
  const entries = readdirSync(dir, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) return findRouteFiles(fullPath, relativePath)
    return entry.isFile() && entry.name === 'route.ts' ? [relativePath] : []
  })
}

const checks = [
  {
    name: 'automations routes',
    files: findRouteFiles('src/server/app-api/v1/automations')
      .map((file) => join('src/server/app-api/v1/automations', file)),
    forbidden: [
      /@\/server\/database\/convex/,
      /\bconvex\.(query|mutation|action)\b/,
      /['"]automations\/automations:/,
      /['"]chat\/conversations:/,
      /['"]platform\/usage:getEntitlementsByServer/,
      /runActTurnForScheduledAutomation/,
      /emitAutomation(Failed|Finished)/,
    ],
  },
  {
    name: 'billing customer routes',
    files: [
      'src/app/api/subscription/route.ts',
      'src/app/api/subscription/settings/route.ts',
      'src/app/api/checkout/route.ts',
      'src/app/api/checkout/verify/route.ts',
      'src/app/api/portal/route.ts',
      'src/app/api/topups/checkout/route.ts',
      'src/app/api/topups/history/route.ts',
      'src/app/api/topups/verify/route.ts',
      'src/app/api/entitlements/route.ts',
      'src/server/app-api/v1/subscription/route.ts',
    ],
    forbidden: [
      /@\/server\/database\/convex/,
      /\bconvex\.(query|mutation|action)\b/,
      /['"]billing\/subscriptions:/,
      /['"]platform\/usage:getEntitlementsByServer/,
      /@\/server\/billing\/stripe['"]/,
      /\bstripe\.(checkout|billingPortal|customers|subscriptions|paymentIntents)\b/,
    ],
  },
  {
    name: 'conversations act route',
    files: ['src/server/app-api/v1/conversations/act/route.ts'],
    forbidden: [
      /@\/server\/database\/convex/,
      /\bconvex\.(query|mutation|action)\b/,
      /['"]chat\/conversations:/,
      /['"]knowledge\/memories:/,
      /['"]integrations\/skills:/,
      /['"]projects\/projects:/,
      /['"]platform\/usage:/,
      /buildAssistantPersistenceFromSteps/,
      /compactAssistantPersistenceForConvex/,
      /buildPersistedMessageContent/,
      /sanitizeMessagePartsForPersistence/,
      /buildAutoRetrievalBundle/,
      /buildDocumentContextBundle/,
      /resolveMentionsContext/,
      /emitChat(Completed|Failed)/,
      /reserveProviderBudget/,
      /finalizeProviderBudgetReservation/,
      /releaseProviderBudgetReservation/,
      /markProviderBudgetReconcile/,
    ],
  },
]

const violations = []

for (const check of checks) {
  for (const file of check.files) {
    const source = readFileSync(file, 'utf8')
    for (const pattern of check.forbidden) {
      if (pattern.test(source)) {
        violations.push(`${file}: ${check.name} forbidden ${pattern}`)
      }
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join('\n'))
  process.exit(1)
}

console.log('OK: automations, billing customer, and conversations act routes delegate domain work to services.')
