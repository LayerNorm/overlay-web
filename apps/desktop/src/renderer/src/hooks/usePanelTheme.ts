import { useState, useEffect } from 'react'
import { getAppColorTheme } from '@overlay/app-core'
import {
  DEFAULT_DARK_THEME_PRESET,
  DEFAULT_LIGHT_THEME_PRESET,
  resolveThemePresetId,
  themeColorWithAlpha
} from '../utils/theme'

export interface PanelTheme {
  // Core backgrounds
  panelBg: string
  panelBgOpacity: (opacity: number) => string
  surfaceBg: string
  surfaceBgHover: string
  surfaceBgActive: string

  // Borders
  border: string
  borderHover: string
  borderActive: string

  // Text colors
  text: string
  textSecondary: string
  textMuted: string
  textDisabled: string

  // Button styles
  buttonBg: string
  buttonBgHover: string
  buttonBgActive: string
  buttonBorder: string

  // Input styles
  inputBg: string
  inputBorder: string
  inputBorderFocus: string
  inputPlaceholder: string

  // Message bubbles (chat)
  userBubbleBg: string
  assistantBubbleBg: string

  // Code blocks
  codeBg: string
  codeInlineBg: string
  codeBorder: string

  // Scrollbar
  scrollbarTrack: string
  scrollbarThumb: string
  scrollbarThumbHover: string

  // Sidebar
  sidebarBg: string
  sidebarItemHover: string
  sidebarItemActive: string

  // Accent colors
  accent: string
  accentHover: string

  // Drag overlay
  dragOverlayBg: string
  dragOverlayBorder: string
  dragOverlayText: string

  // Icon colors
  iconColor: string
  iconColorMuted: string

  // Dropdown
  dropdownBg: string
  dropdownItemHover: string

  // Markdown specific
  headingColor: string
  blockquoteBorder: string
  blockquoteText: string
  linkColor: string
  linkColorHover: string
  hrColor: string
  highlightBg: string

  // Table
  tableBorder: string
  tableHeaderBg: string
  tableCellBg: string

  // Math
  mathEditorBg: string
  mathEditorBorder: string
  mathEditorText: string

  // Task list
  taskCheckedText: string

  // Is dark mode
  isDark: boolean
}

export const darkPanelTheme: PanelTheme = {
  // Core backgrounds
  panelBg: 'rgba(19, 19, 19, 1)',
  panelBgOpacity: (opacity: number) => `rgba(19, 19, 19, ${opacity / 100})`,
  surfaceBg: 'rgba(255, 255, 255, 0.05)',
  surfaceBgHover: 'rgba(255, 255, 255, 0.1)',
  surfaceBgActive: 'rgba(255, 255, 255, 0.15)',

  // Borders
  border: 'rgba(255, 255, 255, 0.1)',
  borderHover: 'rgba(255, 255, 255, 0.15)',
  borderActive: 'rgba(255, 255, 255, 0.2)',

  // Text colors
  text: 'rgba(255, 255, 255, 0.9)',
  textSecondary: 'rgba(255, 255, 255, 0.7)',
  textMuted: 'rgba(255, 255, 255, 0.5)',
  textDisabled: 'rgba(255, 255, 255, 0.3)',

  // Button styles
  buttonBg: 'rgba(255, 255, 255, 0.05)',
  buttonBgHover: 'rgba(255, 255, 255, 0.1)',
  buttonBgActive: 'rgba(255, 255, 255, 0.15)',
  buttonBorder: 'rgba(255, 255, 255, 0.1)',

  // Input styles
  inputBg: 'rgba(255, 255, 255, 0.03)',
  inputBorder: 'rgba(255, 255, 255, 0.08)',
  inputBorderFocus: 'rgba(255, 255, 255, 0.2)',
  inputPlaceholder: 'rgba(255, 255, 255, 0.3)',

  // Message bubbles
  userBubbleBg: 'rgba(255, 255, 255, 0.1)',
  assistantBubbleBg: 'rgba(255, 255, 255, 0.05)',

  // Code blocks
  codeBg: 'rgba(20, 20, 20, 0.9)',
  codeInlineBg: 'rgba(255, 255, 255, 0.1)',
  codeBorder: 'rgba(255, 255, 255, 0.1)',

  // Scrollbar
  scrollbarTrack: 'transparent',
  scrollbarThumb: 'rgba(255, 255, 255, 0.2)',
  scrollbarThumbHover: 'rgba(255, 255, 255, 0.3)',

  // Sidebar
  sidebarBg: 'rgba(25, 25, 25, 0.98)',
  sidebarItemHover: 'rgba(255, 255, 255, 0.08)',
  sidebarItemActive: 'rgba(255, 255, 255, 0.12)',

  // Accent colors
  accent: '#0a84ff',
  accentHover: '#409cff',

  // Drag overlay
  dragOverlayBg: 'rgba(255, 255, 255, 0.05)',
  dragOverlayBorder: 'rgba(255, 255, 255, 0.4)',
  dragOverlayText: 'rgba(255, 255, 255, 0.9)',

  // Icon colors
  iconColor: 'rgba(255, 255, 255, 0.7)',
  iconColorMuted: 'rgba(255, 255, 255, 0.5)',

  // Dropdown
  dropdownBg: 'rgb(30, 30, 30)',
  dropdownItemHover: 'rgba(255, 255, 255, 0.08)',

  // Markdown specific
  headingColor: 'rgba(255, 255, 255, 0.95)',
  blockquoteBorder: 'rgba(255, 255, 255, 0.2)',
  blockquoteText: 'rgba(255, 255, 255, 0.7)',
  linkColor: '#60a5fa',
  linkColorHover: '#93c5fd',
  hrColor: 'rgba(255, 255, 255, 0.1)',
  highlightBg: 'rgba(255, 230, 0, 0.4)',

  // Table
  tableBorder: 'rgba(255, 255, 255, 0.1)',
  tableHeaderBg: 'rgba(255, 255, 255, 0.08)',
  tableCellBg: 'rgba(255, 255, 255, 0.02)',

  // Math
  mathEditorBg: 'rgba(100, 150, 255, 0.1)',
  mathEditorBorder: 'rgba(100, 150, 255, 0.3)',
  mathEditorText: '#a5d6ff',

  // Task list
  taskCheckedText: 'rgba(255, 255, 255, 0.5)',

  isDark: true
}

