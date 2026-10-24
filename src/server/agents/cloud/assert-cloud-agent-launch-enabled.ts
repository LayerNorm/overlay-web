import { getOverlayRuntimeConfig } from '@/server/config'
import { externalAgentLaunchEnabled } from '../external-agent-policy'
import { CloudAgentMachineError } from './CloudAgentMachineError'

export async function assertCloudAgentLaunchEnabled(
  workspaceId: string,
  launchEnabled?: (workspaceId: string) => boolean | Promise<boolean>,
): Promise<void> {
  const enabled = launchEnabled
    ? await launchEnabled(workspaceId)
    : await externalAgentLaunchEnabled(workspaceId)
      && (await getOverlayRuntimeConfig()).features.overlayCloudEnvironments === true
  if (!enabled) {
    throw new CloudAgentMachineError('External agent runtimes are disabled for this deployment.', 404, 'feature_disabled')
  }
}
