import { windowManager } from '../window-manager'
import { showNotification } from '../../ipc/notification-ipc'
import { settingsService } from '../settings-service'
import { AVAILABLE_MODELS } from '../chat-service'
import { subscriptionService } from '../subscription-service'
import { runUnifiedVoiceAgent } from './unified-voice-agent'
import { isFreeModel as isOpenRouterFreeModel } from '../ai/gateway-provider'
import { AgentTaskSecuritySession } from '../security/agent-policy/agent-task-security-session'

// Get the provider for a model from AVAILABLE_MODELS
function getModelProvider(modelId: string): string {
  const modelInfo = AVAILABLE_MODELS.find((m) => m.id === modelId)
  return modelInfo?.provider || 'openrouter'
}

class AgentService {
  async run(command: string): Promise<void> {
    console.log('═══════════════════════════════════════════════════════════')
    console.log('[AgentService] Starting agent execution')
    console.log('[AgentService] Command:', command)
    console.log('═══════════════════════════════════════════════════════════')

    windowManager.broadcastToAllWindows('agent:start', { command })

    // Get configured model from settings
    const modelId = settingsService.agentModel || 'openrouter/free'

    // Check credits before running premium models
    const isFreeModel = isOpenRouterFreeModel(modelId)
    if (!isFreeModel) {
      const canPerform = subscriptionService.canPerformAction('agent', modelId)
      if (!canPerform.allowed) {
        const errorMsg =
          canPerform.reason === 'insufficient_credits'
            ? 'Insufficient credits. Please upgrade your subscription or switch to a free model.'
            : 'Usage limit reached. Please try again later or upgrade your subscription.'

        console.log('[AgentService] Credit check failed:', canPerform.reason)
        windowManager.broadcastToAllWindows('agent:error', { error: errorMsg })

        await showNotification({
          id: `agent-${Date.now()}`,
          type: 'error',
          title: 'Agent Blocked',
          summary: errorMsg,
          trace: []
        })
        return
      }
    }

    // Determine routing based on provider from AVAILABLE_MODELS
    const provider = getModelProvider(modelId)

    console.log('[AgentService] ┌─ Model Configuration ─────────────────────')
    console.log('[AgentService] │ Configured model ID:', modelId)
    console.log('[AgentService] │ Settings agentModel:', settingsService.agentModel)
    console.log('[AgentService] │ Provider:', provider)
    console.log('[AgentService] │ Is free model:', isFreeModel)
    console.log('[AgentService] └───────────────────────────────────────────')

    const securityTask = new AgentTaskSecuritySession()
    try {
      // Always use unified voice agent (Phase 6 cleanup - old agents removed)
      const agentType = 'Unified Voice Gateway'
      console.log(`[AgentService] Using unified Voice Gateway agent`)
      const unifiedResult = await runUnifiedVoiceAgent(
        command,
        securityTask.taskId,
        modelId,
        (toolName, input) => {
          windowManager.broadcastToAllWindows('agent:tool', { tool: toolName, input })
        }
      )
      // Usage is already recorded by unified-voice-agent with actual token counts
      const { summary, steps, usage } = unifiedResult

      console.log('[AgentService] ┌─ Execution Complete ──────────────────────')
      console.log(`[AgentService] │ Agent type: ${agentType}`)
      console.log(`[AgentService] │ Model used: ${modelId}`)
      console.log(`[AgentService] │ Steps taken: ${steps}`)
      console.log(`[AgentService] │ Tokens: ${usage.inputTokens} in, ${usage.outputTokens} out`)
      console.log(`[AgentService] │ Summary: ${summary.slice(0, 100)}...`)
      console.log('[AgentService] └───────────────────────────────────────────')
      windowManager.broadcastToAllWindows('agent:done', { summary, steps })

      // Show notification
      await showNotification({
        id: `agent-${Date.now()}`,
        type: 'success',
        title: 'Agent Complete',
        summary: summary || 'Task completed successfully',
        trace: [`Completed in ${steps} step(s)`]
      })
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      console.error('[Agent] Error:', error)
      windowManager.broadcastToAllWindows('agent:error', { error })

      // Show error notification
      await showNotification({
        id: `agent-${Date.now()}`,
        type: 'error',
        title: 'Agent Failed',
        summary: error,
        trace: []
      })
    } finally {
      await securityTask.finish()
    }
  }
}

export const agentService = new AgentService()
