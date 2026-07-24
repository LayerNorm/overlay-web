import type { ThemePresetId } from '../contracts'

export interface ThemePreset {
  id: ThemePresetId
  name: string
  variant: 'light' | 'dark'
  cssVars: Record<string, string>
  previewColors: {
    background: string
    accent: string
  }
}

export type CodexTheme = {
  accent: string
  contrast: number
  fonts: {
    code: string | null
    ui: string | null
  }
  ink: string
  opaqueWindows: boolean
  semanticColors: {
    diffAdded: string
    diffRemoved: string
    skill: string
  }
  surface: string
}

export type CodexPresetDefinition = {
  id: ThemePresetId
  name: string
  variant: 'light' | 'dark'
  codeThemeId: string
  theme: CodexTheme
}

const DEFAULT_UI_FONT = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
const DEFAULT_MONO_FONT = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace"

export const LIGHT_BASE: Record<string, string> = {
  '--background': '#fafafa',
  '--foreground': '#0a0a0a',
  '--muted': '#71717a',
  '--muted-light': '#a1a1aa',
  '--border': '#e4e4e7',
  '--surface-elevated': '#ffffff',
  '--surface-muted': '#f5f5f5',
  '--surface-subtle': '#f0f0f0',
  '--sidebar-surface': '#f5f5f5',
  '--glass-bg': 'rgba(255, 255, 255, 0.7)',
  '--glass-border': 'rgba(255, 255, 255, 0.5)',
  '--selection-bg': 'rgba(0, 0, 0, 0.1)',
  '--scrollbar-thumb': '#d4d4d8',
  '--scrollbar-thumb-hover': '#a1a1aa',
  '--overlay-scrim': 'rgba(0, 0, 0, 0.4)',
  '--font-sans': DEFAULT_UI_FONT,
  '--font-mono': DEFAULT_MONO_FONT,
  '--accent': '#0a0a0a',
  '--skill': '#751ed9',
  '--chat-badge-free-bg': '#ecfdf5',
  '--chat-badge-free-fg': '#065f46',
  '--chat-badge-upgrade-bg': '#fef9ec',
  '--chat-badge-upgrade-fg': '#b45309',
  '--chat-badge-upgrade-hover': '#fde68a',
  '--chat-alert-error-bg': '#fef2f2',
  '--chat-alert-error-border': '#fecaca',
  '--chat-alert-error-text': '#dc2626',
  '--chat-alert-warn-bg': '#fffbeb',
  '--chat-alert-warn-border': '#fde68a',
  '--chat-alert-warn-text': '#92400e',
  '--chat-media-error-bg': 'linear-gradient(180deg, #fffafa 0%, #fff5f5 100%)',
  '--chat-media-error-border': '#fecaca',
  '--tool-line-label': '#52525b',
  '--tool-line-chevron': '#a1a1aa',
  '--button-primary-bg': '#0a0a0a',
  '--button-primary-text': '#ffffff',
  '--button-secondary-bg': '#ffffff',
  '--button-secondary-border': '#e4e4e7',
  '--button-secondary-text': '#0a0a0a',
  '--input-background': '#ffffff',
  '--input-border': '#e4e4e7',
  '--input-text': '#0a0a0a',
  '--input-placeholder': '#a1a1aa',
  '--success': '#10b981',
  '--warning': '#f59e0b',
  '--danger': '#ef4444',
}

