import { ReactNode, CSSProperties, useState } from 'react'
import { Theme, lightTheme } from '../../utils/theme'

interface GlassCardProps {
  children: ReactNode
  theme?: Theme
  variant?: 'default' | 'elevated' | 'inset'
  hover?: boolean // Enable hover glass effect
  padding?: string
  borderRadius?: string
  style?: CSSProperties
  onClick?: () => void
}

export function GlassCard({
  children,
  theme = lightTheme,
  variant = 'default',
  hover = false,
  padding = '16px',
  borderRadius = '14px',
  style,
  onClick
}: GlassCardProps) {
  const [isHovered, setIsHovered] = useState(false)

  const isDark = theme.isDark

  // Get background based on variant
  const getBackground = () => {
    const baseOpacity = isHovered && hover ? 1.3 : 1

    switch (variant) {
      case 'elevated':
        return isDark
          ? `rgba(255, 255, 255, ${0.08 * baseOpacity})`
          : `rgba(255, 255, 255, ${0.4 * baseOpacity})`
      case 'inset':
        return isDark
          ? `rgba(0, 0, 0, ${0.2 * baseOpacity})`
          : `rgba(0, 0, 0, ${0.03 * baseOpacity})`
      default:
        return isDark
          ? `rgba(255, 255, 255, ${0.05 * baseOpacity})`
          : `rgba(255, 255, 255, ${0.25 * baseOpacity})`
    }
  }

  // Get box shadow based on variant
  const getBoxShadow = () => {
    const hoverIntensity = isHovered && hover ? 1.3 : 1

    switch (variant) {
      case 'elevated':
        return isDark
          ? `
            inset 1.5px 1.5px 4px rgba(255, 255, 255, ${0.2 * hoverIntensity}),
            inset 0 0 16px rgba(255, 255, 255, ${0.06 * hoverIntensity}),
            inset -1.5px -1.5px 4px rgba(0, 0, 0, ${0.35 * hoverIntensity}),
            0 8px 24px rgba(0, 0, 0, ${0.4 * hoverIntensity})
          `
          : `
            inset 2px 2px 5px rgba(255, 255, 255, ${0.9 * hoverIntensity}),
            inset 0 0 20px rgba(255, 255, 255, ${0.5 * hoverIntensity}),
            inset -2px -2px 5px rgba(0, 0, 0, ${0.08 * hoverIntensity}),
            0 10px 30px rgba(0, 0, 0, ${0.12 * hoverIntensity})
          `
      case 'inset':
        return isDark
          ? `
            inset 2px 2px 6px rgba(0, 0, 0, ${0.4 * hoverIntensity}),
            inset -1px -1px 3px rgba(255, 255, 255, ${0.05 * hoverIntensity})
          `
          : `
            inset 2px 2px 6px rgba(0, 0, 0, ${0.06 * hoverIntensity}),
            inset -1px -1px 3px rgba(255, 255, 255, ${0.8 * hoverIntensity})
          `
      default:
        return isDark
          ? `
            inset 1px 1px 3px rgba(255, 255, 255, ${0.15 * hoverIntensity}),
            inset 0 0 12px rgba(255, 255, 255, ${0.04 * hoverIntensity}),
            inset -1px -1px 3px rgba(0, 0, 0, ${0.25 * hoverIntensity}),
            0 4px 16px rgba(0, 0, 0, ${0.25 * hoverIntensity})
          `
          : `
            inset 1.5px 1.5px 4px rgba(255, 255, 255, ${0.8 * hoverIntensity}),
            inset 0 0 16px rgba(255, 255, 255, ${0.4 * hoverIntensity}),
            inset -1.5px -1.5px 4px rgba(0, 0, 0, ${0.06 * hoverIntensity}),
            0 6px 20px rgba(0, 0, 0, ${0.08 * hoverIntensity})
          `
    }
  }

  // Get border based on variant
  const getBorder = () => {
    switch (variant) {
      case 'elevated':
        return isDark ? '1px solid rgba(255, 255, 255, 0.12)' : '1px solid rgba(255, 255, 255, 0.5)'
      case 'inset':
        return isDark ? '1px solid rgba(0, 0, 0, 0.2)' : '1px solid rgba(0, 0, 0, 0.04)'
      default:
        return isDark
          ? '1px solid rgba(255, 255, 255, 0.08)'
          : '1px solid rgba(255, 255, 255, 0.35)'
    }
  }

  const cardStyle: CSSProperties = {
    position: 'relative',
    padding,
    borderRadius,
    background: getBackground(),
    backdropFilter: isHovered && hover ? 'blur(16px)' : 'blur(12px)',
    WebkitBackdropFilter: isHovered && hover ? 'blur(16px)' : 'blur(12px)',
    border: getBorder(),
    boxShadow: getBoxShadow(),
    transition: 'all 0.25s ease',
    overflow: 'hidden',
    cursor: onClick ? 'pointer' : 'default',
    ...style
  }

  return (
    <div
      style={cardStyle}
      onClick={onClick}
      onMouseEnter={() => hover && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {children}
    </div>
  )
}
