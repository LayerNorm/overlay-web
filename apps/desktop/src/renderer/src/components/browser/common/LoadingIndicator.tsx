import { ReactElement } from 'react'
import { Theme } from '../types'

interface LoadingIndicatorProps {
  isLoading: boolean
  theme: Theme
}

export function LoadingIndicator({ isLoading, theme }: LoadingIndicatorProps): ReactElement<any> | null {
  if (!isLoading) return null

  return (
    <div
      style={{
        height: 2,
        background: `linear-gradient(90deg, ${theme.accent} 0%, ${theme.accent} 50%, transparent 50%)`,
        backgroundSize: '200% 100%',
        animation: 'loading 1s linear infinite'
      }}
    />
  )
}
