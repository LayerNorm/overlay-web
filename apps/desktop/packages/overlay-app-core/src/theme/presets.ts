import { DARK_BASE, LIGHT_BASE, type ThemePreset, varsFromCodexTheme } from './preset-base'
import { DARK_CODEX_THEME_DEFINITIONS } from './codex-dark-definitions'
import { LIGHT_CODEX_THEME_DEFINITIONS } from './codex-light-definitions'
import type { ThemePresetId } from '../contracts'

const CODEX_THEME_DEFINITIONS = [
  ...LIGHT_CODEX_THEME_DEFINITIONS,
  ...DARK_CODEX_THEME_DEFINITIONS,
]

const CODEX_THEME_PRESETS: ThemePreset[] = CODEX_THEME_DEFINITIONS.map((definition) => ({
  id: definition.id,
  name: definition.name,
  variant: definition.variant,
  cssVars: varsFromCodexTheme(definition),
  previewColors: {
    background: definition.theme.surface,
    accent: definition.theme.accent,
  },
}))

const LEGACY_CATPPUCCIN_DARK: ThemePreset = {
  id: 'catppuccin',
  name: 'Catppuccin',
  variant: 'dark',
  cssVars: {
    ...DARK_BASE,
    '--background': '#1e1e2e',
    '--foreground': '#cdd6f4',
    '--muted': '#a6adc8',
    '--muted-light': '#7f849c',
    '--border': '#313244',
    '--surface-elevated': '#242438',
    '--surface-muted': '#2a2a40',
    '--surface-subtle': '#313244',
    '--sidebar-surface': '#242438',
    '--glass-bg': 'rgba(36, 36, 56, 0.72)',
    '--glass-border': 'rgba(255, 255, 255, 0.06)',
    '--selection-bg': 'rgba(180, 190, 254, 0.15)',
    '--scrollbar-thumb': '#45475a',
    '--scrollbar-thumb-hover': '#585b70',
    '--overlay-scrim': 'rgba(0, 0, 0, 0.6)',
    '--accent': '#b4befe',
    '--skill': '#cba6f7',
  },
  previewColors: { background: '#1e1e2e', accent: '#b4befe' },
}

export const PRESETS: ThemePreset[] = [
  {
    id: 'default-light',
    name: 'Default',
    variant: 'light',
    cssVars: LIGHT_BASE,
    previewColors: { background: '#fafafa', accent: '#0a0a0a' },
  },
  {
    id: 'default-dark',
    name: 'Default',
    variant: 'dark',
    cssVars: DARK_BASE,
    previewColors: { background: '#09090b', accent: '#f5f5f5' },
  },
  ...CODEX_THEME_PRESETS,
  LEGACY_CATPPUCCIN_DARK,
]

export const PRESET_MAP = new Map(PRESETS.map((p) => [p.id, p]))
export const PRESET_IDS = PRESETS.map((p) => p.id)
export const LIGHT_PRESETS = PRESETS.filter((p) => p.variant === 'light')
export const DARK_PRESETS = PRESETS.filter((p) => p.variant === 'dark')

export function isThemePresetId(value: unknown): value is ThemePresetId {
  return typeof value === 'string' && PRESET_MAP.has(value as ThemePresetId)
}

export function getPresetCssVars(id: ThemePresetId): Record<string, string> {
  return PRESET_MAP.get(id)?.cssVars ?? {}
}

/** Canonical list of CSS custom property names that presets may override. */
export const PRESET_CSS_VAR_KEYS = Object.keys(LIGHT_BASE)
