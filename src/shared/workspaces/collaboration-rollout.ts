import type { WorkspaceRolloutStage } from '@overlay/workspace-contracts'

/**
 * Tenant-allowlist rollout.
 *
 * A deployment declares how far the collaboration rollout has progressed, and
 * each workspace declares which stage it belongs to. A workspace participates
 * only when its stage has been reached, so internal dogfood comes first, then
 * invited workspaces, then everybody.
 */
const STAGE_ORDER: Record<WorkspaceRolloutStage, number> = {
  dogfood: 0,
  invited: 1,
  general: 2,
}

export const DEFAULT_DEPLOYMENT_ROLLOUT_STAGE: WorkspaceRolloutStage = 'general'

export function isRolloutStage(value: unknown): value is WorkspaceRolloutStage {
  return value === 'dogfood' || value === 'invited' || value === 'general'
}

/**
 * True when a workspace at `workspaceStage` should see collaboration features on
 * a deployment that has rolled out to `deploymentStage`.
 *
 * Earlier stages are always included: a dogfood workspace keeps its access as
 * the rollout widens, and a `general` workspace waits until general rollout.
 */
export function isWorkspaceInRollout(args: {
  deploymentStage: WorkspaceRolloutStage
  workspaceStage: WorkspaceRolloutStage
}): boolean {
  return STAGE_ORDER[args.workspaceStage] <= STAGE_ORDER[args.deploymentStage]
}

export function parseDeploymentRolloutStage(value: unknown): WorkspaceRolloutStage {
  return isRolloutStage(value) ? value : DEFAULT_DEPLOYMENT_ROLLOUT_STAGE
}

export function describeRolloutStage(stage: WorkspaceRolloutStage): string {
  if (stage === 'dogfood') return 'Internal dogfood only'
  if (stage === 'invited') return 'Invited workspaces'
  return 'Generally available'
}
