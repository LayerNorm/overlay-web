import React, { createContext, useContext, type ReactNode } from 'react'
import { useColorScheme } from 'react-native'
import { DEFAULT_APP_SETTINGS } from '@overlay/app-core'
import { getTheme, type Theme } from '../constants/theme'

interface ThemeContextType {
  theme: Theme
  isDark: boolean
  toggleTheme: () => void
  setDarkMode: (dark: boolean) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

interface ThemeProviderProps {
  children: ReactNode
}

export function ThemeProvider({
  children,
}: ThemeProviderProps): React.ReactElement {
  const systemColorScheme = useColorScheme()
  const preference =
    DEFAULT_APP_SETTINGS.theme ??
    (systemColorScheme === 'dark' ? 'dark' : 'light')
  const isDark = preference === 'dark'
  const theme = getTheme(isDark)

  const toggleTheme = (): void => {
    void isDark
  }

  const setDarkMode = (dark: boolean): void => {
    void dark
  }

  return (
    <ThemeContext.Provider value={{ theme, isDark, toggleTheme, setDarkMode }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
