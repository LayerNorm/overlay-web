import { ReactElement } from 'react'
import { ArrowLeft, ArrowRight, RotateCw } from 'lucide-react'
import { Theme } from '../types'

interface NavigationButtonsProps {
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
  theme: Theme
  onGoBack: () => void
  onGoForward: () => void
  onReload: () => void
}

export function NavigationButtons({
  canGoBack,
  canGoForward,
  isLoading,
  theme,
  onGoBack,
  onGoForward,
  onReload
}: NavigationButtonsProps): ReactElement {
  return (
    <div style={{ display: 'flex', gap: 4, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <button
        onClick={onGoBack}
        disabled={!canGoBack}
        style={{
          width: 28,
          height: 28,
          borderRadius: 6,
          border: 'none',
          background: 'transparent',
          cursor: canGoBack ? 'pointer' : 'not-allowed',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: canGoBack ? 1 : 0.4
        }}
        title="Go back"
      >
        <ArrowLeft size={16} color={theme.text} />
      </button>
      <button
        onClick={onGoForward}
        disabled={!canGoForward}
        style={{
          width: 28,
          height: 28,
          borderRadius: 6,
          border: 'none',
          background: 'transparent',
          cursor: canGoForward ? 'pointer' : 'not-allowed',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: canGoForward ? 1 : 0.4
        }}
        title="Go forward"
      >
        <ArrowRight size={16} color={theme.text} />
      </button>
      <button
        onClick={onReload}
        style={{
          width: 28,
          height: 28,
          borderRadius: 6,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
        title={isLoading ? 'Stop' : 'Reload'}
      >
        {isLoading ? (
          <span style={{ display: 'flex', animation: 'nav-spin 0.8s linear infinite' }}>
            <RotateCw size={16} color={theme.text} />
          </span>
        ) : (
          <RotateCw size={16} color={theme.text} />
        )}
        {isLoading && (
          <style>{`@keyframes nav-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        )}
      </button>
    </div>
  )
}
