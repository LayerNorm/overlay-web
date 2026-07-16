import { ON_PREM_PARITY_MATRIX } from '../src/server/app-data/parity-matrix.ts'
import { POSTGRES_APP_DATA_V1_CAPABILITIES } from '../src/server/app-data/capabilities.ts'
import { POSTGRES_APP_DATA_ROUTE_SUPPORT_RULES } from '../src/server/app-data/route-support.ts'

const routeRuleById = new Map(POSTGRES_APP_DATA_ROUTE_SUPPORT_RULES.map((rule) => [rule.id, rule]))

console.log('On-prem Postgres parity report')
console.log('')
console.log('Domain | Phase | Static gaps | Runtime-configured | Route state')
console.log('--- | --- | ---: | ---: | ---')

for (const domain of ON_PREM_PARITY_MATRIX) {
  const gaps = domain.capabilities.filter(({ key, expectedAtParity, runtimeConfigured }) =>
    !runtimeConfigured &&
    POSTGRES_APP_DATA_V1_CAPABILITIES[key] !== expectedAtParity)
  const runtimeConfigured = domain.capabilities.filter((target) => target.runtimeConfigured).length
  const routeStates = domain.routeRuleIds.reduce<Record<string, number>>((counts, ruleId) => {
    const status = routeRuleById.get(ruleId)?.status ?? 'unclassified'
    counts[status] = (counts[status] ?? 0) + 1
    return counts
  }, {})
  const routeSummary = Object.entries(routeStates)
    .map(([status, count]) => `${status}:${count}`)
    .join(', ') || 'n/a'
  console.log(`${domain.name} | ${domain.targetPhase} | ${gaps.length} | ${runtimeConfigured} | ${routeSummary}`)
}

const totalGaps = ON_PREM_PARITY_MATRIX.reduce((count, domain) =>
  count + domain.capabilities.filter(({ key, expectedAtParity, runtimeConfigured }) =>
    !runtimeConfigured &&
    POSTGRES_APP_DATA_V1_CAPABILITIES[key] !== expectedAtParity).length, 0)
const runtimeConfiguredTargets = ON_PREM_PARITY_MATRIX.reduce((count, domain) =>
  count + domain.capabilities.filter((target) => target.runtimeConfigured).length, 0)
const routeCounts = POSTGRES_APP_DATA_ROUTE_SUPPORT_RULES.reduce<Record<string, number>>((counts, rule) => {
  counts[rule.status] = (counts[rule.status] ?? 0) + 1
  return counts
}, {})

console.log('')
console.log(`Capability gaps: ${totalGaps}`)
console.log(`Runtime-configured capabilities: ${runtimeConfiguredTargets}`)
console.log(`Route rules: ${Object.entries(routeCounts).map(([status, count]) => `${status}=${count}`).join(', ')}`)
