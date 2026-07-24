import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BrainCircuit, Check, ChevronDown, Image as ImageIcon, Lock } from 'lucide-react'
import { ChatModel } from './types'
import { PanelTheme } from '../../hooks/usePanelTheme'
import { useSubscription } from '../../hooks/useSubscription'
import { getModelsByIntelligence, isFreeTierModel } from '@overlay/llm-gateway'

export type ModelSelectionMode = 'single' | 'multiple'

const SELECTION_MODE_KEY = 'overlay-chat-model-selection-mode'
const MAX_MODELS = 4
const FONT = 'system-ui, -apple-system, sans-serif'

interface ModelDropdownProps {
  models: ChatModel[]
  selectedModels: ChatModel[]
  showDropdown: boolean
  setShowDropdown: (show: boolean) => void
  setSelectedModels: (models: ChatModel[]) => void
  dropdownRef: React.RefObject<HTMLDivElement>
  theme: PanelTheme
  // Context for recommendations
  hasDocuments?: boolean
  isAgentMode?: boolean
  // Multi-select mode (only in ask mode, not agent/write mode)
  allowMultiSelect?: boolean
  // Container ref for boundary detection (optional - uses viewport if not provided)
  containerRef?: React.RefObject<HTMLElement | null>
}

const HIDDEN_MODEL_IDS = new Set<string>([
  'grok-4-fast-reasoning',
  'llama-3.1-8b-instant',
  'meta-llama/llama-4-scout-17b-16e-instruct'
])

function readSelectionMode(): ModelSelectionMode {
  try {
    return localStorage.getItem(SELECTION_MODE_KEY) === 'multiple' ? 'multiple' : 'single'
  } catch {
    return 'single'
  }
}

// ── ModelBadges: fixed h-5 container — capability chips OR cost pill on hover ─
// Both states share the same h-5 wrapper so the row height never changes
// (root-cause fix for the desktop height jitter).
function ModelBadges({ model, isHovered }: { model: ChatModel; isHovered: boolean }): React.ReactElement {
  const cost = model.cost ?? 1
  if (isHovered) {
    return (
      <span className="flex h-5 shrink-0 items-center gap-1">
        <span
          className={`inline-flex h-5 items-center rounded-full px-1.5 text-[9px] font-semibold leading-none tracking-tight ${
            cost === 0 ? '' : 'bg-[var(--surface-subtle)] text-[var(--muted)]'
          }`}
          style={
            cost === 0
              ? { background: 'var(--chat-badge-free-bg, #22c55e20)', color: 'var(--chat-badge-free-fg, #16a34a)' }
              : undefined
          }
        >
          {cost === 0 ? 'Free' : '$'.repeat(cost)}
        </span>
      </span>
    )
  }

  return (
    <span className="flex h-5 shrink-0 items-center gap-1">
      {model.supportsVision && (
        <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-[var(--surface-subtle)] text-[var(--muted)]">
          <ImageIcon size={10} strokeWidth={1.75} />
        </span>
      )}
      {model.supportsReasoning && (
        <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-[var(--surface-subtle)] text-[var(--muted)]">
          <BrainCircuit size={10} strokeWidth={1.75} />
        </span>
      )}
    </span>
  )
}

// ── ModelQualitiesPanel: hover side-panel (web port) ───────────────────────────
function MetricRow({
  icon: Icon,
  label,
  value
}: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>
  label: string
  value: React.ReactNode
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
        <Icon size={11} strokeWidth={1.75} className="shrink-0 text-[var(--muted-light)]" />
        <span>{label}</span>
      </div>
      <span className="whitespace-nowrap text-[11px] font-medium tabular-nums text-[var(--foreground)]">
        {value}
      </span>
    </div>
  )
}

