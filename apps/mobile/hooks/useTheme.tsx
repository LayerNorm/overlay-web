import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { useColorScheme } from 'react-native'
import { Theme, lightTheme, darkTheme } from '../constants/theme'
import {
  DEFAULT_UI_SETTINGS,
  loadCachedUiSettings,
  updateUiSettings,
} from '../services/settingsService'

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

export function ThemeProvider({ children }: ThemeProviderProps): React.ReactElement {
  const systemColorScheme = useColorScheme()
  const [isDark, setIsDark] = useState(
    (DEFAULT_UI_SETTINGS.theme ?? (systemColorScheme === 'dark' ? 'dark' : 'light')) === 'dark',
  )

  useEffect(() => {
    let isMounted = true

    loadCachedUiSettings()
      .then((cached) => {
        if (!isMounted) return
        if (cached?.theme) {
          setIsDark(cached.theme === 'dark')
        } else {
          setIsDark(systemColorScheme === 'dark')
        }
      })
      .catch(() => {
        if (isMounted) {
          setIsDark(systemColorScheme === 'dark')
        }
      })

    return () => {
      isMounted = false
    }
  }, [systemColorScheme])

  const theme = isDark ? darkTheme : lightTheme

  const toggleTheme = (): void => {
    setIsDark((prev) => {
      const next = !prev
      void updateUiSettings({ theme: next ? 'dark' : 'light' }).catch(() => {})
      return next
    })
  }

  const setDarkMode = (dark: boolean): void => {
    setIsDark(dark)
    void updateUiSettings({ theme: dark ? 'dark' : 'light' }).catch(() => {})
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
