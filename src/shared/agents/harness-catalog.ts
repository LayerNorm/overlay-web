/**
 * Catalog of agent harnesses Overlay Cloud can host in managed sandboxes via
 * the AI SDK HarnessAgent (`docs/plans/MANAGED_HARNESS_AGENTS_PLAN.md`).
 *
 * This module is isomorphic — the editor renders the picker from it and the
 * server resolves adapters from it — so it must stay free of Node builtins,
 * environment reads, and server-only imports.
 *
 * Kept deliberately separate from `BUILT_IN_USER_OWNED_ACP_ADAPTER_IDS`
 * (user-owned machines reached through the agent host) and
 * `OVERLAY_MANAGED_ACP_ADAPTER_IDS` (the agent-host managed path): a harness
 * appearing here says nothing about availability on those surfaces.
 */
import {
  MANAGED_HARNESS_IDS,
  type ManagedHarnessId,
} from '@overlay/workspace-contracts'

/**
 * How the adapter reaches the harness runtime. `bridge` and `acp` adapters
 * bootstrap the harness inside the sandbox and drive it over an exposed port;
 * `host` adapters run the agent loop on the Overlay server and treat the
 * sandbox as a plain workspace, so model credentials never enter the sandbox.
 */
export type ManagedHarnessKind = 'bridge' | 'acp' | 'host'

/**
 * One selectable model on a managed harness. `harnessModel` is the string the
 * harness runtime receives (absent means the harness's own default);
 * `billingModelId` is the real gateway model Overlay charges the turn's token
 * usage against — harness usage meters the provider's tokens, so the billing
 * id must price the same model family the harness actually runs.
 */
export type ManagedHarnessModelOption = {
  value: string
  label: string
  harnessModel?: string
  billingModelId: string
}

export type ManagedHarnessCatalogEntry = {
  id: ManagedHarnessId
  label: string
  description: string
  kind: ManagedHarnessKind
  /** Bridge/ACP adapters need one reachable sandbox port for their bridge. */
  requiresSandboxPort: boolean
  /**
   * BYOK provider ids whose connections can fund this harness — mirrors the
   * server registry's `byokAuth` mapping. Empty means Overlay-funded only.
   */
  byokProviders: readonly string[]
  /** Pickable models; the first entry is the default. */
  models: readonly ManagedHarnessModelOption[]
}

export const MANAGED_HARNESS_CATALOG = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    description: "Anthropic's coding agent, running in an isolated Overlay Cloud sandbox.",
    kind: 'bridge',
    requiresSandboxPort: true,
    byokProviders: ['user-vercel-ai-gateway'],
    // Ordered by quality like every other model picker — the first entry is
    // the default.
    models: [
      { value: 'opus', label: 'Claude Opus 4.7', harnessModel: 'opus', billingModelId: 'anthropic/claude-opus-4.7' },
      { value: 'sonnet', label: 'Claude Sonnet 4.6', harnessModel: 'sonnet', billingModelId: 'claude-sonnet-4-6' },
      { value: 'haiku', label: 'Claude Haiku 4.5', harnessModel: 'haiku', billingModelId: 'claude-haiku-4-5' },
    ],
  },
  {
    id: 'codex',
    label: 'Codex',
    description: "OpenAI's coding agent, running in an isolated Overlay Cloud sandbox.",
    kind: 'bridge',
    requiresSandboxPort: true,
    byokProviders: ['user-vercel-ai-gateway'],
    // The codex CLI owns model selection; usage bills against the GPT-5 tier.
    models: [{ value: 'default', label: 'Harness default', billingModelId: 'gpt-5.4' }],
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    description: 'Open-source coding agent, running in an isolated Overlay Cloud sandbox.',
    kind: 'bridge',
    requiresSandboxPort: true,
    byokProviders: ['user-vercel-ai-gateway'],
    models: [{ value: 'default', label: 'Harness default', billingModelId: 'claude-sonnet-4-6' }],
  },
  {
    id: 'pi',
    label: 'Pi',
    description: 'Pi coding agent; the agent loop runs on Overlay and the sandbox is its workspace.',
    kind: 'host',
    requiresSandboxPort: false,
    // Pi's loop runs host-side, so a customer gateway key never enters the sandbox.
    byokProviders: ['user-vercel-ai-gateway'],
    // Pi resolves its model through the configured gateway at run time.
    models: [{ value: 'default', label: 'Harness default', billingModelId: 'claude-sonnet-4-6' }],
  },
  {
    id: 'hermes',
    label: 'Hermes',
    description: 'Hermes through its official ACP server, running in an isolated Overlay Cloud sandbox.',
    kind: 'acp',
    requiresSandboxPort: true,
    byokProviders: ['openrouter'],
    models: [{ value: 'default', label: 'Harness default', billingModelId: 'claude-sonnet-4-6' }],
  },
] as const satisfies readonly ManagedHarnessCatalogEntry[]

export function managedHarnessEntry(id: string): ManagedHarnessCatalogEntry | undefined {
  return MANAGED_HARNESS_CATALOG.find((entry) => entry.id === id)
}

/** Resolves a picker's `value` to its catalog option; falls back to the entry's default. */
export function managedHarnessModelOption(
  harnessId: string,
  value?: string,
): ManagedHarnessModelOption | undefined {
  const models = managedHarnessEntry(harnessId)?.models
  if (!models?.length) return undefined
  return models.find((model) => model.value === value) ?? models[0]
}

export function managedHarnessCatalogIsComplete(): boolean {
  return MANAGED_HARNESS_CATALOG.length === MANAGED_HARNESS_IDS.length
    && MANAGED_HARNESS_IDS.every(
      (id) => MANAGED_HARNESS_CATALOG.some((entry) => entry.id === id),
    )
}
