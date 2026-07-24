/**
 * ModelsSettings — the "Models" settings tab.
 *
 * Mirrors the web app's DefaultChatModelSetting + ModelCatalogSetting
 * (src/features/settings/components/), adapted for the desktop's inline-style
 * settings pattern. Two sections:
 *
 *  1. Default model row — a SettingsRow + <select> for the default chat model.
 *  2. Model catalog — searchable, scrollable list of all available models with
 *     enable/disable toggles, capability chips, and pricing metadata.
 *
 * Persistence flows through the overlayDesktopAppClient.settings.update()
 * (PATCH /api/v1/settings) so enabledChatModelIds / defaultActModelId are
 * stored server-side — the same store the ModelDropdown reads via bootstrap.
 */

import { useCallback, useMemo, useState } from 'react'
import { Bot, RefreshCw, ScanEye, Search, Sparkles } from 'lucide-react'
import { SettingsRow } from '../ui/SettingsRow'
import { Toggle } from '../ui/Toggle'
import { Theme } from '../../utils/theme'
import { useAppBootstrap } from '../../contexts/AppBootstrapContext'
import { useSubscription } from '../../hooks/useSubscription'
import { overlayDesktopAppClient } from '../../services/app-api-client'
import {
  CURATED_DEFAULT_CHAT_MODEL_IDS,
  resolveEnabledChatModelIds
} from '../../utils/enabledChatModels'

const HIDDEN_MODEL_IDS = new Set<string>([
  'grok-4-fast-reasoning',
  'llama-3.1-8b-instant',
  'meta-llama/llama-4-scout-17b-16e-instruct'
])

function formatPrice(value?: number): string {
  if (value === undefined) return 'Unpriced'
  if (value === 0) return 'Free'
  return `$${value < 0.01 ? value.toFixed(3) : value.toFixed(2)}/1M`
}

interface ModelsSettingsProps {
  theme: Theme
}

