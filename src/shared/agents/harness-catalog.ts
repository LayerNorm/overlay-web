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

export type ManagedHarnessCatalogEntry = {
  id: ManagedHarnessId
  label: string
  description: string
  kind: ManagedHarnessKind
  /** Bridge/ACP adapters need one reachable sandbox port for their bridge. */
  requiresSandboxPort: boolean
}

export const MANAGED_HARNESS_CATALOG = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    description: "Anthropic's coding agent, running in an isolated Overlay Cloud sandbox.",
    kind: 'bridge',
    requiresSandboxPort: true,
  },
  {
    id: 'codex',
    label: 'Codex',
    description: "OpenAI's coding agent, running in an isolated Overlay Cloud sandbox.",
    kind: 'bridge',
    requiresSandboxPort: true,
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    description: 'Open-source coding agent, running in an isolated Overlay Cloud sandbox.',
    kind: 'bridge',
    requiresSandboxPort: true,
  },
  {
    id: 'pi',
    label: 'Pi',
    description: 'Pi coding agent; the agent loop runs on Overlay and the sandbox is its workspace.',
    kind: 'host',
    requiresSandboxPort: false,
  },
  {
    id: 'hermes',
    label: 'Hermes',
    description: 'Hermes through its official ACP server, running in an isolated Overlay Cloud sandbox.',
    kind: 'acp',
    requiresSandboxPort: true,
  },
] as const satisfies readonly ManagedHarnessCatalogEntry[]

export function managedHarnessEntry(id: string): ManagedHarnessCatalogEntry | undefined {
  return MANAGED_HARNESS_CATALOG.find((entry) => entry.id === id)
}

export function managedHarnessCatalogIsComplete(): boolean {
  return MANAGED_HARNESS_CATALOG.length === MANAGED_HARNESS_IDS.length
    && MANAGED_HARNESS_IDS.every(
      (id) => MANAGED_HARNESS_CATALOG.some((entry) => entry.id === id),
    )
}
