import React, { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Appearance, useColorScheme } from 'react-native'
import type { ThemePresetId } from '@overlay/app-core'
import { getTheme, type Theme } from '../constants/theme'
import {
  DEFAULT_MOBILE_PREFERENCES,
  loadMobilePreferences,
  subscribeMobilePreferences,
  updateMobilePreferences,
  type AppearanceMode,
} from '../services/mobilePreferencesService'
import {
  DEFAULT_UI_SETTINGS,
  loadCachedUiSettings,
  subscribeUiSettings,
} from '../services/settingsService'

interface ThemeContextType {
  theme: Theme
  isDark: boolean
  appearanceMode: AppearanceMode
  toggleTheme: () => void
  setDarkMode: (dark: boolean) => void
  setAppearanceMode: (mode: AppearanceMode) => Promise<void>
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

interface ThemePresetState {
  lightThemePreset: ThemePresetId
  darkThemePreset: ThemePresetId
}

interface ThemeProviderProps {
  children: ReactNode
}

export function ThemeProvider({
  children,
}: ThemeProviderProps): React.ReactElement {
  const systemColorScheme = useColorScheme()
  const [appearanceMode, setAppearanceModeState] = useState<AppearanceMode>(
    DEFAULT_MOBILE_PREFERENCES.appearanceMode,
  )
  const [themePresets, setThemePresets] = useState<ThemePresetState>({
    lightThemePreset: DEFAULT_UI_SETTINGS.lightThemePreset,
    darkThemePreset: DEFAULT_UI_SETTINGS.darkThemePreset,
  })

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const stored = await loadMobilePreferences()
      if (!cancelled) setAppearanceModeState(stored.appearanceMode)
    })()

    const unsubscribe = subscribeMobilePreferences((preferences) => {
      setAppearanceModeState(preferences.appearanceMode)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const cached = await loadCachedUiSettings()
      if (!cancelled && cached) {
        setThemePresets({
          lightThemePreset: cached.lightThemePreset,
          darkThemePreset: cached.darkThemePreset,
        })
      }
    })()

    const unsubscribe = subscribeUiSettings((settings) => {
      setThemePresets({
        lightThemePreset: settings.lightThemePreset,
        darkThemePreset: settings.darkThemePreset,
      })
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const resolvedMode =
    appearanceMode === 'auto' ? (systemColorScheme === 'dark' ? 'dark' : 'light') : appearanceMode
  const isDark = resolvedMode === 'dark'
  // Keep UIKit (system menus, alerts, share sheets) on the same appearance as the app.
  useEffect(() => {
    Appearance.setColorScheme(appearanceMode === 'auto' ? 'unspecified' : appearanceMode)
  }, [appearanceMode])
  const activeThemePreset = isDark ? themePresets.darkThemePreset : themePresets.lightThemePreset
  const theme = useMemo(() => getTheme(isDark, activeThemePreset), [activeThemePreset, isDark])

  const toggleTheme = (): void => {
    void setAppearanceMode(isDark ? 'light' : 'dark')
  }

  const setDarkMode = (dark: boolean): void => {
    void setAppearanceMode(dark ? 'dark' : 'light')
  }

  const setAppearanceMode = async (mode: AppearanceMode): Promise<void> => {
    setAppearanceModeState(mode)
    await updateMobilePreferences({ appearanceMode: mode })
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
