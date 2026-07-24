import { ReactNode } from 'react'
import { Theme, lightTheme } from '../../utils/theme'

interface SettingsRowProps {
  title: ReactNode
  description: string
  children: ReactNode
  theme?: Theme
}

export function SettingsRow({
  title,
  description,
  children,
  theme = lightTheme
}: SettingsRowProps): React.ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '16px 0',
        borderBottom: `1px solid ${theme.border}`
      }}
    >
      {/* Content */}
      <div>
        <div
          style={{
            fontSize: '14px',
            fontWeight: '500',
            color: theme.text,
            marginBottom: '6px',
            transition: 'color 0.2s ease'
          }}
        >
          {title}
        </div>
        <div style={{ fontSize: '12px', color: theme.textSecondary }}>{description}</div>
      </div>

      <div>{children}</div>
    </div>
  )
}
