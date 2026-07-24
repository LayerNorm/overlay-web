import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const unifiedToolsPath = 'src/main/services/agent/unified-tools.ts'
const registryPath = 'src/main/services/security/agent-policy/tool-registry.ts'
const infrastructurePath = 'src/main/services/security/agent-policy/agent-infrastructure.ts'
const secureToolsPath = 'src/main/services/security/agent-policy/secure-agent-tools.ts'
const settingsIpcPath = 'src/main/ipc/settings-ipc.ts'
const agentIpcPath = 'src/main/ipc/agent-ipc.ts'
const unifiedTools = readFileSync(unifiedToolsPath, 'utf8')
const registry = readFileSync(registryPath, 'utf8')
const infrastructure = readFileSync(infrastructurePath, 'utf8')
const secureTools = readFileSync(secureToolsPath, 'utf8')
const settingsIpc = readFileSync(settingsIpcPath, 'utf8')
const agentIpc = readFileSync(agentIpcPath, 'utf8')

const staticToolNames = [...unifiedTools.matchAll(/\btools\.([A-Za-z0-9_]+)\s*=\s*tool\s*\(/g)].map(
  (match) => match[1]
)

assert.ok(staticToolNames.length > 0, 'No agent tools were discovered')
for (const toolName of staticToolNames) {
  assert.ok(
    registry.includes(`'${toolName}'`),
    `${toolName} is executable but missing from the agent tool registry`
  )
}

assert.match(
  unifiedTools,
  /assertEveryToolIsRegistered\(Object\.keys\(tools\)\)/,
  'Agent tools must fail closed against the runtime registry'
)
assert.match(
  unifiedTools,
  /return secureAgentToolSet\(tools,\s*\{[\s\S]*surface:\s*options\.surface,[\s\S]*taskId:\s*options\.securityTaskId[\s\S]*\}\)/,
  'Every executable agent tool set must pass through the deterministic policy wrapper'
)
assert.doesNotMatch(
  unifiedTools,
  /shouldEnableRemoteComposioTools|lower\.includes\(\s*['"]remote (?:workbench|bash)['"]\s*\)/,
  'Prompt or command keywords must never enable remote Composio execution'
)
assert.match(
  registry,
  /toolName\.startsWith\('COMPOSIO_'\)/,
  'Dynamic Composio tools must receive a default mutation classification'
)
assert.match(
  secureTools,
  /infrastructure:\s*agentInfrastructure\.readiness\(\)/,
  'Policy readiness must come from main-process provider instances'
)
assert.match(
  secureTools,
  /settingsService\.chatToolPermissionMode|permissionMode:\s*options\.permissionMode/,
  'Chat tool permission mode must be captured from main-process settings'
)
assert.match(
  unifiedTools,
  /taskId:\s*options\.securityTaskId/,
  'Agent approvals and providers must receive the main-generated task identity'
)
assert.doesNotMatch(
  secureTools,
  /process\.env|options\.(?:microvmReady|hostBrokerReady|agentBrowserReady)/,
  'Prompts, caller options, and environment variables must not enable privileged providers'
)
assert.match(
  infrastructure,
  /new DenyOnlyAgentIsolationProvider\(\)[\s\S]*new DenyOnlyHostCapabilityBroker\(\)[\s\S]*new EphemeralAgentBrowserProvider\(\)/,
  'Official runtime must deny future isolation/broker providers and use only the ephemeral task browser'
)
assert.match(
  infrastructure,
  /PermissionedDirectHostExecutionProvider[\s\S]*isolation\s*=\s*['"]none['"]/,
  'Deferred direct-host execution must remain explicitly labeled as unsandboxed'
)
assert.doesNotMatch(
  infrastructure,
  /(?:shell|applescript|scriptSource|command)\s*:/i,
  'The typed host broker must not accept arbitrary shell or script source'
)
assert.match(
  settingsIpc,
  /settings:set-chat-tool-permission[\s\S]*dialog\.showMessageBox[\s\S]*Enable Full access/,
  'Full access must require a trusted native confirmation'
)
assert.match(
  settingsIpc,
  /getTrustedIpcWindowRole\(event\.sender\)\s*!==\s*['"]main['"]/,
  'Only the trusted main Settings window may mutate chat tool permissions'
)
assert.doesNotMatch(
  agentIpc,
  /permissionMode|chatToolPermissionMode/,
  'Renderer agent requests must not choose or override the main-owned permission mode'
)

console.log(
  `Agent policy boundary check passed (${staticToolNames.length} statically declared tools).`
)
