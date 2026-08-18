import { ReactElement, useState, useRef, useEffect, useMemo } from 'react'
import { SettingsRow } from '../ui/SettingsRow'
import { Toggle } from '../ui/Toggle'
import { Settings } from '../../hooks/useSettings'
import { Theme } from '../../utils/theme'
import { useSubscription } from '../../hooks/useSubscription'
import { Search, ArrowUp, Eye, Brain } from 'lucide-react'
import { ProviderIcon } from '../chat/ProviderIcon'
import { useAppBootstrap } from '../../contexts/AppBootstrapContext'
import { getModelsByIntelligence } from '@overlay/llm-gateway'

interface AgentSettingsProps {
  settings: Settings
  onUpdateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  theme: Theme
}

export function AgentSettings({
  settings,
  onUpdateSetting,
  theme
}: AgentSettingsProps): ReactElement<any> {
  const [showModelDialog, setShowModelDialog] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const subscription = useSubscription()
  const { chatModels } = useAppBootstrap()

  const isFreeTier = subscription.tier === 'free'
  const agentModels = useMemo(() => {
    const compatible = chatModels.filter((m) => {
      if (m.provider === 'anthropic') return true
      if (m.provider === 'openrouter') return true
      if (m.provider === 'minimax') return true
      if (
        m.provider === 'groq' &&
        !m.id.includes('compound') &&
        m.id !== 'llama-3.3-70b-versatile'
      ) {
        return true
      }
      if (m.supportsReasoning) return true
      return false
    })
    return getModelsByIntelligence(compatible, isFreeTier)
  }, [chatModels, isFreeTier])

  // Close dialog when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        setShowModelDialog(false)
      }
    }
    if (showModelDialog) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showModelDialog])

  // Get display name for current model
  const getModelDisplayName = (): string => {
    const model = agentModels.find((m) => m.id === settings.agentModel)
    return model?.name || settings.agentModel || 'Select Model'
  }

  // Filter models by search
  const filteredModels = agentModels.filter(
    (m) =>
      m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.provider.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleSelectModel = (modelId: string): void => {
    onUpdateSetting('agentModel', modelId)
    // Sync to main process
    void window.bridge?.updateAgentModel?.(modelId)
    setShowModelDialog(false)
    setSearchQuery('')
  }

  const isDark = theme.isDark

  // Track previous tier to detect upgrades (not just current state)
  const prevTierRef = useRef<string | null>(null)

  // Auto-update agent model ONLY when user upgrades from free to pro/max
  // This should not prevent users from manually selecting Auto afterwards
  useEffect(() => {
    const prevTier = prevTierRef.current
    const currentTier = subscription.tier

    // Only auto-switch if:
    // 1. We have a previous tier (not initial load)
    // 2. Previous tier was 'free'
    // 3. Current tier is NOT 'free' (upgraded)
    // 4. Current model is still the free default
    if (
      prevTier === 'free' &&
      currentTier !== 'free' &&
      settings.agentModel === 'openrouter/free'
    ) {
      console.log(
        '[AgentSettings] Tier upgraded from free to',
        currentTier,
        '- auto-switching to claude-haiku-4-5'
      )
      onUpdateSetting('agentModel', 'claude-haiku-4-5')
      void window.bridge?.updateAgentModel?.('claude-haiku-4-5')
    }

    // Update previous tier ref
    prevTierRef.current = currentTier
  }, [subscription.tier, settings.agentModel, onUpdateSetting])

  return (
    <>
      <div>
        <SettingsRow
          title="Enable Agent Mode"
          description="Allow AI agent to process voice commands with context"
          theme={theme}
        >
          <Toggle
            checked={settings.assistantModeEnabled}
            onChange={(val) => {
              onUpdateSetting('assistantModeEnabled', val)
              void window.bridge?.updateAssistantMode?.(val)
            }}
            theme={theme}
          />
        </SettingsRow>

        <SettingsRow
          title="Screenshot Context"
          description="Include screenshot for visual context"
          theme={theme}
        >
          <Toggle
            checked={settings.assistantScreenshotEnabled}
            onChange={(val) => {
              onUpdateSetting('assistantScreenshotEnabled', val)
              window.bridge.updateAssistantScreenshot(val)
            }}
            theme={theme}
          />
        </SettingsRow>

        <SettingsRow
          title="Overlay Wake Word"
          description="Say 'overlay, ...' to trigger the voice agent hands-free"
          theme={theme}
        >
          <Toggle
            checked={settings.agenticWakeWordEnabled}
            onChange={(val) => {
              onUpdateSetting('agenticWakeWordEnabled', val)
              window.bridge.updateAgenticWakeWord(val)
            }}
            theme={theme}
          />
        </SettingsRow>

        <SettingsRow
          title="Agent Model"
          description="Select AI model for agent responses"
          theme={theme}
        >
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowModelDialog(true)}
              style={{
                padding: '6px 14px',
                borderRadius: '8px',
                fontSize: '13px',
                fontFamily: 'system-ui, -apple-system, sans-serif',
                color: theme.text,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                transition: 'background 0.15s ease',
                textDecoration: 'underline',
                textDecorationThickness: '2px',
                textUnderlineOffset: '3px'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = theme.border
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
            >
              {getModelDisplayName()}
            </button>

            {/* Model Selection Dialog */}
            {showModelDialog && (
              <div
                ref={dialogRef}
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: 8,
                  width: 300,
                  background: isDark ? '#1c1c1e' : '#ffffff',
                  border: `1px solid ${isDark ? '#27272a' : '#e4e4e7'}`,
                  borderRadius: 12,
                  boxShadow: isDark ? '0 8px 32px rgba(0,0,0,0.5)' : '0 8px 32px rgba(0,0,0,0.15)',
                  zIndex: 1000,
                  overflow: 'hidden'
                }}
              >
                {/* Search bar */}
                <div style={{ padding: '10px 12px', borderBottom: `1px solid ${theme.border}` }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 10px',
                      background: isDark ? '#27272a' : '#f4f4f5',
                      borderRadius: 6
                    }}
                  >
                    <Search size={14} color={theme.textSecondary} />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search models..."
                      autoFocus
                      style={{
                        flex: 1,
                        background: 'transparent',
                        border: 'none',
                        outline: 'none',
                        fontSize: 13,
                        color: theme.text,
                        fontFamily: 'system-ui, -apple-system, sans-serif'
                      }}
                    />
                  </div>
                </div>

                {/* Models list */}
                <div style={{ maxHeight: 320, overflowY: 'auto', padding: '6px' }}>
                  {filteredModels.map((model) => {
                    const isSelected = settings.agentModel === model.id
                    const isPremium = model.cost !== 0
                    const isDisabledForFree = subscription.tier === 'free' && isPremium

                    return (
                      <button
                        key={model.id}
                        onClick={() => !isDisabledForFree && handleSelectModel(model.id)}
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          background: isSelected ? theme.selectionBg : 'transparent',
                          border: 'none',
                          borderRadius: 6,
                          color: isDisabledForFree ? theme.textSecondary : theme.text,
                          fontSize: 13,
                          fontFamily: 'system-ui, -apple-system, sans-serif',
                          cursor: isDisabledForFree ? 'not-allowed' : 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          textAlign: 'left',
                          transition: 'background 0.1s ease',
                          opacity: isDisabledForFree ? 0.5 : 1,
                          marginBottom: 2
                        }}
                        onMouseEnter={(e) => {
                          if (!isDisabledForFree) {
                            e.currentTarget.style.background = theme.buttonHover
                          }
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = isSelected
                            ? theme.selectionBg
                            : 'transparent'
                        }}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <ProviderIcon provider={model.provider} size={16} isSelected />
                          <span>{model.name}</span>
                          {isPremium && subscription.tier === 'free' && (
                            <span
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: '2px 5px',
                                background: isDark ? '#27272a' : '#e4e4e7',
                                borderRadius: 4
                              }}
                              title="Premium model - requires Pro or Max subscription"
                            >
                              <ArrowUp size={10} color="#eab308" strokeWidth={2.5} />
                            </span>
                          )}
                        </span>
                        {(model.supportsSearch || model.supportsVision || model.supportsReasoning) && (
                          <span
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              color: theme.textSecondary
                            }}
                          >
                            {model.supportsSearch && <Search size={12} />}
                            {model.supportsVision && <Eye size={12} />}
                            {model.supportsReasoning && <Brain size={12} />}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </SettingsRow>
      </div>
    </>
  )
}