export const lightPanelTheme: PanelTheme = {
  // Core backgrounds
  panelBg: 'rgba(250, 250, 252, 1)',
  panelBgOpacity: (opacity: number) => `rgba(250, 250, 252, ${opacity / 100})`,
  surfaceBg: 'rgba(0, 0, 0, 0.04)',
  surfaceBgHover: 'rgba(0, 0, 0, 0.08)',
  surfaceBgActive: 'rgba(0, 0, 0, 0.12)',

  // Borders
  border: 'rgba(0, 0, 0, 0.1)',
  borderHover: 'rgba(0, 0, 0, 0.15)',
  borderActive: 'rgba(0, 0, 0, 0.2)',

  // Text colors
  text: 'rgba(0, 0, 0, 0.9)',
  textSecondary: 'rgba(0, 0, 0, 0.65)',
  textMuted: 'rgba(0, 0, 0, 0.45)',
  textDisabled: 'rgba(0, 0, 0, 0.25)',

  // Button styles
  buttonBg: 'rgba(0, 0, 0, 0.04)',
  buttonBgHover: 'rgba(0, 0, 0, 0.08)',
  buttonBgActive: 'rgba(0, 0, 0, 0.12)',
  buttonBorder: 'rgba(0, 0, 0, 0.1)',

  // Input styles
  inputBg: 'rgba(0, 0, 0, 0.02)',
  inputBorder: 'rgba(0, 0, 0, 0.08)',
  inputBorderFocus: 'rgba(0, 0, 0, 0.2)',
  inputPlaceholder: 'rgba(0, 0, 0, 0.35)',

  // Message bubbles
  userBubbleBg: 'rgba(0, 0, 0, 0.06)',
  assistantBubbleBg: 'rgba(0, 0, 0, 0.03)',

  // Code blocks
  codeBg: 'rgba(0, 0, 0, 0.04)',
  codeInlineBg: 'rgba(0, 0, 0, 0.06)',
  codeBorder: 'rgba(0, 0, 0, 0.08)',

  // Scrollbar
  scrollbarTrack: 'transparent',
  scrollbarThumb: 'rgba(0, 0, 0, 0.2)',
  scrollbarThumbHover: 'rgba(0, 0, 0, 0.3)',

  // Sidebar
  sidebarBg: 'rgba(245, 245, 247, 0.98)',
  sidebarItemHover: 'rgba(0, 0, 0, 0.06)',
  sidebarItemActive: 'rgba(0, 0, 0, 0.1)',

  // Accent colors
  accent: '#0a84ff',
  accentHover: '#0060df',

  // Drag overlay
  dragOverlayBg: 'rgba(0, 0, 0, 0.03)',
  dragOverlayBorder: 'rgba(0, 0, 0, 0.3)',
  dragOverlayText: 'rgba(0, 0, 0, 0.85)',

  // Icon colors
  iconColor: 'rgba(0, 0, 0, 0.65)',
  iconColorMuted: 'rgba(0, 0, 0, 0.45)',

  // Dropdown
  dropdownBg: 'rgb(255, 255, 255)',
  dropdownItemHover: 'rgba(0, 0, 0, 0.06)',

  // Markdown specific
  headingColor: 'rgba(0, 0, 0, 0.9)',
  blockquoteBorder: 'rgba(0, 0, 0, 0.15)',
  blockquoteText: 'rgba(0, 0, 0, 0.6)',
  linkColor: '#0969da',
  linkColorHover: '#0550ae',
  hrColor: 'rgba(0, 0, 0, 0.1)',
  highlightBg: 'rgba(255, 230, 0, 0.5)',

  // Table
  tableBorder: 'rgba(0, 0, 0, 0.1)',
  tableHeaderBg: 'rgba(0, 0, 0, 0.04)',
  tableCellBg: 'rgba(0, 0, 0, 0.01)',

  // Math
  mathEditorBg: 'rgba(0, 100, 200, 0.08)',
  mathEditorBorder: 'rgba(0, 100, 200, 0.25)',
  mathEditorText: '#0550ae',

  // Task list
  taskCheckedText: 'rgba(0, 0, 0, 0.4)',

  isDark: false
}