export const DARK_BASE: Record<string, string> = {
  '--background': '#09090b',
  '--foreground': '#f5f5f5',
  '--muted': '#a1a1aa',
  '--muted-light': '#71717a',
  '--border': '#27272a',
  '--surface-elevated': '#111113',
  '--surface-muted': '#151518',
  '--surface-subtle': '#1c1c20',
  '--sidebar-surface': '#111113',
  '--glass-bg': 'rgba(17, 17, 19, 0.72)',
  '--glass-border': 'rgba(255, 255, 255, 0.08)',
  '--selection-bg': 'rgba(255, 255, 255, 0.16)',
  '--scrollbar-thumb': '#3f3f46',
  '--scrollbar-thumb-hover': '#52525b',
  '--overlay-scrim': 'rgba(0, 0, 0, 0.58)',
  '--font-sans': DEFAULT_UI_FONT,
  '--font-mono': DEFAULT_MONO_FONT,
  '--accent': '#f5f5f5',
  '--skill': '#b06dff',
  '--chat-badge-free-bg': 'rgba(16, 185, 129, 0.16)',
  '--chat-badge-free-fg': '#6ee7b7',
  '--chat-badge-upgrade-bg': 'rgba(245, 158, 11, 0.14)',
  '--chat-badge-upgrade-fg': '#fbbf24',
  '--chat-badge-upgrade-hover': 'rgba(245, 158, 11, 0.22)',
  '--chat-alert-error-bg': 'rgba(127, 29, 29, 0.45)',
  '--chat-alert-error-border': 'rgba(248, 113, 113, 0.28)',
  '--chat-alert-error-text': '#fecaca',
  '--chat-alert-warn-bg': 'rgba(120, 53, 15, 0.45)',
  '--chat-alert-warn-border': 'rgba(251, 191, 36, 0.25)',
  '--chat-alert-warn-text': '#fde68a',
  '--chat-media-error-bg': 'linear-gradient(180deg, rgba(127, 29, 29, 0.35) 0%, rgba(69, 10, 10, 0.5) 100%)',
  '--chat-media-error-border': 'rgba(248, 113, 113, 0.3)',
  '--tool-line-label': '#d4d4d8',
  '--tool-line-chevron': '#c4c4c4',
  '--button-primary-bg': '#f5f5f5',
  '--button-primary-text': '#09090b',
  '--button-secondary-bg': '#111113',
  '--button-secondary-border': '#27272a',
  '--button-secondary-text': '#f5f5f5',
  '--input-background': '#111113',
  '--input-border': '#27272a',
  '--input-text': '#f5f5f5',
  '--input-placeholder': '#71717a',
  '--success': '#34d399',
  '--warning': '#fbbf24',
  '--danger': '#f87171',
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
  ]
}

function rgbToHex([r, g, b]: [number, number, number]) {
  return `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`
}

function mix(hex: string, target: string, amount: number) {
  const [r1, g1, b1] = hexToRgb(hex)
  const [r2, g2, b2] = hexToRgb(target)
  return rgbToHex([
    r1 + (r2 - r1) * amount,
    g1 + (g2 - g1) * amount,
    b1 + (b2 - b1) * amount,
  ])
}

