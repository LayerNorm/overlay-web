import { ReactElement } from 'react'
import { SubscriptionTier } from '../../contexts/SubscriptionContext'

interface TierBadgeProps {
  tier: SubscriptionTier
  size?: 'sm' | 'md'
}

const TIER_STYLES: Record<
  SubscriptionTier,
  { bg: string; bgDark: string; text: string; textDark: string; label: string }
> = {
  free: {
    bg: 'rgba(113, 113, 122, 0.15)',
    bgDark: 'rgba(161, 161, 170, 0.2)',
    text: '#52525b',
    textDark: '#a1a1aa',
    label: 'FREE'
  },
  pro: {
    bg: 'rgba(59, 130, 246, 0.15)',
    bgDark: 'rgba(59, 130, 246, 0.25)',
    text: '#2563eb',
    textDark: '#60a5fa',
    label: 'PRO'
  },
  max: {
    bg: 'rgba(147, 51, 234, 0.15)',
    bgDark: 'rgba(147, 51, 234, 0.25)',
    text: '#7c3aed',
    textDark: '#a78bfa',
    label: 'MAX'
  }
}

export function TierBadge({ tier, size = 'sm' }: TierBadgeProps): ReactElement<any> {
  const styles = TIER_STYLES[tier]
  const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches

  const fontSize = size === 'sm' ? 9 : 10
  const padding = size === 'sm' ? '2px 6px' : '3px 8px'

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding,
        borderRadius: 4,
        fontSize,
        fontWeight: 600,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        letterSpacing: '0.5px',
        textTransform: 'uppercase',
        background: isDark ? styles.bgDark : styles.bg,
        color: isDark ? styles.textDark : styles.text,
        lineHeight: 1,
        flexShrink: 0
      }}
    >
      {styles.label}
    </span>
  )
}
