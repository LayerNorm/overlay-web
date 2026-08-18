import { useState } from 'react'
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react'

export interface MemoryItem {
  id: string
  content: string
  type: 'preference' | 'fact' | 'project' | 'decision'
  importance: number
}

interface MemoryIndicatorProps {
  variant: 'retrieved' | 'added'
  memories: MemoryItem[]
  theme: {
    text: string
    textSecondary: string
    border: string
    dropdownBg: string
  }
  onDeleteMemory?: (id: string) => void
}

const TYPE_COLORS: Record<string, string> = {
  preference: 'rgba(150, 150, 150, 0.8)',
  fact: 'rgba(150, 150, 150, 0.8)',
  project: 'rgba(150, 150, 150, 0.8)',
  decision: 'rgba(150, 150, 150, 0.8)'
}

const TYPE_LABELS: Record<string, string> = {
  preference: 'Preference',
  fact: 'Fact',
  project: 'Project',
  decision: 'Decision'
}

export function MemoryIndicator({
  variant,
  memories,
  theme,
  onDeleteMemory
}: MemoryIndicatorProps): React.ReactElement<any> | null {
  const [isExpanded, setIsExpanded] = useState(false)

  if (memories.length === 0) return null

  const isRetrieved = variant === 'retrieved'
  const label = isRetrieved ? 'Retrieved Context' : 'Added to Memory'

  return (
    <div
      style={{
        marginBottom: 8,
        borderRadius: 8,
        overflow: 'hidden'
      }}
    >
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: theme.text,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: 12,
          fontWeight: 500
        }}
      >
        <span style={{ color: theme.textSecondary }}>{label}</span>
        <span
          style={{
            background: 'rgba(128, 128, 128, 0.2)',
            color: theme.textSecondary,
            padding: '2px 6px',
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 600
          }}
        >
          {memories.length}
        </span>
        <div style={{ flex: 1 }} />
        {isExpanded ? (
          <ChevronUp size={14} style={{ color: theme.textSecondary }} />
        ) : (
          <ChevronDown size={14} style={{ color: theme.textSecondary }} />
        )}
      </button>

      {isExpanded && (
        <div
          style={{
            padding: '0 12px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6
          }}
        >
          {memories.map((memory) => (
            <div
              key={memory.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '8px 10px',
                background: 'rgba(255, 255, 255, 0.03)',
                borderRadius: 6,
                borderLeft: `3px solid ${TYPE_COLORS[memory.type] || theme.textSecondary}`
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    marginBottom: 4
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      color: TYPE_COLORS[memory.type] || theme.textSecondary,
                      fontFamily: 'system-ui, -apple-system, sans-serif'
                    }}
                  >
                    {TYPE_LABELS[memory.type] || memory.type}
                  </span>
                </div>
                <p
                  style={{
                    margin: 0,
                    fontSize: 12,
                    lineHeight: 1.5,
                    color: theme.text,
                    wordBreak: 'break-word',
                    fontFamily: 'system-ui, -apple-system, sans-serif'
                  }}
                >
                  {memory.content}
                </p>
              </div>
              {onDeleteMemory && variant === 'added' && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteMemory(memory.id)
                  }}
                  style={{
                    padding: 4,
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    borderRadius: 4,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: 0.5,
                    transition: 'opacity 0.15s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = '1'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = '0.5'
                  }}
                  title="Delete this memory"
                >
                  <Trash2 size={12} style={{ color: '#EF4444' }} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
