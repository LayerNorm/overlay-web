'use client'

import { useAgentRunLifecycle } from './useAgentRunLifecycle'
import { useLiveConversationSync } from './useLiveConversationSync'
import { nativeLegacyLifecycleArgs } from './native-personal-lifecycle'

type LiveSyncArgs = Parameters<typeof useLiveConversationSync>[0]

export function useChatExperienceLifecycle({
  nativePersonalEnabled,
  nativeLifecycle,
  nativeTurnActive,
  runConversationId,
  hasAuthenticatedUser,
  localStreamActive,
  ...liveSyncArgs
}: Omit<LiveSyncArgs, 'runActive' | 'shouldSyncMessages'> & {
  nativePersonalEnabled: boolean
  nativeLifecycle: ReturnType<typeof useAgentRunLifecycle>
  nativeTurnActive: boolean
  runConversationId: string | null
  hasAuthenticatedUser: boolean
  localStreamActive: boolean
}) {
  const legacyLifecycle = useAgentRunLifecycle({
    ...nativeLegacyLifecycleArgs(
      nativePersonalEnabled,
      runConversationId,
      hasAuthenticatedUser,
    ),
    localStreamActive: nativePersonalEnabled ? false : localStreamActive,
    convexAccessToken: nativePersonalEnabled ? null : liveSyncArgs.convexAccessToken,
    enableConvexLiveSync: nativePersonalEnabled ? false : liveSyncArgs.enableConvexLiveSync,
    userId: nativePersonalEnabled ? null : liveSyncArgs.authUserId,
  })
  const agentRunLifecycle = nativePersonalEnabled ? nativeLifecycle : legacyLifecycle
  const { liveQueryBridge } = useLiveConversationSync({
    ...liveSyncArgs,
    activeChatId: nativePersonalEnabled ? null : liveSyncArgs.activeChatId,
    runActive: agentRunLifecycle.active,
    shouldSyncMessages: agentRunLifecycle.shouldSyncMessages,
  })
  const isActiveLoading = nativePersonalEnabled
    ? nativeTurnActive
    : localStreamActive || agentRunLifecycle.active
  return { agentRunLifecycle, isActiveLoading, liveQueryBridge }
}
