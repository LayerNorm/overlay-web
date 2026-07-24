import { ReactElement, useState } from 'react'

interface UsageBarProps {
  used: number
  total: number
  label?: string
  showPercentage?: boolean
  size?: 'sm' | 'md'
  isDark?: boolean
  // Whether to show the hover tooltip (default: false)
  showTooltip?: boolean
  // Optional reset time to display in tooltip (e.g., '3d 5h')
  resetTime?: string
}

// Per DESIGN.md: Black and white theme with solid colors only
// Use accent color (dark in light mode, light in dark mode) for the fill bar
function getBarColor(percentage: number, isDark: boolean): string {
  // Low usage warning states - keep subtle color hints
  if (percentage <= 20) {
    return isDark ? '#fafafa' : '#0a0a0a' // Full intensity for warning
  }
  // Normal state - use theme accent at slightly lower intensity
  return isDark ? '#a1a1aa' : '#71717a' // textSecondary for normal state
}

export function UsageBar({
  used,
  total,
  label,
  showPercentage = true,
  size = 'md',
  isDark = false,
  showTooltip = false,
  resetTime
}: UsageBarProps): ReactElement {
  const [isHovered, setIsHovered] = useState(false)

  const remaining = Math.max(0, total - used)
  const percentage = total > 0 ? (remaining / total) * 100 : 0
  const barColor = getBarColor(percentage, isDark)

  const barHeight = size === 'sm' ? 6 : 8
  const fontSize = size === 'sm' ? 11 : 12

  return (
    <div
      style={{ width: '100%', position: 'relative' }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {label && (
        <div
          style={{
            fontSize: 11,
            fontWeight: 500,
            color: isDark ? '#a1a1aa' : '#71717a',
            marginBottom: 6,
            fontFamily: 'system-ui, -apple-system, sans-serif'
          }}
        >
          {label}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            flex: 1,
            height: barHeight,
            borderRadius: barHeight / 2,
            background: isDark ? '#27272a' : '#e4e4e7',
            overflow: 'hidden'
          }}
        >
          <div
            style={{
              width: `${percentage}%`,
              height: '100%',
              borderRadius: barHeight / 2,
              background: barColor,
              transition: 'width 0.3s ease, background 0.3s ease'
            }}
          />
        </div>

        {showPercentage && (
          <span
            style={{
              fontSize,
              fontWeight: 500,
              fontFamily: 'ui-monospace, SFMono-Regular, SF Mono, Menlo, monospace',
              color: isDark ? '#d4d4d8' : '#3f3f46',
              minWidth: 36,
              textAlign: 'right'
            }}
          >
            {Math.round(percentage)}%
          </span>
        )}
      </div>

      {showTooltip && isHovered && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginBottom: 6,
            padding: '6px 10px',
            borderRadius: 6,
            background: isDark ? '#27272a' : '#18181b',
            color: '#fafafa',
            fontSize: 11,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
            zIndex: 100
          }}
        >
          Resets in {resetTime}
        </div>
      )}
    </div>
  )
}