export function ModelsSettings({ theme }: ModelsSettingsProps): React.ReactElement {
  const { bootstrap, chatModels, refreshBootstrap } = useAppBootstrap()
  const subscription = useSubscription()
  void subscription

  const uiSettings = bootstrap?.uiSettings
  const enabledModelIds = useMemo(
    () => uiSettings?.enabledChatModelIds ?? [],
    [uiSettings?.enabledChatModelIds]
  )
  const defaultActModelId = uiSettings?.defaultActModelId
  const defaultAskModelIds = useMemo(
    () => uiSettings?.defaultAskModelIds ?? [],
    [uiSettings?.defaultAskModelIds]
  )

  const [query, setQuery] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Effective enabled IDs: use stored or fall back to curated defaults
  const effectiveEnabledIds = useMemo(
    () => resolveEnabledChatModelIds(enabledModelIds),
    [enabledModelIds]
  )

  // Models for the default-model <select>: only enabled, non-hidden, non-disabled
  const selectableModels = useMemo(
    () =>
      chatModels.filter(
        (m) => !HIDDEN_MODEL_IDS.has(m.id) && !m.disabled && effectiveEnabledIds.includes(m.id)
      ),
    [chatModels, effectiveEnabledIds]
  )

  // All visible models for the catalog list (exclude hidden)
  const catalogModels = useMemo(
    () => chatModels.filter((m) => !HIDDEN_MODEL_IDS.has(m.id)),
    [chatModels]
  )

  const filteredModels = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return catalogModels
    return catalogModels.filter((m) =>
      `${m.name} ${m.id} ${m.provider}`.toLowerCase().includes(normalized)
    )
  }, [catalogModels, query])

  const enabledSet = useMemo(() => new Set(effectiveEnabledIds), [effectiveEnabledIds])
  const curatedSet = useMemo(() => new Set(CURATED_DEFAULT_CHAT_MODEL_IDS), [])

  // Resolve the current default model ID
  const currentDefaultModelId = useMemo(() => {
    const resolved = defaultActModelId ?? defaultAskModelIds[0]
    if (resolved && selectableModels.some((m) => m.id === resolved)) return resolved
    return selectableModels[0]?.id ?? ''
  }, [defaultActModelId, defaultAskModelIds, selectableModels])

  // Persist settings to the server via the api-client
  const persistSettings = useCallback(
    async (patch: {
      enabledChatModelIds?: string[]
      defaultActModelId?: string
      defaultAskModelIds?: string[]
    }): Promise<void> => {
      setIsSaving(true)
      try {
        await overlayDesktopAppClient.settings.update(patch)
        await refreshBootstrap()
      } catch (error) {
        console.error('[ModelsSettings] Failed to persist settings:', error)
      } finally {
        setIsSaving(false)
      }
    },
    [refreshBootstrap]
  )

  const handleDefaultModelChange = useCallback(
    (modelId: string) => {
      void persistSettings({
        defaultActModelId: modelId,
        defaultAskModelIds: [modelId]
      })
    },
    [persistSettings]
  )

  const handleToggleModel = useCallback(
    (modelId: string) => {
      const next = new Set(effectiveEnabledIds)
      if (next.has(modelId)) {
        if (next.size === 1) return // don't disable the last enabled model
        next.delete(modelId)
      } else {
        next.add(modelId)
      }
      void persistSettings({ enabledChatModelIds: Array.from(next) })
    },
    [effectiveEnabledIds, persistSettings]
  )

  const handleResetDefaults = useCallback(() => {
    void persistSettings({ enabledChatModelIds: [...CURATED_DEFAULT_CHAT_MODEL_IDS] })
  }, [persistSettings])

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)
    try {
      await refreshBootstrap()
    } finally {
      setIsRefreshing(false)
    }
  }, [refreshBootstrap])

  const isDark = theme.isDark

  const borderColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
  const subtleBg = isDark ? '#1f1f22' : '#f4f4f5'
  const hoverBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'
  const chipBg = isDark ? '#27272a' : '#f0f0f0'
  const chipFg = theme.textSecondary

  return (
    <>
      {/* Default model row */}
      <SettingsRow
        title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Bot size={16} strokeWidth={1.8} color={theme.textSecondary} />
            Default model
          </span>
        }
        description="Used when you start a new chat. Existing chats keep the model they last used."
        theme={theme}
      >
        <select
          disabled={isSaving || selectableModels.length === 0}
          value={currentDefaultModelId}
          onChange={(e) => handleDefaultModelChange(e.target.value)}
          style={{
            minWidth: 176,
            maxWidth: '100%',
            borderRadius: 8,
            border: `1px solid ${borderColor}`,
            background: subtleBg,
            padding: '6px 12px',
            fontSize: 14,
            color: theme.text,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            outline: 'none',
            cursor: 'pointer',
            opacity: isSaving ? 0.6 : 1
          }}
        >
          {selectableModels.length === 0 && <option value="">No models available</option>}
          {selectableModels.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </select>
      </SettingsRow>

      {/* Model catalog */}
      <div style={{ marginTop: 32 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 12
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 600,
              color: theme.text,
              fontFamily: 'system-ui, -apple-system, sans-serif'
            }}
          >
            Model catalog
          </h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => void handleResetDefaults()}
              disabled={isSaving}
              style={{
                height: 32,
                borderRadius: 8,
                border: `1px solid ${borderColor}`,
                background: subtleBg,
                padding: '0 12px',
                fontSize: 12,
                color: theme.text,
                fontFamily: 'system-ui, -apple-system, sans-serif',
                cursor: isSaving ? 'wait' : 'pointer',
                opacity: isSaving ? 0.6 : 1
              }}
            >
              Reset defaults
            </button>
            <button
              type="button"
              aria-label="Refresh models"
              onClick={() => void handleRefresh()}
              disabled={isRefreshing}
              style={{
                width: 32,
                height: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 8,
                border: `1px solid ${borderColor}`,
                background: subtleBg,
                color: theme.textSecondary,
                cursor: isRefreshing ? 'wait' : 'pointer',
                opacity: isRefreshing ? 0.6 : 1
              }}
            >
              <RefreshCw
                size={15}
                style={{
                  animation: isRefreshing ? 'spin 0.8s linear infinite' : undefined
                }}
              />
            </button>
          </div>
        </div>

        {/* Search input */}
        <div style={{ position: 'relative', marginBottom: 12 }}>
          <Search
            size={15}
            color={theme.textSecondary}
            style={{
              position: 'absolute',
              left: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              pointerEvents: 'none'
            }}
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search models or providers"
            style={{
              width: '100%',
              height: 40,
              borderRadius: 8,
              border: `1px solid ${borderColor}`,
              background: subtleBg,
              paddingLeft: 36,
              paddingRight: 12,
              fontSize: 14,
              color: theme.text,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              outline: 'none',
              boxSizing: 'border-box'
            }}
          />
        </div>

        {/* Count summary */}
        <div
          style={{
            padding: '8px 16px',
            fontSize: 12,
            color: theme.textSecondary,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            borderBottom: `1px solid ${borderColor}`
          }}
        >
          {effectiveEnabledIds.length} enabled · {catalogModels.length} available models
        </div>

        {/* Scrollable model list */}
        <div
          style={{
            maxHeight: '34rem',
            overflowY: 'auto',
            borderBottom: `1px solid ${borderColor}`
          }}
        >
          {filteredModels.length === 0 && (
            <div
              style={{
                padding: '40px 16px',
                textAlign: 'center',
                fontSize: 14,
                color: theme.textSecondary,
                fontFamily: 'system-ui, -apple-system, sans-serif'
              }}
            >
              No models match your search.
            </div>
          )}
          {filteredModels.map((model) => {
            const hasPricing = typeof model.pricePer1mTokens === 'number'
            const isEnabled = enabledSet.has(model.id)
            const isLastEnabled = isEnabled && enabledSet.size === 1
            const isCurated = curatedSet.has(model.id)

            return (
              <div
                key={model.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  padding: '12px 16px',
                  borderBottom: `1px solid ${borderColor}`,
                  transition: 'background 0.1s ease',
                  opacity: hasPricing ? 1 : 0.55,
                  cursor: hasPricing ? 'default' : 'not-allowed'
                }}
                onMouseEnter={(e) => {
                  if (hasPricing) e.currentTarget.style.background = hoverBg
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                {/* Model info */}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 500,
                        color: theme.text,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontFamily: 'system-ui, -apple-system, sans-serif'
                      }}
                    >
                      {model.name}
                    </span>
                    {model.supportsVision && (
                      <span
                        title="Supports vision"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 16,
                          height: 16,
                          borderRadius: 4,
                          background: chipBg,
                          color: chipFg,
                          flexShrink: 0
                        }}
                      >
                        <ScanEye size={11} strokeWidth={1.6} />
                      </span>
                    )}
                    {model.supportsReasoning && (
                      <span
                        title="Supports reasoning"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 16,
                          height: 16,
                          borderRadius: 4,
                          background: chipBg,
                          color: chipFg,
                          flexShrink: 0
                        }}
                      >
                        <Sparkles size={11} strokeWidth={1.6} />
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      marginTop: 4,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12,
                      color: theme.textSecondary,
                      fontFamily: 'system-ui, -apple-system, sans-serif',
                      flexWrap: 'wrap'
                    }}
                  >
                    <span style={{ textTransform: 'capitalize' }}>{model.provider}</span>
                    <span>·</span>
                    {hasPricing ? (
                      <>
                        <span>{formatPrice(model.pricePer1mTokens)} in</span>
                        <span>·</span>
                        <span>{formatPrice(model.pricePer1mTokens)} out</span>
                      </>
                    ) : (
                      <span>Pricing unavailable</span>
                    )}
                    {isCurated && (
                      <>
                        <span>·</span>
                        <span>Default</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Toggle */}
                <Toggle
                  checked={isEnabled}
                  disabled={isSaving || !hasPricing || isLastEnabled}
                  onChange={() => handleToggleModel(model.id)}
                  theme={theme}
                />
              </div>
            )
          })}
        </div>
      </div>

      {/* Spin animation for refresh icon */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>
  )
}
