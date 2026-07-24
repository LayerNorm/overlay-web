import React from 'react'

export type OnboardingStep =
  | 'welcome'
  | 'auth'
  | 'name'
  | 'all-in-one'
  | 'control-panel'
  | 'permissions'
  | 'test-transcription'
  | 'shortcut-notebook'
  | 'shortcut-chat'
  | 'shortcut-browser'
  | 'shortcut-agent'
  | 'integrations-skills'
  | 'upgrade'
  | 'get-started'

export interface OnboardingTheme {
  isDark: boolean
  background: string
  surface: string
  text: string
  textSecondary: string
  textDisabled: string
  accent: string
  accentHover: string
  border: string
  selectionBg: string
  selectionText: string
  buttonBg: string
  buttonHover: string
  toggleThumb: string
  toggleBg: string
  toggleBgActive: string
  modalBackground: string
  modalBorder: string
  modalSurface: string
  scrim: string
}

export interface OnboardingStepProps {
  theme: OnboardingTheme
  onNext: () => void
  isTransitioning: boolean
}

export interface OnboardingContainerProps {
  theme: OnboardingTheme
  isTransitioning: boolean
  children: React.ReactNode
}

export const USER_PROFILE_KEY = 'overlay-user-profile'

export function saveUserProfile(displayName: string): void {
  localStorage.setItem(USER_PROFILE_KEY, JSON.stringify({ displayName }))
}

export function loadUserProfile(): { displayName: string } | null {
  try {
    const stored = localStorage.getItem(USER_PROFILE_KEY)
    if (stored) return JSON.parse(stored)
  } catch {
    // Ignore errors
  }
  return null
}

// Format hotkey for display with proper symbols
export function formatHotkeyDisplay(hotkey: string): string {
  if (!hotkey) return 'Not set'
  if (
    hotkey.includes('⌘') ||
    hotkey.includes('⌥') ||
    hotkey.includes('⇧') ||
    hotkey.includes('⌃')
  ) {
    return hotkey
  }
  return hotkey
    .replace(/CommandOrControl\+/gi, 'Cmd ⌘ + ')
    .replace(/Command\+/gi, 'Cmd ⌘ + ')
    .replace(/Control\+/gi, 'Ctrl ⌃ + ')
    .replace(/Alt\+/gi, 'Option ⌥ + ')
    .replace(/Shift\+/gi, 'Shift ⇧ + ')
    .replace(/\+$/, '')
}
