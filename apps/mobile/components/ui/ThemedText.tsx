import { Text, TextProps } from 'react-native'
import { useTheme } from '../../hooks/useTheme'
import { fontSize } from '../../constants/theme'

interface ThemedTextProps extends TextProps {
  variant?: 'default' | 'secondary' | 'disabled' | 'display'
  size?: keyof typeof fontSize
}

export function ThemedText({ style, variant = 'default', size = 'md', ...props }: ThemedTextProps) {
  const { theme } = useTheme()

  const getColor = () => {
    switch (variant) {
      case 'secondary':
        return theme.textSecondary
      case 'disabled':
        return theme.textDisabled
      case 'display':
        return theme.text
      default:
        return theme.text
    }
  }

  const getFontFamily = () => {
    if (variant === 'display') {
      return theme.serifFontFamily
    }
    return undefined
  }

  return (
    <Text
      style={[
        {
          color: getColor(),
          fontSize: fontSize[size],
          fontFamily: getFontFamily()
        },
        style
      ]}
      {...props}
    />
  )
}
