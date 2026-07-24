import { ReactNode, CSSProperties, useState } from 'react'
import { Theme, lightTheme } from '../../utils/theme'

interface LiquidGlassButtonProps {
  onClick?: () => void
  children: ReactNode
  title?: string
  style?: CSSProperties
  theme?: Theme
  size?: 'small' | 'medium' | 'large'
  variant?: 'icon' | 'pill'
  active?: boolean
  disabled?: boolean
}

export function LiquidGlassButton({
  onClick,
  children,
  title,
  style,
  theme = lightTheme,
  size = 'medium',
  variant = 'icon',
  active = false,
  disabled = false
}: LiquidGlassButtonProps) {
  const [isHovered, setIsHovered] = useState(false)

  const isDark = theme.isDark

  const iconSizeStyles: Record<string, { width: string; height: string; borderRadius: string }> = {
    small: { width: '36px', height: '36px', borderRadius: '12px' },
    medium: { width: '44px', height: '44px', borderRadius: '16px' },
    large: { width: '52px', height: '52px', borderRadius: '20px' }
  }

  const pillSizeStyles: Record<
    string,
    { padding: string; borderRadius: string; fontSize: string }
  > = {
    small: { padding: '6px 14px', borderRadius: '10px', fontSize: '12px' },
    medium: { padding: '8px 20px', borderRadius: '12px', fontSize: '13px' },
    large: { padding: '10px 24px', borderRadius: '14px', fontSize: '14px' }
  }

  // Accent color for active state glow
  const accentColor = theme.accent || '#0a84ff'

  // Box shadows for different states
  const getBoxShadow = () => {
    if (disabled) {
      return 'none'
    }

    if (active) {
      // Active state - full liquid glass effect + accent glow ring
      if (isHovered) {
        return isDark
          ? `
            inset 2px 2px 5px rgba(255, 255, 255, 0.4),
            inset 0 0 24px rgba(255, 255, 255, 0.15),
            inset -2px -2px 5px rgba(0, 0, 0, 0.5),
            0 0 0 2px ${accentColor}50,
            0 0 24px ${accentColor}40,
            0 10px 28px rgba(0, 0, 0, 0.4)
          `
          : `
            inset 2px 2px 6px rgba(255, 255, 255, 1),
            inset 0 0 28px rgba(255, 255, 255, 0.7),
            inset -2px -2px 6px rgba(0, 0, 0, 0.15),
            0 0 0 2px ${accentColor}40,
            0 0 20px ${accentColor}30,
            0 12px 28px rgba(0, 0, 0, 0.18)
          `
      }
      // Active, not hovered - accent ring visible
      return isDark
        ? `
          inset 2px 2px 4px rgba(255, 255, 255, 0.3),
          inset 0 0 20px rgba(255, 255, 255, 0.1),
          inset -2px -2px 4px rgba(0, 0, 0, 0.45),
          0 0 0 2px ${accentColor}45,
          0 0 16px ${accentColor}30,
          0 8px 20px rgba(0, 0, 0, 0.35)
        `
        : `
          inset 2px 2px 5px rgba(255, 255, 255, 0.95),
          inset 0 0 24px rgba(255, 255, 255, 0.6),
          inset -2px -2px 5px rgba(0, 0, 0, 0.12),
          0 0 0 2px ${accentColor}35,
          0 0 14px ${accentColor}25,
          0 10px 24px rgba(0, 0, 0, 0.12)
        `
    }

    // Inactive state - subtle effect
    if (isHovered) {
      return isDark
        ? `
          inset 1.5px 1.5px 3px rgba(255, 255, 255, 0.25),
          inset 0 0 16px rgba(255, 255, 255, 0.08),
          inset -1.5px -1.5px 3px rgba(0, 0, 0, 0.4),
          0 6px 16px rgba(0, 0, 0, 0.3)
        `
        : `
          inset 2px 2px 4px rgba(255, 255, 255, 0.9),
          inset 0 0 20px rgba(255, 255, 255, 0.5),
          inset -2px -2px 4px rgba(0, 0, 0, 0.1),
          0 8px 20px rgba(0, 0, 0, 0.1)
        `
    }

    // Inactive, not hovered - very subtle
    return isDark
      ? `
        inset 1px 1px 2px rgba(255, 255, 255, 0.1),
        inset 0 0 8px rgba(255, 255, 255, 0.03),
        inset -1px -1px 2px rgba(0, 0, 0, 0.2),
        0 2px 8px rgba(0, 0, 0, 0.15)
      `
      : `
        inset 1px 1px 2px rgba(255, 255, 255, 0.5),
        inset 0 0 10px rgba(255, 255, 255, 0.2),
        inset -1px -1px 2px rgba(0, 0, 0, 0.05),
        0 4px 12px rgba(0, 0, 0, 0.05)
      `
  }

  // Background for different states - active gets subtle accent tint
  const getBackground = () => {
    if (disabled) {
      return isDark ? 'rgba(255, 255, 255, 0.02)' : 'rgba(255, 255, 255, 0.05)'
    }
    if (active) {
      // Subtle accent tint mixed with white for active state
      return isDark
        ? `linear-gradient(135deg, rgba(255, 255, 255, 0.12), rgba(10, 132, 255, 0.08))`
        : `linear-gradient(135deg, rgba(255, 255, 255, 0.35), rgba(10, 132, 255, 0.06))`
    }
    if (isHovered) {
      return isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.15)'
    }
    return isDark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(255, 255, 255, 0.08)'
  }

  // Border for different states - only visible on active
  const getBorder = () => {
    if (active) {
      return `1px solid ${isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.5)'}`
    }
    return '1px solid transparent'
  }

  // Scale: active buttons are slightly larger, hover adds more
  const getScale = () => {
    if (disabled) return 'scale(1)'
    if (active && isHovered) return 'scale(1.1)'
    if (active) return 'scale(1.05)'
    if (isHovered) return 'scale(1.05)'
    return 'scale(1)'
  }

  const baseStyles: CSSProperties = {
    position: 'relative',
    cursor: disabled ? 'not-allowed' : 'pointer',
    border: getBorder(),
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: getBackground(),
    backdropFilter: active || isHovered ? 'blur(12px)' : 'blur(6px)',
    WebkitBackdropFilter: active || isHovered ? 'blur(12px)' : 'blur(6px)',
    boxShadow: getBoxShadow(),
    transform: getScale(),
    transition:
      'transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease, border 0.2s ease, backdrop-filter 0.2s ease',
    overflow: 'hidden',
    opacity: disabled ? 0.5 : 1
  }

  const variantStyles: CSSProperties =
    variant === 'icon'
      ? iconSizeStyles[size]
      : {
          ...pillSizeStyles[size],
          width: 'auto',
          height: 'auto',
          fontWeight: 500,
          color: theme.text,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        }

  const buttonStyle: CSSProperties = {
    ...baseStyles,
    ...variantStyles,
    ...style
  }

  return (
    <button
      onClick={disabled ? undefined : onClick}
      title={title}
      style={buttonStyle}
      onMouseEnter={() => !disabled && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Content container with glow - accent glow for active state */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: variant === 'pill' ? '6px' : undefined,
          filter:
            active && !disabled
              ? `drop-shadow(0 0 8px ${accentColor}60)`
              : isHovered && !disabled
                ? `drop-shadow(0 0 4px ${isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.1)'})`
                : 'none',
          transition: 'filter 0.2s ease'
        }}
      >
        {children}
      </div>
    </button>
  )
}
