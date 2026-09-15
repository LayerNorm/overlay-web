import 'server-only'

/**
 * Server-side registry resolving `ManagedHarnessId` → AI SDK harness adapter.
 *
 * This is the only module allowed to import `@ai-sdk/harness*` packages. The
 * adapters are loaded through `await import()` (never statically) so workflow
 * step bundles and route handlers that merely read metadata do not pull the
 * harness graph in at module scope — the same rule the Chat SDK AbortController
 * incident taught us. Call `loadHarnessAdapter` / `createManagedHarnessAgent`
 * from inside `'use step'` bodies or server actions.
 *
 * See `docs/plans/MANAGED_HARNESS_AGENTS_PLAN.md`.
 */
import type { HarnessV1 } from '@ai-sdk/harness'
import type {
  HarnessAgent,
  HarnessAgentSandboxConfig,
  HarnessAgentSettings,
} from '@ai-sdk/harness/agent'
import {
  isManagedHarnessId,
  type ManagedHarnessId,
} from '@overlay/workspace-contracts'
import { managedHarnessEntry } from '@/shared/agents/harness-catalog'

/** Port the in-sandbox bridge listens on; one exposed port per bridge session. */
export const MANAGED_HARNESS_BRIDGE_PORT = 4000

export type ManagedHarnessDescriptor = {
  id: ManagedHarnessId
  /** npm package providing the adapter — informational; loaded via `loadAdapter`. */
  packageName: string
  /** Sandbox port the bridge binds, for adapters that drive the harness over one. */
  bridgePort?: number
  /**
   * Env vars the sandboxed harness reads model credentials from. Phase 2 fills
   * these with credential placeholders and injects real values at the network
   * boundary via request transformations (`@ai-sdk/harness/utils`
   * `createCredentialRequestTransformation`). Empty for `host` adapters, whose
   * model calls never leave the Overlay server.
   */
  credentialEnv: readonly string[]
  /**
   * Model API origins the harness calls — drives the egress allowlist and the
   * request-transformation match rules.
   */
  modelApiHosts: readonly string[]
  loadAdapter: () => Promise<HarnessV1>
}

const MANAGED_HARNESS_DESCRIPTORS = {
  'claude-code': {
    id: 'claude-code',
    packageName: '@ai-sdk/harness-claude-code',
    bridgePort: MANAGED_HARNESS_BRIDGE_PORT,
    credentialEnv: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL'],
    modelApiHosts: ['api.anthropic.com'],
    loadAdapter: async () => (await import('@ai-sdk/harness-claude-code')).claudeCode,
  },
  codex: {
    id: 'codex',
    packageName: '@ai-sdk/harness-codex',
    bridgePort: MANAGED_HARNESS_BRIDGE_PORT,
    credentialEnv: ['OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL'],
    modelApiHosts: ['api.openai.com', 'chatgpt.com'],
    loadAdapter: async () => (await import('@ai-sdk/harness-codex')).codex,
  },
  opencode: {
    id: 'opencode',
    packageName: '@ai-sdk/harness-opencode',
    bridgePort: MANAGED_HARNESS_BRIDGE_PORT,
    credentialEnv: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENCODE_CONFIG'],
    modelApiHosts: ['api.anthropic.com', 'api.openai.com', 'opencode.ai'],
    loadAdapter: async () => (await import('@ai-sdk/harness-opencode')).openCode,
  },
  pi: {
    id: 'pi',
    packageName: '@ai-sdk/harness-pi',
    credentialEnv: [],
    modelApiHosts: [],
    loadAdapter: async () => (await import('@ai-sdk/harness-pi')).pi,
  },
  hermes: {
    id: 'hermes',
    packageName: '@ai-sdk/harness-acp',
    bridgePort: MANAGED_HARNESS_BRIDGE_PORT,
    credentialEnv: ['OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY'],
    modelApiHosts: ['openrouter.ai', 'api.anthropic.com'],
    loadAdapter: async () => {
      const { createACP } = await import('@ai-sdk/harness-acp')
      return createACP({
        harnessId: 'hermes',
        source: {
          type: 'npm-simple',
          packageName: 'hermes-agent',
          packageVersion: '0.21.3',
        },
        executable: 'hermes',
        args: ['acp'],
        modelMapping: { type: 'session-model', path: 'modelId' },
      })
    },
  },
} as const satisfies Record<ManagedHarnessId, ManagedHarnessDescriptor>

export function managedHarnessDescriptor(id: ManagedHarnessId): ManagedHarnessDescriptor {
  const descriptor = MANAGED_HARNESS_DESCRIPTORS[id]
  if (!descriptor) {
    throw new Error(`No managed harness descriptor for '${id}'`)
  }
  return descriptor
}

export function listManagedHarnessDescriptors(): readonly ManagedHarnessDescriptor[] {
  return Object.values(MANAGED_HARNESS_DESCRIPTORS)
}

/**
 * Loads the adapter for a managed harness. Call inside `'use step'` bodies —
 * the dynamic import keeps adapter code out of workflow bundles and page
 * chunks that only read descriptors.
 */
export async function loadHarnessAdapter(id: ManagedHarnessId): Promise<HarnessV1> {
  const adapter = await managedHarnessDescriptor(id).loadAdapter()
  if (adapter.specificationVersion !== 'harness-v1') {
    throw new Error(
      `Managed harness '${id}' returned specificationVersion '${adapter.specificationVersion}', expected 'harness-v1'`,
    )
  }
  return adapter
}

/**
 * Constructs a `HarnessAgent` for a managed harness. `HarnessAgent` itself is
 * dynamically imported so this module stays safe to import anywhere.
 */
export async function createManagedHarnessAgent(args: {
  harnessId: ManagedHarnessId
  sandbox?: HarnessAgentSettings['sandbox']
  sandboxConfig?: HarnessAgentSandboxConfig
  model?: HarnessAgentSettings['model']
  instructions?: HarnessAgentSettings['instructions']
  tools?: HarnessAgentSettings['tools']
}): Promise<HarnessAgent> {
  const entry = managedHarnessEntry(args.harnessId)
  if (!entry || !isManagedHarnessId(args.harnessId)) {
    throw new Error(`Unknown managed harness '${args.harnessId}'`)
  }
  const [{ HarnessAgent: HarnessAgentClass }, harness] = await Promise.all([
    import('@ai-sdk/harness/agent'),
    loadHarnessAdapter(args.harnessId),
  ])
  return new HarnessAgentClass({
    harness,
    sandbox: args.sandbox,
    sandboxConfig: args.sandboxConfig,
    model: args.model,
    instructions: args.instructions,
    tools: args.tools,
  })
}
