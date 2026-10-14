// These suites need an explicitly selected live service or installed agent.
// Keep mixed unit/live suites (for example redis-rate-limiter) in ordinary CI.
export const INTEGRATION_TESTS = new Set([
  'src/server/app-data/contracts/convex-automation-webhook-contract.test.ts',
  'src/server/app-data/contracts/convex-contract.test.ts',
  'src/server/app-data/contracts/convex-knowledge-characterization.test.ts',
  'src/server/app-data/contracts/convex-p7-provider-contract.test.ts',
  'src/server/app-data/contracts/convex-skills-mcp-contract.test.ts',
  'src/server/app-data/contracts/convex-workspace-billing-provider-contract.test.ts',
  'packages/overlay-sandbox-runtime/src/box.live.test.ts',
  'packages/overlay-sandbox-runtime/src/live-conformance.test.ts',
  'examples/customer-deployment/mirror/mirror.integration.test.mjs',
  'packages/overlay-agent-host/src/hermes-acp.integration.test.ts',
])

export const REACT_SERVER_TESTS = new Set([
  'src/server/ai/gateway/gateway-runtime.test.ts',
  'src/server/ai/gateway/openrouter-service.test.ts',
  'src/server/ai/gateway/tool-schema-compat.test.ts',
  'src/server/tools/tools/build.test.ts',
  'src/server/app-api/v1/conversations/act/tooling.test.ts',
])
