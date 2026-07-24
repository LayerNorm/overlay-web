import type { CSSProperties } from 'react'
import type { PanelTheme } from '../../hooks/usePanelTheme'

/**
 * Maps the desktop PanelTheme to the CSS custom properties that shared
 * @overlay/chat-react components consume (defined in chat-surface.css).
 *
 * The shared components use semantic variables like --background, --foreground,
 * --muted, --border, --surface-subtle, --tool-line-label, etc. The desktop's
 * PanelTheme uses different names (panelBg, text, textMuted, border, surfaceBg,
 * etc.). This bridge translates between the two so shared components render with
 * the correct panel-specific colors.
 *
 * The returned style object should be applied to the container that wraps
 * shared chat-react components (the .shared-chat-scope element).
 */
export function panelThemeToSharedCssVars(
  theme: PanelTheme,
  logoUrl: string
): CSSProperties {
  return {
    '--background': theme.panelBg,
    '--foreground': theme.text,
    '--muted': theme.textMuted,
    '--muted-light': theme.textDisabled,
    '--link': theme.text,
    '--warning': '#f59e0b',
    '--border': theme.border,
    // Elevated surfaces are menus/popovers and must remain opaque even when
    // the panel itself uses translucency.
    '--surface-elevated': theme.dropdownBg,
    '--surface-muted': theme.surfaceBgHover,
    '--surface-subtle': theme.surfaceBg,
    '--sidebar-surface': theme.sidebarBg,
    '--glass-bg': theme.surfaceBg,
    '--glass-border': theme.border,
    '--selection-bg': theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)',
    '--scrollbar-thumb': theme.scrollbarThumb,
    '--scrollbar-thumb-hover': theme.scrollbarThumbHover,
    // Match the web app's tool-row colors exactly (globals.css): the label is
    // slightly darker than the chevron. Mapping these to theme.textSecondary
    // previously made chevrons render near-black in light mode.
    '--tool-line-label': theme.isDark ? '#d4d4d8' : '#52525b',
    '--tool-line-chevron': theme.isDark ? '#c4c4c4' : '#a1a1aa',
    // Stream marker / brand mark pulse
    '--overlay-mark-logo-url': `url(${logoUrl})`,
    // Font families — desktop uses system-ui for UI, Instrument Serif for display.
    // Shared components use --font-serif-family for serif text.
    '--font-serif-family': '"Instrument Serif", Georgia, serif',
    // Chat alert colors (used by error labels in shared components)
    '--chat-alert-error-bg': theme.isDark ? 'rgba(239,68,68,0.12)' : '#fef2f2',
    '--chat-alert-error-border': theme.isDark ? 'rgba(239,68,68,0.25)' : '#fecaca',
    '--chat-alert-error-text': theme.isDark ? '#fca5a5' : '#dc2626',
    '--chat-alert-warn-bg': theme.isDark ? 'rgba(245,158,11,0.12)' : '#fffbeb',
    '--chat-alert-warn-border': theme.isDark ? 'rgba(245,158,11,0.25)' : '#fde68a',
    '--chat-alert-warn-text': theme.isDark ? '#fcd34d' : '#92400e',
    // Markdown code blocks
    '--chat-media-error-bg': theme.isDark
      ? 'linear-gradient(180deg, rgba(239,68,68,0.06) 0%, rgba(239,68,68,0.03) 100%)'
      : 'linear-gradient(180deg, #fffafa 0%, #fff5f5 100%)',
    '--chat-media-error-border': theme.isDark ? 'rgba(239,68,68,0.25)' : '#fecaca',
    // Free-tier model badge colors (used by ModelBadges cost pill)
    '--chat-badge-free-bg': theme.isDark ? 'rgba(34,197,94,0.15)' : '#22c55e20',
    '--chat-badge-free-fg': theme.isDark ? '#4ade80' : '#16a34a',
  } as CSSProperties
}
