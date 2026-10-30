import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { desktopWebShellViolations } from './desktop-web-shell-boundary.mjs'

const rules = [
  ['src/server/app-api/v1/conversations/act/ActTurnOrchestrationService.ts', 'reserveForAttempt', 'markReservationStarted'],
  ['src/server/harness/model-dispatch.ts', 'reserveProviderBudget', 'markProviderBudgetStarted'],
  ['src/server/app-api/v1/conversations/act/extension-plan/route.ts', 'reserveProviderBudget', 'markProviderBudgetStarted'],
  ['src/server/app-api/v1/generate-title/route.ts', 'reserveForAttempt', 'markReservationStarted'],
  ['src/server/app-api/v1/generate-tab-group-label/route.ts', 'reserveProviderBudget', 'markProviderBudgetStarted'],
  ['src/server/app-api/v1/chat-suggestions/route.ts', 'generationUsagePolicy.reserve', 'generationUsagePolicy.markStarted'],
  ['src/server/app-api/v1/generate-image/route.ts', 'generationUsagePolicy.reserve', 'generationUsagePolicy.markStarted'],
  ['src/server/app-api/v1/generate-video/route.ts', 'generationUsagePolicy.reserve', 'generationUsagePolicy.markStarted'],
  ['src/server/app-api/v1/notebook-agent/route.ts', 'reserveProviderBudget', 'markProviderBudgetStarted'],
  ['src/server/app-api/v1/transcribe/route.ts', 'generationUsagePolicy.reserve', 'generationUsagePolicy.markStarted'],
]

const failures = []
for (const [file, reservationMarker, startMarker] of rules) {
  const source = readFileSync(file, 'utf8')
  if (!source.includes(reservationMarker)) failures.push(`${file}: missing ${reservationMarker}`)
  if (!source.includes(startMarker)) failures.push(`${file}: missing ${startMarker}`)
  if (!source.includes('workspaceId')) failures.push(`${file}: missing workspace payer context`)
}

const bff = readFileSync('src/app/api/v1/_utils/bff.ts', 'utf8')
if (
  !bff.includes('ownerFundedOperationRequiresIdempotencyKey') ||
  !bff.includes('idempotency_key_required')
) {
  failures.push('BFF does not fail closed when an owner-funded mutation omits Idempotency-Key')
}

// Convex owns background embeddings; retired Postgres and desktop billing
// implementations must not return alongside the authoritative server pipeline.
for (const retired of [
  'src/server/jobs/postgres-runtime.ts',
  'src/server/knowledge/PostgresKnowledgeSearchRepository.ts',
  'overlay-desktop/src/main/services/subscription-service.ts',
  'overlay-desktop/src/main/services/security/usage-tracking-service.ts',
]) {
  if (existsSync(retired)) failures.push(`${retired}: retired billing implementation returned`)
}
failures.push(...desktopWebShellViolations(process.cwd()))
function nativeSources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? nativeSources(path) : path.endsWith('.ts') ? [path] : []
  })
}
for (const path of nativeSources('overlay-desktop/src/main')) {
  if (readFileSync(path, 'utf8').includes('platform/usage:recordBatch'))
    failures.push(`${path}: desktop still writes client-calculated usage to the authoritative ledger`)
}

const knowledgeRoute = readFileSync('src/server/app-api/v1/knowledge/search/route.ts', 'utf8')
const knowledgeRepository = readFileSync('src/server/knowledge/ConvexKnowledgeSearchRepository.ts', 'utf8')
const convexKnowledge = readFileSync('convex/knowledge/knowledge.ts', 'utf8')
if (!knowledgeRoute.includes('requestIdempotencyKey') || !knowledgeRoute.includes('requestFingerprint')) {
  failures.push('Knowledge search does not bind embedding spend to the API request identity')
}
if (!knowledgeRepository.includes('resolveBillingPayer') || !knowledgeRepository.includes('billingAccountId') || !knowledgeRepository.includes('...providerBilling')) {
  failures.push('Convex knowledge search bypasses the workspace payer and provider billing context')
}
if (
  !convexKnowledge.includes('markBudgetReservationStartedByServer') ||
  !convexKnowledge.includes('provider_operation_already_reserved') ||
  !convexKnowledge.includes('reserveWorkspaceBudgetByServer')
) {
  failures.push('Convex knowledge providers do not enforce workspace reservation, provider-start, and replay lifecycle')
}

const workspaceAgent = readFileSync('src/server/agents/workspace-agent-invocation.ts', 'utf8')
if (!workspaceAgent.includes('programmaticSubjectId') || !workspaceAgent.includes('workspaceId')) {
  failures.push('Shared agent invocation does not resolve the workspace programmatic payer')
}

const automationWorkflowBilling = readFileSync('src/server/billing/automation-workflow-billing.ts', 'utf8')
if (!automationWorkflowBilling.includes('AUTOMATION_WORKFLOW_STEP_PROVIDER_COST_USD')) {
  failures.push('Automation Workflow step overhead is not metered')
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'))
  process.exit(1)
}

console.log(`Owner-funded boundary check passed (${rules.length + 1} owner-funded operation routes).`)
