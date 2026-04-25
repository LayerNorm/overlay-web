import React, { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useColorScheme } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { getTheme, type Theme } from '../constants/theme'

export type AppearanceMode = 'light' | 'dark' | 'auto'

interface ThemeContextType {
  theme: Theme
  isDark: boolean
  appearanceMode: AppearanceMode
  toggleTheme: () => void
  setDarkMode: (dark: boolean) => void
  setAppearanceMode: (mode: AppearanceMode) => Promise<void>
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)
const APPEARANCE_MODE_STORAGE_KEY = 'overlay-appearance-mode'

interface ThemeProviderProps {
  children: ReactNode
}

export function ThemeProvider({
  children,
}: ThemeProviderProps): React.ReactElement {
  const systemColorScheme = useColorScheme()
  const [appearanceMode, setAppearanceModeState] = useState<AppearanceMode>('auto')

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const stored = await AsyncStorage.getItem(APPEARANCE_MODE_STORAGE_KEY)
      if (!cancelled && (stored === 'light' || stored === 'dark' || stored === 'auto')) {
        setAppearanceModeState(stored)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const resolvedMode =
    appearanceMode === 'auto' ? (systemColorScheme === 'dark' ? 'dark' : 'light') : appearanceMode
  const isDark = resolvedMode === 'dark'
  const theme = useMemo(() => getTheme(isDark), [isDark])

  const toggleTheme = (): void => {
    void setAppearanceMode(isDark ? 'light' : 'dark')
  }

  const setDarkMode = (dark: boolean): void => {
    void setAppearanceMode(dark ? 'dark' : 'light')
  }

  const setAppearanceMode = async (mode: AppearanceMode): Promise<void> => {
    setAppearanceModeState(mode)
    await AsyncStorage.setItem(APPEARANCE_MODE_STORAGE_KEY, mode)
  }

  return (
    <ThemeContext.Provider
      value={{ theme, isDark, appearanceMode, toggleTheme, setDarkMode, setAppearanceMode }}
    >
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