function panelThemeFromAppTheme(
  isDarkMode: boolean,
  lightThemePreset?: string | null,
  darkThemePreset?: string | null
): PanelTheme {
  const presetId = resolveThemePresetId(
    isDarkMode,
    isDarkMode ? darkThemePreset : lightThemePreset
  )
  const appTheme = getAppColorTheme(isDarkMode ? 'dark' : 'light', presetId)
  const subtleTransparent = isDarkMode
    ? themeColorWithAlpha(appTheme.foreground, 0.05)
    : themeColorWithAlpha(appTheme.foreground, 0.04)
  const hoverTransparent = isDarkMode
    ? themeColorWithAlpha(appTheme.foreground, 0.1)
    : themeColorWithAlpha(appTheme.foreground, 0.08)
  const activeTransparent = isDarkMode
    ? themeColorWithAlpha(appTheme.foreground, 0.15)
    : themeColorWithAlpha(appTheme.foreground, 0.12)
  const accent = appTheme.buttonPrimaryBg || appTheme.foreground

  return {
    panelBg: appTheme.background,
    panelBgOpacity: (opacity: number) =>
      themeColorWithAlpha(appTheme.background, Math.max(0, Math.min(1, opacity / 100))),
    surfaceBg: subtleTransparent,
    surfaceBgHover: hoverTransparent,
    surfaceBgActive: activeTransparent,

    border: appTheme.border,
    borderHover: isDarkMode
      ? themeColorWithAlpha(appTheme.foreground, 0.15)
      : themeColorWithAlpha(appTheme.foreground, 0.15),
    borderActive: isDarkMode
      ? themeColorWithAlpha(appTheme.foreground, 0.2)
      : themeColorWithAlpha(appTheme.foreground, 0.2),

    text: appTheme.foreground,
    textSecondary: appTheme.muted,
    textMuted: appTheme.mutedLight,
    textDisabled: themeColorWithAlpha(appTheme.muted, 0.55),

    buttonBg: appTheme.buttonSecondaryBg,
    buttonBgHover: appTheme.surfaceSubtle,
    buttonBgActive: appTheme.selectionBg,
    buttonBorder: appTheme.buttonSecondaryBorder,

    inputBg: appTheme.inputBackground,
    inputBorder: appTheme.inputBorder,
    inputBorderFocus: themeColorWithAlpha(appTheme.foreground, 0.28),
    inputPlaceholder: appTheme.inputPlaceholder,

    userBubbleBg: appTheme.selectionBg,
    assistantBubbleBg: isDarkMode ? appTheme.surfaceMuted : appTheme.surfaceElevated,

    codeBg: appTheme.surfaceMuted,
    codeInlineBg: appTheme.surfaceSubtle,
    codeBorder: appTheme.border,

    scrollbarTrack: 'transparent',
    scrollbarThumb: appTheme.scrollbarThumb,
    scrollbarThumbHover: appTheme.scrollbarThumbHover,

    sidebarBg: appTheme.sidebarSurface,
    sidebarItemHover: appTheme.surfaceSubtle,
    sidebarItemActive: appTheme.selectionBg,

    accent,
    accentHover: isDarkMode ? appTheme.foreground : appTheme.surfaceSubtle,

    dragOverlayBg: subtleTransparent,
    dragOverlayBorder: themeColorWithAlpha(appTheme.foreground, 0.35),
    dragOverlayText: appTheme.foreground,

    iconColor: appTheme.muted,
    iconColorMuted: appTheme.mutedLight,

    dropdownBg: appTheme.surfaceElevated,
    dropdownItemHover: appTheme.surfaceSubtle,

    headingColor: appTheme.foreground,
    blockquoteBorder: appTheme.border,
    blockquoteText: appTheme.muted,
    linkColor: isDarkMode ? '#93c5fd' : '#0969da',
    linkColorHover: isDarkMode ? '#bfdbfe' : '#0550ae',
    hrColor: appTheme.border,
    highlightBg: isDarkMode ? 'rgba(255, 230, 0, 0.4)' : 'rgba(255, 230, 0, 0.5)',

    tableBorder: appTheme.border,
    tableHeaderBg: appTheme.surfaceSubtle,
    tableCellBg: appTheme.surfaceElevated,

    mathEditorBg: isDarkMode ? 'rgba(100, 150, 255, 0.1)' : 'rgba(0, 100, 200, 0.08)',
    mathEditorBorder: isDarkMode ? 'rgba(100, 150, 255, 0.3)' : 'rgba(0, 100, 200, 0.25)',
    mathEditorText: isDarkMode ? '#a5d6ff' : '#0550ae',

    taskCheckedText: themeColorWithAlpha(appTheme.muted, 0.65),

    isDark: isDarkMode
  }
}

