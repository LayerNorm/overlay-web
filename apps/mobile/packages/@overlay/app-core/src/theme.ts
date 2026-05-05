import type { ThemePreference } from './contracts'

export const SERIF_FONT_FAMILY = 'LibreBaskerville'
export const SERIF_FONT_FAMILY_ITALIC = 'LibreBaskerville-Italic'

export interface AppColorTheme {
  preference: ThemePreference
  background: string
  foreground: string
  muted: string
  mutedLight: string
  border: string
  surfaceElevated: string
  surfaceMuted: string
  surfaceSubtle: string
  sidebarSurface: string
  glassBg: string
  glassBorder: string
  selectionBg: string
  scrollbarThumb: string
  scrollbarThumbHover: string
  overlayScrim: string
  chatBadgeFreeBg: string
  chatBadgeFreeFg: string
  chatBadgeUpgradeBg: string
  chatBadgeUpgradeFg: string
  chatBadgeUpgradeHover: string
  chatAlertErrorBg: string
  chatAlertErrorBorder: string
  chatAlertErrorText: string
  chatAlertWarnBg: string
  chatAlertWarnBorder: string
  chatAlertWarnText: string
  chatMediaErrorBg: string
  chatMediaErrorBorder: string
  toolLineLabel: string
  toolLineChevron: string
  buttonPrimaryBg: string
  buttonPrimaryText: string
  buttonSecondaryBg: string
  buttonSecondaryBorder: string
  buttonSecondaryText: string
  inputBackground: string
  inputBorder: string
  inputText: string
  inputPlaceholder: string
  success: string
  warning: string
  danger: string
}

export const lightColorTheme: AppColorTheme = {
  preference: 'light',
  background: '#fafafa',
  foreground: '#0a0a0a',
  muted: '#71717a',
  mutedLight: '#a1a1aa',
  border: '#e4e4e7',
  surfaceElevated: '#ffffff',
  surfaceMuted: '#f5f5f5',
  surfaceSubtle: '#f0f0f0',
  sidebarSurface: '#f5f5f5',
  glassBg: 'rgba(255, 255, 255, 0.7)',
  glassBorder: 'rgba(255, 255, 255, 0.5)',
  selectionBg: 'rgba(0, 0, 0, 0.1)',
  scrollbarThumb: '#d4d4d8',
  scrollbarThumbHover: '#a1a1aa',
  overlayScrim: 'rgba(0, 0, 0, 0.4)',
  chatBadgeFreeBg: '#ecfdf5',
  chatBadgeFreeFg: '#065f46',
  chatBadgeUpgradeBg: '#fef9ec',
  chatBadgeUpgradeFg: '#b45309',
  chatBadgeUpgradeHover: '#fde68a',
  chatAlertErrorBg: '#fef2f2',
  chatAlertErrorBorder: '#fecaca',
  chatAlertErrorText: '#dc2626',
  chatAlertWarnBg: '#fffbeb',
  chatAlertWarnBorder: '#fde68a',
  chatAlertWarnText: '#92400e',
  chatMediaErrorBg: 'linear-gradient(180deg, #fffafa 0%, #fff5f5 100%)',
  chatMediaErrorBorder: '#fecaca',
  toolLineLabel: '#52525b',
  toolLineChevron: '#a1a1aa',
  buttonPrimaryBg: '#0a0a0a',
  buttonPrimaryText: '#ffffff',
  buttonSecondaryBg: '#ffffff',
  buttonSecondaryBorder: '#e4e4e7',
  buttonSecondaryText: '#0a0a0a',
  inputBackground: '#ffffff',
  inputBorder: '#e4e4e7',
  inputText: '#0a0a0a',
  inputPlaceholder: '#a1a1aa',
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
}

export const darkColorTheme: AppColorTheme = {
  preference: 'dark',
  background: '#09090b',
  foreground: '#f5f5f5',
  muted: '#a1a1aa',
  mutedLight: '#71717a',
  border: '#27272a',
  surfaceElevated: '#111113',
  surfaceMuted: '#151518',
  surfaceSubtle: '#1c1c20',
  sidebarSurface: '#111113',
  glassBg: 'rgba(17, 17, 19, 0.72)',
  glassBorder: 'rgba(255, 255, 255, 0.08)',
  selectionBg: 'rgba(255, 255, 255, 0.16)',
  scrollbarThumb: '#3f3f46',
  scrollbarThumbHover: '#52525b',
  overlayScrim: 'rgba(0, 0, 0, 0.58)',
  chatBadgeFreeBg: 'rgba(16, 185, 129, 0.16)',
  chatBadgeFreeFg: '#6ee7b7',
  chatBadgeUpgradeBg: 'rgba(245, 158, 11, 0.14)',
  chatBadgeUpgradeFg: '#fbbf24',
  chatBadgeUpgradeHover: 'rgba(245, 158, 11, 0.22)',
  chatAlertErrorBg: 'rgba(127, 29, 29, 0.45)',
  chatAlertErrorBorder: 'rgba(248, 113, 113, 0.28)',
  chatAlertErrorText: '#fecaca',
  chatAlertWarnBg: 'rgba(120, 53, 15, 0.45)',
  chatAlertWarnBorder: 'rgba(251, 191, 36, 0.25)',
  chatAlertWarnText: '#fde68a',
  chatMediaErrorBg:
    'linear-gradient(180deg, rgba(127, 29, 29, 0.35) 0%, rgba(69, 10, 10, 0.5) 100%)',
  chatMediaErrorBorder: 'rgba(248, 113, 113, 0.3)',
  toolLineLabel: '#d4d4d8',
  toolLineChevron: '#c4c4c4',
  buttonPrimaryBg: '#f5f5f5',
  buttonPrimaryText: '#09090b',
  buttonSecondaryBg: '#111113',
  buttonSecondaryBorder: '#27272a',
  buttonSecondaryText: '#f5f5f5',
  inputBackground: '#111113',
  inputBorder: '#27272a',
  inputText: '#f5f5f5',
  inputPlaceholder: '#71717a',
  success: '#34d399',
  warning: '#fbbf24',
  danger: '#f87171',
}

export const appSpacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const

export const appRadii = {
  sm: 8,
  md: 10,
  lg: 12,
  xl: 16,
  xxl: 24,
  pill: 9999,
} as const

export const appFontSizes = {
  xs: 12,
  sm: 13,
  md: 14,
  lg: 16,
  xl: 18,
  xxl: 24,
  display: 36,
  hero: 48,
} as const

export function getAppColorTheme(preference: ThemePreference): AppColorTheme {
  return preference === 'dark' ? darkColorTheme : lightColorTheme
}
