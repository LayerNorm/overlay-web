import React from 'react'
import { useRouter } from 'expo-router'
import { OnboardingFlow } from '../components/onboarding/OnboardingFlow'
import { useAuth } from '../contexts/AuthContext'
import { useWorkspace } from '../contexts/WorkspaceContext'
import { finishOnboarding } from '../services/onboardingService'
import { listAgents } from '../services/agentsService'
import { openAgentThread } from '../services/shellService'

export default function OnboardingScreen(): React.ReactElement {
  const router = useRouter()
  const { user } = useAuth()
  const { activeWorkspaceId } = useWorkspace()

  // Finish in a conversation with the workspace's default Overlay agent; fall
  // back to the Agents tab when it cannot be opened.
  const handleFinish = () => {
    if (user?.id) void finishOnboarding(user.id)
    router.replace('/(tabs)/agents')
    if (!activeWorkspaceId) return
    void listAgents(activeWorkspaceId)
      .then(async ({ agents }) => {
        const overlay = agents.find((agent) => agent.isDefault)
        if (!overlay) return
        const thread = await openAgentThread(activeWorkspaceId, overlay.id)
        if (thread) router.push(`/dm/${thread.conversationId}` as never)
      })
      .catch(() => undefined)
  }

  return <OnboardingFlow onFinish={handleFinish} />
}
