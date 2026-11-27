import { View, ViewProps } from 'react-native'
import { useTheme } from '../../hooks/useTheme'

interface ThemedViewProps extends ViewProps {
  variant?: 'background' | 'surface'
}

export function ThemedView({ style, variant = 'background', ...props }: ThemedViewProps) {
  const { theme } = useTheme()

  const getBackgroundColor = () => {
    switch (variant) {
      case 'surface':
        return theme.surface
      default:
        return theme.background
    }
  }

  return <View style={[{ backgroundColor: getBackgroundColor() }, style]} {...props} />
}
