import { readFileSync } from 'node:fs'

const rules = [
  ['src/server/app-api/v1/conversations/act/route.ts', 'reserveForAttempt', 'markReservationStarted'],
  ['src/server/app-api/v1/conversations/act/extension-plan/route.ts', 'reserveProviderBudget', 'markProviderBudgetStarted'],
  ['src/server/app-api/v1/generate-title/route.ts', 'reserveForAttempt', 'markReservationStarted'],
  ['src/server/app-api/v1/generate-tab-group-label/route.ts', 'reserveProviderBudget', 'markProviderBudgetStarted'],
  ['src/server/app-api/v1/chat-suggestions/route.ts', 'generationUsagePolicy.reserve', 'generationUsagePolicy.markStarted'],
  ['src/server/app-api/v1/generate-image/route.ts', 'generationUsagePolicy.reserve', 'generationUsagePolicy.markStarted'],
  ['src/server/app-api/v1/generate-video/route.ts', 'generationUsagePolicy.reserve', 'generationUsagePolicy.markStarted'],
  ['src/server/app-api/v1/browser-task/route.ts', 'generationUsagePolicy.reserve', 'generationUsagePolicy.markStarted'],
  ['src/server/app-api/v1/notebook-agent/route.ts', 'reserveProviderBudget', 'markProviderBudgetStarted'],
  ['src/server/app-api/v1/transcribe/route.ts', 'generationUsagePolicy.reserve', 'generationUsagePolicy.markStarted'],
  ['src/server/app-api/v1/daytona/run/route.ts', 'reserveDaytonaRunBudget', 'generationUsagePolicy.markStarted'],
]

const failures = []
for (const [file, reservationMarker, startMarker] of rules) {
  const source = readFileSync(file, 'utf8')
  if (!source.includes(reservationMarker)) failures.push(`${file}: missing ${reservationMarker}`)
  if (!source.includes(startMarker)) failures.push(`${file}: missing ${startMarker}`)
}

const bff = readFileSync('src/app/api/v1/_utils/bff.ts', 'utf8')
if (
  !bff.includes('ownerFundedOperationRequiresIdempotencyKey') ||
  !bff.includes('idempotency_key_required')
) {
  failures.push('BFF does not fail closed when an owner-funded mutation omits Idempotency-Key')
}

const postgresRuntime = readFileSync('src/server/jobs/postgres-runtime.ts', 'utf8')
const bootstrap = readFileSync('src/server/bootstrap.ts', 'utf8')
if (!postgresRuntime.includes('new ServerProviderUsageMeter(usage)')) {
  failures.push('Postgres background providers are not wired to the usage meter')
}
if (!bootstrap.includes('new ServerProviderUsageMeter(appData.repositories.usage)')) {
  failures.push('Postgres request-time embeddings are not wired to the usage meter')
}

const desktopUsage = [
  'overlay-desktop/src/main/services/subscription-service.ts',
  'overlay-desktop/src/main/services/security/usage-tracking-service.ts',
].map((file) => readFileSync(file, 'utf8')).join('\n')
if (desktopUsage.includes("platform/usage:recordBatch")) {
  failures.push('Desktop still writes client-calculated usage to the authoritative ledger')
}

const knowledgeRoute = readFileSync('src/server/app-api/v1/knowledge/search/route.ts', 'utf8')
const knowledgeRepository = readFileSync('src/server/knowledge/PostgresKnowledgeSearchRepository.ts', 'utf8')
const convexKnowledge = readFileSync('convex/knowledge/knowledge.ts', 'utf8')
if (!knowledgeRoute.includes('requestIdempotencyKey') || !knowledgeRoute.includes('requestFingerprint')) {
  failures.push('Knowledge search does not bind embedding spend to the API request identity')
}
if (!knowledgeRepository.includes('usageMeter.run') || !knowledgeRepository.includes('idempotencyKey')) {
  failures.push('Postgres knowledge search bypasses authoritative embedding metering')
}
if (
  !convexKnowledge.includes('markBudgetReservationStartedByServer') ||
  !convexKnowledge.includes('provider_operation_already_reserved')
) {
  failures.push('Convex knowledge providers do not enforce provider-start and replay lifecycle')
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'))
  process.exit(1)
}

console.log(`Owner-funded boundary check passed (${rules.length + 1} owner-funded operation routes).`)
