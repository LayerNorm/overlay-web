import {
  appFontSizes,
  appRadii,
  appSpacing,
  getAppColorTheme,
  SERIF_FONT_FAMILY,
  SERIF_FONT_FAMILY_ITALIC,
  type AppColorTheme,
  type ThemePresetId,
} from '@overlay/app-core'

export interface Theme extends AppColorTheme {
  surface: string
  text: string
  textSecondary: string
  textDisabled: string
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
  serifFontFamily: string
  serifFontFamilyItalic: string
}

function createTheme(preference: 'light' | 'dark', presetId?: ThemePresetId): Theme {
  const semantic = getAppColorTheme(preference, presetId)

  return {
    ...semantic,
    surface: semantic.surfaceElevated,
    text: semantic.foreground,
    textSecondary: semantic.muted,
    textDisabled: semantic.mutedLight,
    buttonBg: semantic.buttonPrimaryBg,
    buttonHover: semantic.chatBadgeUpgradeHover,
    toggleBg: semantic.surfaceSubtle,
    toggleBgActive: semantic.buttonPrimaryBg,
    toggleThumb: semantic.buttonPrimaryText,
    accent: semantic.foreground,
    accentHover: semantic.muted,
    scrim: semantic.overlayScrim,
    modalBackground: semantic.background,
    modalSurface: semantic.surfaceElevated,
    modalBorder: semantic.border,
    serifFontFamily: SERIF_FONT_FAMILY,
    serifFontFamilyItalic: SERIF_FONT_FAMILY_ITALIC,
  }
}

export const lightTheme: Theme = createTheme('light')
export const darkTheme: Theme = createTheme('dark')

export function getTheme(darkMode: boolean, presetId?: ThemePresetId): Theme {
  return createTheme(darkMode ? 'dark' : 'light', presetId)
}

export const spacing = appSpacing

export const borderRadius = {
  sm: appRadii.sm,
  md: appRadii.md,
  lg: appRadii.lg,
  xl: appRadii.xl,
  xxl: appRadii.xxl,
  full: appRadii.pill,
} as const

export const fontSize = {
  xs: appFontSizes.xs,
  sm: appFontSizes.sm,
  md: appFontSizes.md,
  lg: appFontSizes.lg,
  xl: appFontSizes.xl,
  xxl: appFontSizes.xxl,
  display: appFontSizes.display,
  hero: appFontSizes.hero,
} as const
