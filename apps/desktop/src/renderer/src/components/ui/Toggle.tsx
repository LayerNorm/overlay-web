import { Theme, lightTheme } from '../../utils/theme'

interface ToggleProps {
  checked: boolean
  onChange: (val: boolean) => void
  theme?: Theme
  disabled?: boolean
}

export function Toggle({ checked, onChange, theme = lightTheme, disabled = false }: ToggleProps) {
  const trackWidth = 44
  const trackHeight = 24
  const thumbSize = 18
  const thumbPadding = 3
  const thumbLeft = checked ? trackWidth - thumbSize - thumbPadding : thumbPadding

  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      style={{
        width: `${trackWidth}px`,
        height: `${trackHeight}px`,
        borderRadius: `${trackHeight / 2}px`,
        border: `1.5px solid ${checked ? theme.toggleBgActive : theme.border}`,
        background: checked ? theme.toggleBgActive : theme.toggleBg,
        position: 'relative',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'background 0.2s ease, border-color 0.2s ease',
        padding: 0,
        outline: 'none',
        opacity: disabled ? 0.5 : 1
      }}
    >
      <div
        style={{
          width: `${thumbSize}px`,
          height: `${thumbSize}px`,
          borderRadius: '50%',
          background: theme.toggleThumb,
          position: 'absolute',
          top: '50%',
          transform: 'translateY(-50%)',
          left: `${thumbLeft}px`,
          transition: 'left 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.2)'
        }}
      />
    </button>
  )
}