function ModelQualitiesPanel({ model }: { model: ChatModel | null | undefined }): React.ReactElement | null {
  if (!model) return null
  return (
    <div className="pointer-events-none flex flex-col gap-1">
      <MetricRow
        icon={BrainCircuit}
        label="Intelligence"
        value={Math.round(model.intelligence ?? 0)}
      />
      <MetricRow
        icon={({ size, className }) => (
          <span className={className} style={{ fontSize: size, lineHeight: 1 }}>
            $
          </span>
        )}
        label="Cost"
        value={model.cost === 0 ? 'Free' : `$${(model.pricePer1mTokens ?? model.cost ?? 0).toFixed(2)}/M`}
      />
      <MetricRow
        icon={({ size, className }) => (
          <span className={className} style={{ fontSize: size, lineHeight: 1 }}>
            ⚡
          </span>
        )}
        label="Speed"
        value={model.medianOutputTokensPerSecond ? `${Math.round(model.medianOutputTokensPerSecond)} t/s` : 'N/A'}
      />
    </div>
  )
}

export function ModelDropdown({
  models,
  selectedModels,
  showDropdown,
  setShowDropdown,
  setSelectedModels,
  dropdownRef,
  theme,
  hasDocuments = false,
  isAgentMode = false,
  allowMultiSelect = false,
  containerRef
}: ModelDropdownProps): React.ReactElement {
  void hasDocuments
  const [hoveredModelId, setHoveredModelId] = useState<string | null>(null)
  const [modelQualitiesPos, setModelQualitiesPos] = useState<{ x: number; y: number } | null>(null)
  const dropdownContentRef = useRef<HTMLDivElement>(null)
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({})
  const [selectionMode, setSelectionMode] = useState<ModelSelectionMode>(() =>
    allowMultiSelect ? readSelectionMode() : 'single'
  )
  const subscription = useSubscription()
  const isFreeTier = subscription.tier === 'free'

  const effectiveSelectionMode: ModelSelectionMode =
    allowMultiSelect && !isFreeTier ? selectionMode : 'single'

  // Parents already pass the enabled catalog. Re-filter only for agent-mode
  // compatibility; do not intersect again with enabledChatModelIds (that race
  // against bootstrap was collapsing the list to 1–2 built-in models).
  const visibleModels = useMemo(() => {
    const candidateModels = models.filter((m) => {
      if (HIDDEN_MODEL_IDS.has(m.id)) return false
      if (isAgentMode) {
        if (m.provider === 'anthropic') return true
        if (
          m.provider === 'groq' &&
          !m.id.includes('compound') &&
          m.id !== 'llama-3.3-70b-versatile'
        )
          return true
        if (m.provider === 'minimax') return true
        if (m.provider === 'openrouter') return true
        if (m.supportsReasoning) return true
        return false
      }
      return true
    })
    return getModelsByIntelligence(candidateModels, isFreeTier)
  }, [models, isAgentMode, isFreeTier])

  const resolveModel = useCallback(
    (modelId: string): ChatModel | undefined => visibleModels.find((m) => m.id === modelId),
    [visibleModels]
  )

  const changeSelectionMode = useCallback(
    (mode: ModelSelectionMode): void => {
      if (mode === 'multiple' && isFreeTier) return
      setSelectionMode(mode)
      try {
        localStorage.setItem(SELECTION_MODE_KEY, mode)
      } catch {
        // ignore storage failures
      }
      if (mode === 'single' && selectedModels.length > 1) {
        setSelectedModels(selectedModels.slice(0, 1))
      }
    },
    [isFreeTier, selectedModels, setSelectedModels]
  )

  const isSelected = (model: ChatModel): boolean => selectedModels.some((m) => m.id === model.id)

  const selectModel = (model: ChatModel): void => {
    if (model.disabled) return
    if (effectiveSelectionMode === 'multiple') {
      const currentlySelected = isSelected(model)
      if (currentlySelected) {
        if (selectedModels.length > 1) {
          setSelectedModels(selectedModels.filter((m) => m.id !== model.id))
        }
      } else if (selectedModels.length < MAX_MODELS) {
        setSelectedModels([...selectedModels, model])
      }
    } else {
      setSelectedModels([model])
      setShowDropdown(false)
    }
  }

  const getDisplayText = (): string => {
    if (selectedModels.length === 0) return 'Select model'
    if (selectedModels.length === 1) return selectedModels[0].name
    return `${selectedModels.length} models`
  }

  const handleHoveredModelChange = (
    modelId: string | null,
    position: { x: number; y: number } | null
  ): void => {
    setHoveredModelId(modelId)
    setModelQualitiesPos(position)
  }

  return (
    <div style={{ position: 'relative' }} ref={dropdownRef}>
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        title="Choose model"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          height: 28,
          padding: '0 10px',
          maxWidth: 208,
          background: theme.isDark ? '#1f1f22' : '#f4f4f5',
          border: 'none',
          borderRadius: 6,
          color: theme.textSecondary,
          fontSize: 12,
          lineHeight: 1,
          fontFamily: FONT,
          cursor: 'pointer',
          transition: 'background 0.1s ease'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = theme.isDark ? '#27272a' : '#e4e4e7'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = theme.isDark ? '#1f1f22' : '#f4f4f5'
        }}
      >
        <span
          style={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {getDisplayText()}
        </span>
        <ChevronDown size={11} color={theme.textMuted} style={{ flexShrink: 0 }} />
      </button>

      {showDropdown && (
        <DropdownPositioner
          dropdownRef={dropdownRef}
          containerRef={containerRef}
          contentRef={dropdownContentRef}
          onStyleChange={setDropdownStyle}
        >
          {/* ModelQualitiesPanel — fixed-position hover side panel (web parity) */}
          {hoveredModelId && modelQualitiesPos ? (
            <div
              aria-hidden
              className="pointer-events-none fixed z-[100] w-44 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 shadow-md"
              style={{
                left: modelQualitiesPos.x,
                top: modelQualitiesPos.y,
                transform: 'translate(calc(-100% - 8px), -50%)'
              }}
            >
              <ModelQualitiesPanel model={resolveModel(hoveredModelId)} />
            </div>
          ) : null}

          <div
            ref={dropdownContentRef}
            style={{
              position: 'absolute',
              minWidth: 220,
              maxWidth: 256,
              ...dropdownStyle,
              background: theme.isDark ? '#1c1c1e' : '#ffffff',
              border: `1px solid ${theme.isDark ? '#27272a' : '#e4e4e7'}`,
              borderRadius: 10,
              boxShadow: theme.isDark
                ? '0 8px 32px rgba(0,0,0,0.5)'
                : '0 8px 32px rgba(0,0,0,0.15)',
              zIndex: 500,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              padding: '4px 0'
            }}
            onMouseLeave={() => handleHoveredModelChange(null, null)}
          >
            <div style={{ maxHeight: 288, overflowY: 'auto' }}>
              {visibleModels.map((model, index, list) => {
                const selected = isSelected(model)
                const locked = Boolean(model.disabled)
                const atLimit =
                  effectiveSelectionMode === 'multiple' && !selected && selectedModels.length >= MAX_MODELS
                const disabled = locked || atLimit
                const hovered = hoveredModelId === model.id

                const isFreeModelRow = isFreeTierModel(model.id)
                const previous = list[index - 1]
                const previousIsFreeModelRow = previous ? isFreeTierModel(previous.id) : isFreeModelRow
                const showFreeTierGroupDivider = isFreeTier && !isFreeModelRow && previousIsFreeModelRow
                const showFreeGroupDivider = !isFreeTier && isFreeModelRow && !previousIsFreeModelRow
                const showDivider = index > 0 && (showFreeTierGroupDivider || showFreeGroupDivider)
                const dividerLabel = showFreeTierGroupDivider ? 'Premium' : 'Free'

                return (
                  <div key={model.id}>
                    {showDivider && (
                      <div
                        style={{
                          marginTop: 4,
                          borderTop: `1px solid ${theme.border}`,
                          padding: '8px 12px 4px',
                          fontSize: 9,
                          fontWeight: 500,
                          textTransform: 'uppercase',
                          letterSpacing: '0.08em',
                          color: theme.textMuted,
                          fontFamily: FONT
                        }}
                      >
                        {dividerLabel}
                      </div>
                    )}
                    <button
                      data-model-row={model.id}
                      onClick={() => !disabled && selectModel(model)}
                      disabled={disabled}
                      title={locked ? model.disabledReason : undefined}
                      onMouseEnter={(e) => {
                        const r = e.currentTarget.getBoundingClientRect()
                        handleHoveredModelChange(model.id, { x: r.left - 8, y: r.top + r.height / 2 })
                      }}
                      onMouseLeave={() => {
                        handleHoveredModelChange(null, null)
                      }}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        padding: '6px 12px',
                        background: 'transparent',
                        border: 'none',
                        color: selected ? theme.text : theme.textSecondary,
                        fontWeight: selected ? 500 : 400,
                        fontSize: 12,
                        fontFamily: FONT,
                        cursor: disabled ? 'not-allowed' : 'pointer',
                        textAlign: 'left',
                        opacity: disabled ? 0.4 : 1,
                        transition: 'background 0.1s ease'
                      }}
                    >
                      <span
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          minWidth: 0,
                          flex: 1
                        }}
                      >
                        {selected ? (
                          <Check size={10} style={{ flexShrink: 0 }} />
                        ) : (
                          <span style={{ display: 'inline-block', width: 10, flexShrink: 0 }} />
                        )}
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {model.name}
                        </span>
                        {locked && <Lock size={11} color={theme.textMuted} style={{ flexShrink: 0 }} />}
                      </span>
                      {/* Fixed h-5 badge container — swaps capability chips ↔ cost on hover
                          without changing row height (fixes the desktop jitter) */}
                      <ModelBadges model={model} isHovered={hovered} />
                    </button>
                  </div>
                )
              })}
            </div>

            {allowMultiSelect && (
              <div
                style={{
                  borderTop: `1px solid ${theme.border}`,
                  padding: '8px 8px 4px',
                  marginTop: 4
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 4,
                    borderRadius: 8,
                    background: theme.isDark ? '#1f1f22' : '#f4f4f5',
                    padding: 2
                  }}
                >
                  {(['single', 'multiple'] as const).map((mode) => {
                    const isActive = effectiveSelectionMode === mode
                    const modeDisabled = isFreeTier && mode === 'multiple'
                    return (
                      <button
                        key={mode}
                        onClick={() => changeSelectionMode(mode)}
                        disabled={modeDisabled}
                        title={
                          modeDisabled ? 'Upgrade to compare multiple models' : undefined
                        }
                        style={{
                          borderRadius: 6,
                          padding: '4px 8px',
                          fontSize: 11,
                          fontWeight: 500,
                          textTransform: 'capitalize',
                          fontFamily: FONT,
                          border: 'none',
                          background: isActive
                            ? theme.isDark
                              ? '#27272a'
                              : '#ffffff'
                            : 'transparent',
                          color: isActive ? theme.text : theme.textMuted,
                          boxShadow: isActive ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                          cursor: modeDisabled ? 'not-allowed' : 'pointer',
                          opacity: modeDisabled ? 0.4 : 1,
                          transition: 'all 0.15s ease'
                        }}
                      >
                        {mode}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </DropdownPositioner>
      )}
    </div>
  )
}

// Helper component that calculates and applies positioning to prevent overflow
function DropdownPositioner({
  dropdownRef,
  containerRef,
  contentRef,
  onStyleChange,
  children
}: {
  dropdownRef: React.RefObject<HTMLDivElement | null>
  containerRef?: React.RefObject<HTMLElement | null>
  contentRef: React.RefObject<HTMLDivElement | null>
  onStyleChange: (style: React.CSSProperties) => void
  children: React.ReactNode
}): React.ReactElement {
  useEffect(() => {
    const calculatePosition = (): void => {
      if (!dropdownRef.current || !contentRef.current) return

      const buttonRect = dropdownRef.current.getBoundingClientRect()

      // Get container bounds (or viewport if no container)
      let containerBounds: { left: number; right: number; top: number; bottom: number }
      if (containerRef?.current) {
        const containerRect = containerRef.current.getBoundingClientRect()
        containerBounds = {
          left: containerRect.left,
          right: containerRect.right,
          top: containerRect.top,
          bottom: containerRect.bottom
        }
      } else {
        containerBounds = {
          left: 0,
          right: window.innerWidth,
          top: 0,
          bottom: window.innerHeight
        }
      }

      const style: React.CSSProperties = {}
      const padding = 8 // Minimum padding from edges

      // Calculate available width in container and constrain dropdown width
      const containerWidth = containerBounds.right - containerBounds.left
      const maxAllowedWidth = containerWidth - padding * 2
      const idealWidth = 256
      const constrainedWidth = Math.min(idealWidth, maxAllowedWidth)

      // Set width constraint
      style.width = constrainedWidth
      style.minWidth = Math.min(180, constrainedWidth)
      style.maxWidth = constrainedWidth

      // Calculate available height
      const spaceAbove = buttonRect.top - containerBounds.top
      const spaceBelow = containerBounds.bottom - buttonRect.bottom
      const idealHeight = 380

      // Vertical positioning: prefer below the trigger (web parity), fall back
      // to above when there is not enough room underneath.
      if (spaceBelow >= idealHeight + padding) {
        style.top = '100%'
        style.marginTop = 6
        style.maxHeight = idealHeight
      } else if (spaceAbove >= idealHeight + padding) {
        style.bottom = '100%'
        style.marginBottom = 6
        style.maxHeight = idealHeight
      } else {
        // Neither has enough space - use whichever has more and constrain height
        if (spaceBelow >= spaceAbove) {
          style.top = '100%'
          style.marginTop = 6
          style.maxHeight = Math.max(spaceBelow - padding - 6, 150)
        } else {
          style.bottom = '100%'
          style.marginBottom = 6
          style.maxHeight = Math.max(spaceAbove - padding - 6, 150)
        }
      }

      // Horizontal positioning: prefer right-aligned to the trigger (web parity),
      // fall back to left-aligned when it would overflow the container.
      const buttonLeftInContainer = buttonRect.left - containerBounds.left
      const buttonRightInContainer = buttonRect.right - containerBounds.left

      const rightAlignedLeft = buttonRightInContainer - constrainedWidth
      if (rightAlignedLeft >= padding) {
        style.right = 0
      } else {
        const leftAlignedRight = buttonLeftInContainer + constrainedWidth
        if (leftAlignedRight <= containerWidth - padding) {
          style.left = 0
        } else {
          const wouldOverflowBy =
            buttonRect.left + constrainedWidth - (containerBounds.right - padding)
          if (wouldOverflowBy > 0) {
            const maxShiftLeft = buttonRect.left - containerBounds.left - padding
            const actualShift = Math.min(wouldOverflowBy, maxShiftLeft)
            style.left = -actualShift
          } else {
            style.left = 0
          }
        }
      }

      onStyleChange(style)
    }

    // Calculate immediately and on resize
    calculatePosition()

    // Use requestAnimationFrame to recalculate after render
    const rafId = requestAnimationFrame(calculatePosition)

    // Also recalculate on scroll (for when panels are scrollable)
    const handleScroll = (): void => {
      requestAnimationFrame(calculatePosition)
    }

    window.addEventListener('resize', calculatePosition)
    window.addEventListener('scroll', handleScroll, true)

    // Set up ResizeObserver for container size changes
    let resizeObserver: ResizeObserver | null = null
    if (containerRef?.current) {
      resizeObserver = new ResizeObserver(calculatePosition)
      resizeObserver.observe(containerRef.current)
    }

    return () => {
      window.removeEventListener('resize', calculatePosition)
      window.removeEventListener('scroll', handleScroll, true)
      cancelAnimationFrame(rafId)
      resizeObserver?.disconnect()
    }
  }, [dropdownRef, containerRef, contentRef, onStyleChange])

  return <>{children}</>
}
