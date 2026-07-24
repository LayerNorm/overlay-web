import { useState } from 'react'
import { X, Minus } from 'lucide-react'

export type PanelType = 'chat' | 'notebook' | 'transcription' | 'browser'

interface TrafficLightButtonsProps {
  panelType: PanelType
  onClose: () => void
  onMinimize: () => void
  onMaximize: () => void
  isMaximized?: boolean
}

export function TrafficLightButtons({
  onClose,
  onMinimize,
  onMaximize,
  isMaximized = false
}: TrafficLightButtonsProps): React.ReactElement {
  const [isHovered, setIsHovered] = useState(false)

  const buttonSize = 13
  const gap = 8

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={
        {
          display: 'flex',
          alignItems: 'center',
          gap,
          padding: '0 4px',
          WebkitAppRegion: 'no-drag'
        } as React.CSSProperties
      }
    >
      {/* Close Button - Red */}
      <button
        onClick={onClose}
        title="Close panel"
        style={{
          width: buttonSize,
          height: buttonSize,
          borderRadius: '50%',
          background: '#FF5F56',
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          padding: 0,
          transition: 'all 0.15s ease'
        }}
      >
        {isHovered && <X size={9} color="#4A0002" strokeWidth={2.5} style={{ opacity: 0.8 }} />}
      </button>

      {/* Minimize Button - Yellow */}
      <button
        onClick={onMinimize}
        title="Hide panel"
        style={{
          width: buttonSize,
          height: buttonSize,
          borderRadius: '50%',
          background: '#FFBD2E',
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          padding: 0,
          transition: 'all 0.15s ease'
        }}
      >
        {isHovered && <Minus size={9} color="#995700" strokeWidth={2.5} style={{ opacity: 0.8 }} />}
      </button>

      {/* Maximize/Restore Button - Green */}
      <button
        onClick={onMaximize}
        title={isMaximized ? 'Restore panel' : 'Maximize panel'}
        style={{
          width: buttonSize,
          height: buttonSize,
          borderRadius: '50%',
          background: '#27C93F',
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          padding: 0,
          transition: 'all 0.15s ease'
        }}
      >
        {isHovered &&
          (isMaximized ? (
            // Restore icon - two overlapping squares
            <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
              <path
                d="M3 1h5.5a.5.5 0 01.5.5V7M1 3h5.5a.5.5 0 01.5.5V9a.5.5 0 01-.5.5H1.5A.5.5 0 011 9V3.5A.5.5 0 011.5 3H1z"
                stroke="#006500"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.8"
              />
            </svg>
          ) : (
            // Maximize icon - diagonal arrow
            <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
              <path
                d="M1 9L9 1M9 1H4M9 1v5"
                stroke="#006500"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.8"
              />
            </svg>
          ))}
      </button>
    </div>
  )
}