export function getPanelTheme(
  isDarkMode: boolean,
  lightThemePreset?: string | null,
  darkThemePreset?: string | null
): PanelTheme {
  return panelThemeFromAppTheme(isDarkMode, lightThemePreset, darkThemePreset)
}

export function usePanelTheme(): { theme: PanelTheme; isDarkMode: boolean } {
  const [settingsSnapshot, setSettingsSnapshot] = useState(() => {
    try {
      const saved = localStorage.getItem('overlay-settings')
      if (saved) {
        const settings = JSON.parse(saved)
        return {
          isDarkMode: settings.darkMode ?? false,
          lightThemePreset: settings.lightThemePreset ?? DEFAULT_LIGHT_THEME_PRESET,
          darkThemePreset: settings.darkThemePreset ?? DEFAULT_DARK_THEME_PRESET
        }
      }
    } catch {
      // ignore malformed localStorage data
    }
    return {
      isDarkMode: false,
      lightThemePreset: DEFAULT_LIGHT_THEME_PRESET,
      darkThemePreset: DEFAULT_DARK_THEME_PRESET
    }
  })

  useEffect(() => {
    const readSettings = (): void => {
      try {
        const saved = localStorage.getItem('overlay-settings')
        if (saved) {
          const settings = JSON.parse(saved)
          setSettingsSnapshot({
            isDarkMode: settings.darkMode ?? false,
            lightThemePreset: settings.lightThemePreset ?? DEFAULT_LIGHT_THEME_PRESET,
            darkThemePreset: settings.darkThemePreset ?? DEFAULT_DARK_THEME_PRESET
          })
        }
      } catch {
        // ignore malformed localStorage data
      }
    }

    const handleStorageChange = (e: StorageEvent): void => {
      if (e.key === 'overlay-settings' && e.newValue) {
        readSettings()
      }
    }

    const handleBootstrapUpdate = (): void => {
      readSettings()
    }

    // Set up interval to poll for changes (same window doesn't trigger storage event)
    const interval = setInterval(readSettings, 500)

    window.addEventListener('storage', handleStorageChange)
    window.addEventListener('overlay:app-bootstrap-updated', handleBootstrapUpdate)
    return () => {
      window.removeEventListener('storage', handleStorageChange)
      window.removeEventListener('overlay:app-bootstrap-updated', handleBootstrapUpdate)
      clearInterval(interval)
    }
  }, [])

  return {
    theme: getPanelTheme(
      settingsSnapshot.isDarkMode,
      settingsSnapshot.lightThemePreset,
      settingsSnapshot.darkThemePreset
    ),
    isDarkMode: settingsSnapshot.isDarkMode
  }
}
