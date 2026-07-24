import type { ThemePreference, ThemePresetId } from '../contracts'
import type { AppColorTheme } from './base'
import { darkColorTheme, lightColorTheme } from './base'
import { PRESET_MAP } from './presets'

export function getAppColorTheme(
  preference: ThemePreference,
  presetId?: ThemePresetId,
): AppColorTheme {
  if (presetId) {
    const preset = PRESET_MAP.get(presetId)
    if (preset?.variant === preference) {
      return appColorThemeFromCssVars(preference, preset.cssVars)
    }
  }

  return preference === 'dark' ? darkColorTheme : lightColorTheme
}

function appColorThemeFromCssVars(
  preference: ThemePreference,
  cssVars: Record<string, string>,
): AppColorTheme {
  const fallback = preference === 'dark' ? darkColorTheme : lightColorTheme
  const read = (key: string, fallbackValue: string) => cssVars[key] ?? fallbackValue

  return {
    preference,
    background: read('--background', fallback.background),
    foreground: read('--foreground', fallback.foreground),
    muted: read('--muted', fallback.muted),
    mutedLight: read('--muted-light', fallback.mutedLight),
    border: read('--border', fallback.border),
    surfaceElevated: read('--surface-elevated', fallback.surfaceElevated),
    surfaceMuted: read('--surface-muted', fallback.surfaceMuted),
    surfaceSubtle: read('--surface-subtle', fallback.surfaceSubtle),
    sidebarSurface: read('--sidebar-surface', fallback.sidebarSurface),
    glassBg: read('--glass-bg', fallback.glassBg),
    glassBorder: read('--glass-border', fallback.glassBorder),
    selectionBg: read('--selection-bg', fallback.selectionBg),
    scrollbarThumb: read('--scrollbar-thumb', fallback.scrollbarThumb),
    scrollbarThumbHover: read('--scrollbar-thumb-hover', fallback.scrollbarThumbHover),
    overlayScrim: read('--overlay-scrim', fallback.overlayScrim),
    chatBadgeFreeBg: read('--chat-badge-free-bg', fallback.chatBadgeFreeBg),
    chatBadgeFreeFg: read('--chat-badge-free-fg', fallback.chatBadgeFreeFg),
    chatBadgeUpgradeBg: read('--chat-badge-upgrade-bg', fallback.chatBadgeUpgradeBg),
    chatBadgeUpgradeFg: read('--chat-badge-upgrade-fg', fallback.chatBadgeUpgradeFg),
    chatBadgeUpgradeHover: read('--chat-badge-upgrade-hover', fallback.chatBadgeUpgradeHover),
    chatAlertErrorBg: read('--chat-alert-error-bg', fallback.chatAlertErrorBg),
    chatAlertErrorBorder: read('--chat-alert-error-border', fallback.chatAlertErrorBorder),
    chatAlertErrorText: read('--chat-alert-error-text', fallback.chatAlertErrorText),
    chatAlertWarnBg: read('--chat-alert-warn-bg', fallback.chatAlertWarnBg),
    chatAlertWarnBorder: read('--chat-alert-warn-border', fallback.chatAlertWarnBorder),
    chatAlertWarnText: read('--chat-alert-warn-text', fallback.chatAlertWarnText),
    chatMediaErrorBg: read('--chat-media-error-bg', fallback.chatMediaErrorBg),
    chatMediaErrorBorder: read('--chat-media-error-border', fallback.chatMediaErrorBorder),
    toolLineLabel: read('--tool-line-label', fallback.toolLineLabel),
    toolLineChevron: read('--tool-line-chevron', fallback.toolLineChevron),
    buttonPrimaryBg: read('--button-primary-bg', fallback.buttonPrimaryBg),
    buttonPrimaryText: read('--button-primary-text', fallback.buttonPrimaryText),
    buttonSecondaryBg: read('--button-secondary-bg', fallback.buttonSecondaryBg),
    buttonSecondaryBorder: read('--button-secondary-border', fallback.buttonSecondaryBorder),
    buttonSecondaryText: read('--button-secondary-text', fallback.buttonSecondaryText),
    inputBackground: read('--input-background', fallback.inputBackground),
    inputBorder: read('--input-border', fallback.inputBorder),
    inputText: read('--input-text', fallback.inputText),
    inputPlaceholder: read('--input-placeholder', fallback.inputPlaceholder),
    success: read('--success', fallback.success),
    warning: read('--warning', fallback.warning),
    danger: read('--danger', fallback.danger),
  }
}