function alpha(hex: string, opacity: number) {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${opacity})`
}

function fontStack(font: string | null, fallback: string) {
  if (!font) return fallback
  return `${font}, ${fallback}`
}

type CodexThemeMixes = {
  base: Record<string, string>
  surfaceTarget: string
  inkTarget: string
  elevatedMix: number
  mutedMix: number
  subtleMix: number
  mutedTextMix: number
  mutedLightTextMix: number
  borderMix: number
  glassBorderAlpha: number
  selectionAlpha: number
  scrollbarThumbMix: number
  scrollbarThumbHoverMix: number
  overlayScrim: string
  freeBadgeAlpha: number
  freeBadgeTextTarget: string
  freeBadgeTextMix: number
  upgradeBadgeAlpha: number
  upgradeBadgeTextTarget: string
  upgradeBadgeTextMix: number
  upgradeHoverAlpha: number
  errorBgAlpha: number
  errorBorderAlpha: number
  errorTextTarget: string
  errorTextMix: number
  warnBgAlpha: number
  warnBorderAlpha: number
  warnTextTarget: string
  warnTextMix: number
  mediaErrorStartAlpha: number
  mediaErrorEndAlpha: number
  toolLabelMix: number
  toolChevronMix: number
  buttonSecondaryBorderMix: number
  inputBorderMix: number
  inputPlaceholderMix: number
}

const LIGHT_CODEX_THEME_MIXES: CodexThemeMixes = {
  base: LIGHT_BASE,
  surfaceTarget: '#000000',
  inkTarget: '#ffffff',
  elevatedMix: 0.015,
  mutedMix: 0.035,
  subtleMix: 0.06,
  mutedTextMix: 0.44,
  mutedLightTextMix: 0.62,
  borderMix: 0.12,
  glassBorderAlpha: 0.1,
  selectionAlpha: 0.14,
  scrollbarThumbMix: 0.18,
  scrollbarThumbHoverMix: 0.28,
  overlayScrim: 'rgba(0, 0, 0, 0.4)',
  freeBadgeAlpha: 0.12,
  freeBadgeTextTarget: '#000000',
  freeBadgeTextMix: 0.32,
  upgradeBadgeAlpha: 0.12,
  upgradeBadgeTextTarget: '#000000',
  upgradeBadgeTextMix: 0.2,
  upgradeHoverAlpha: 0.2,
  errorBgAlpha: 0.08,
  errorBorderAlpha: 0.24,
  errorTextTarget: '#000000',
  errorTextMix: 0.12,
  warnBgAlpha: 0.1,
  warnBorderAlpha: 0.2,
  warnTextTarget: '#000000',
  warnTextMix: 0.16,
  mediaErrorStartAlpha: 0.08,
  mediaErrorEndAlpha: 0.12,
  toolLabelMix: 0.3,
  toolChevronMix: 0.5,
  buttonSecondaryBorderMix: 0.12,
  inputBorderMix: 0.12,
  inputPlaceholderMix: 0.58,
}

const DARK_CODEX_THEME_MIXES: CodexThemeMixes = {
  base: DARK_BASE,
  surfaceTarget: '#ffffff',
  inkTarget: '#000000',
  elevatedMix: 0.045,
  mutedMix: 0.075,
  subtleMix: 0.12,
  mutedTextMix: 0.34,
  mutedLightTextMix: 0.52,
  borderMix: 0.18,
  glassBorderAlpha: 0.08,
  selectionAlpha: 0.22,
  scrollbarThumbMix: 0.24,
  scrollbarThumbHoverMix: 0.34,
  overlayScrim: 'rgba(0, 0, 0, 0.58)',
  freeBadgeAlpha: 0.16,
  freeBadgeTextTarget: '#ffffff',
  freeBadgeTextMix: 0.25,
  upgradeBadgeAlpha: 0.14,
  upgradeBadgeTextTarget: '#ffffff',
  upgradeBadgeTextMix: 0.18,
  upgradeHoverAlpha: 0.22,
  errorBgAlpha: 0.18,
  errorBorderAlpha: 0.3,
  errorTextTarget: '#ffffff',
  errorTextMix: 0.3,
  warnBgAlpha: 0.16,
  warnBorderAlpha: 0.28,
  warnTextTarget: '#ffffff',
  warnTextMix: 0.28,
  mediaErrorStartAlpha: 0.16,
  mediaErrorEndAlpha: 0.24,
  toolLabelMix: 0.18,
  toolChevronMix: 0.34,
  buttonSecondaryBorderMix: 0.18,
  inputBorderMix: 0.18,
  inputPlaceholderMix: 0.48,
}

export function varsFromCodexTheme({ variant, theme }: Pick<CodexPresetDefinition, 'variant' | 'theme'>): Record<string, string> {
  const mixes = variant === 'dark' ? DARK_CODEX_THEME_MIXES : LIGHT_CODEX_THEME_MIXES
  const surfaceElevated = mix(theme.surface, mixes.surfaceTarget, mixes.elevatedMix)

  return {
    ...mixes.base,
    '--background': theme.surface,
    '--foreground': theme.ink,
    '--muted': mix(theme.ink, theme.surface, mixes.mutedTextMix),
    '--muted-light': mix(theme.ink, theme.surface, mixes.mutedLightTextMix),
    '--border': mix(theme.surface, theme.ink, mixes.borderMix),
    '--surface-elevated': surfaceElevated,
    '--surface-muted': mix(theme.surface, mixes.surfaceTarget, mixes.mutedMix),
    '--surface-subtle': mix(theme.surface, mixes.surfaceTarget, mixes.subtleMix),
    '--sidebar-surface': theme.opaqueWindows ? surfaceElevated : theme.surface,
    '--glass-bg': theme.opaqueWindows ? surfaceElevated : alpha(surfaceElevated, 0.72),
    '--glass-border': alpha(theme.ink, mixes.glassBorderAlpha),
    '--selection-bg': alpha(theme.accent, mixes.selectionAlpha),
    '--scrollbar-thumb': mix(theme.surface, theme.ink, mixes.scrollbarThumbMix),
    '--scrollbar-thumb-hover': mix(theme.surface, theme.ink, mixes.scrollbarThumbHoverMix),
    '--overlay-scrim': mixes.overlayScrim,
    '--font-sans': fontStack(theme.fonts.ui, DEFAULT_UI_FONT),
    '--font-mono': fontStack(theme.fonts.code, DEFAULT_MONO_FONT),
    '--accent': theme.accent,
    '--skill': theme.semanticColors.skill,
    '--chat-badge-free-bg': alpha(theme.semanticColors.diffAdded, mixes.freeBadgeAlpha),
    '--chat-badge-free-fg': mix(theme.semanticColors.diffAdded, mixes.freeBadgeTextTarget, mixes.freeBadgeTextMix),
    '--chat-badge-upgrade-bg': alpha(theme.accent, mixes.upgradeBadgeAlpha),
    '--chat-badge-upgrade-fg': mix(theme.accent, mixes.upgradeBadgeTextTarget, mixes.upgradeBadgeTextMix),
    '--chat-badge-upgrade-hover': alpha(theme.accent, mixes.upgradeHoverAlpha),
    '--chat-alert-error-bg': alpha(theme.semanticColors.diffRemoved, mixes.errorBgAlpha),
    '--chat-alert-error-border': alpha(theme.semanticColors.diffRemoved, mixes.errorBorderAlpha),
    '--chat-alert-error-text': mix(theme.semanticColors.diffRemoved, mixes.errorTextTarget, mixes.errorTextMix),
    '--chat-alert-warn-bg': alpha(theme.accent, mixes.warnBgAlpha),
    '--chat-alert-warn-border': alpha(theme.accent, mixes.warnBorderAlpha),
    '--chat-alert-warn-text': mix(theme.accent, mixes.warnTextTarget, mixes.warnTextMix),
    '--chat-media-error-bg': `linear-gradient(180deg, ${alpha(theme.semanticColors.diffRemoved, mixes.mediaErrorStartAlpha)} 0%, ${alpha(theme.semanticColors.diffRemoved, mixes.mediaErrorEndAlpha)} 100%)`,
    '--chat-media-error-border': alpha(theme.semanticColors.diffRemoved, mixes.errorBorderAlpha),
    '--tool-line-label': mix(theme.ink, theme.surface, mixes.toolLabelMix),
    '--tool-line-chevron': mix(theme.ink, theme.surface, mixes.toolChevronMix),
    '--button-primary-bg': theme.accent,
    '--button-primary-text': mix(theme.accent, mixes.inkTarget, 0.88),
    '--button-secondary-bg': surfaceElevated,
    '--button-secondary-border': mix(theme.surface, theme.ink, mixes.buttonSecondaryBorderMix),
    '--button-secondary-text': theme.ink,
    '--input-background': surfaceElevated,
    '--input-border': mix(theme.surface, theme.ink, mixes.inputBorderMix),
    '--input-text': theme.ink,
    '--input-placeholder': mix(theme.ink, theme.surface, mixes.inputPlaceholderMix),
    '--success': theme.semanticColors.diffAdded,
    '--warning': theme.accent,
    '--danger': theme.semanticColors.diffRemoved,
  }
}
