import { tint } from '@expo/ui/swift-ui/modifiers'
import { useTheme } from '../hooks/useTheme'

/**
 * Tint for native switches. The forms tint controls with the text colour,
 * which in dark mode is white, making an "on" switch white on white. Use the
 * text colour in light mode and a mid grey in dark so on and off stay
 * distinct while everything stays monochrome.
 */
export function useSwitchTint() {
  const { theme, isDark } = useTheme()
  return [tint(isDark ? '#8E8E93' : (theme.foreground as string))]
}
