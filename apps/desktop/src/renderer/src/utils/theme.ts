import {
  DARK_PRESETS,
  LIGHT_PRESETS,
  getAppColorTheme,
  isThemePresetId,
  type AppColorTheme,
  type ThemePreset,
  type ThemePresetId
} from '@overlay/app-core'

export type { ThemePreset, ThemePresetId }
export { DARK_PRESETS, LIGHT_PRESETS, isThemePresetId }

export interface Theme {
  isDark: boolean
  background: string
  surface: string
  text: string
  textSecondary: string
  textDisabled: string
  border: string
  selectionBg: string
  selectionText: string
  buttonBg: string
  buttonHover: string
  toggleBg: string
  toggleBgActive: string
  toggleThumb: string
  accent: string
  accentHover: string
  scrim: string
  modalBackground: string
  modalSurface: string
  modalBorder: string
}

export const DEFAULT_LIGHT_THEME_PRESET: ThemePresetId = 'default-light'
export const DEFAULT_DARK_THEME_PRESET: ThemePresetId = 'default-dark'

function withAlpha(color: string, alpha: number): string {
  const normalized = color.trim()
  if (normalized.startsWith('#')) {
    const hex = normalized.slice(1)
    const full =
      hex.length === 3
        ? hex
            .split('')
            .map((char) => char + char)
            .join('')
        : hex
    const int = Number.parseInt(full.slice(0, 6), 16)
    if (Number.isFinite(int)) {
      const r = (int >> 16) & 255
      const g = (int >> 8) & 255
      const b = int & 255
      return `rgba(${r}, ${g}, ${b}, ${alpha})`
    }
  }
  if (normalized.startsWith('rgb(')) {
    return normalized.replace(/^rgb\((.*)\)$/i, `rgba($1, ${alpha})`)
  }
  return normalized
}

function desktopThemeFromAppTheme(appTheme: AppColorTheme): Theme {
  return {
    isDark: appTheme.preference === 'dark',
    background: appTheme.background,
    surface: appTheme.surfaceElevated,
    text: appTheme.foreground,
    textSecondary: appTheme.muted,
    textDisabled: appTheme.mutedLight,
    border: appTheme.border,
    selectionBg: appTheme.selectionBg,
    selectionText: appTheme.foreground,
    buttonBg: appTheme.buttonPrimaryBg,
    buttonHover: appTheme.preference === 'dark' ? appTheme.surfaceSubtle : appTheme.surfaceMuted,
    toggleBg: appTheme.surfaceSubtle,
    toggleBgActive: appTheme.buttonPrimaryBg,
    toggleThumb: appTheme.buttonPrimaryText,
    accent: appTheme.buttonPrimaryBg,
    accentHover: appTheme.preference === 'dark' ? appTheme.foreground : appTheme.surfaceSubtle,
    scrim: appTheme.overlayScrim,
    modalBackground: appTheme.background,
    modalSurface: appTheme.surfaceElevated,
    modalBorder: appTheme.border
  }
}

export function resolveThemePresetId(
  darkMode: boolean,
  presetId?: string | null
): ThemePresetId {
  const fallback = darkMode ? DEFAULT_DARK_THEME_PRESET : DEFAULT_LIGHT_THEME_PRESET
  if (!isThemePresetId(presetId)) return fallback
  const presets: ThemePreset[] = darkMode ? DARK_PRESETS : LIGHT_PRESETS
  return presets.some((preset) => preset.id === presetId) ? presetId : fallback
}

export function getTheme(
  darkMode: boolean,
  lightThemePreset?: string | null,
  darkThemePreset?: string | null
): Theme {
  const preference = darkMode ? 'dark' : 'light'
  const presetId = resolveThemePresetId(darkMode, darkMode ? darkThemePreset : lightThemePreset)
  return desktopThemeFromAppTheme(getAppColorTheme(preference, presetId))
}

export const lightTheme: Theme = getTheme(false)
export const darkTheme: Theme = getTheme(true)

export function themeColorWithAlpha(color: string, alpha: number): string {
  return withAlpha(color, alpha)
}
