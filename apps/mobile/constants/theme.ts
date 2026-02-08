export interface Theme {
  background: string
  surface: string
  text: string
  textSecondary: string
  textDisabled: string
  border: string
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

export const lightTheme: Theme = {
  background: '#fafafa',
  surface: '#ffffff',
  text: '#0a0a0a',
  textSecondary: '#71717a',
  textDisabled: '#a1a1aa',
  border: '#e4e4e7',
  buttonBg: '#0a0a0a',
  buttonHover: '#27272a',
  toggleBg: '#e4e4e7',
  toggleBgActive: '#0a0a0a',
  toggleThumb: '#ffffff',
  accent: '#0a0a0a',
  accentHover: '#27272a',
  scrim: 'rgba(0, 0, 0, 0.5)',
  modalBackground: '#fafafa',
  modalSurface: '#ffffff',
  modalBorder: '#e4e4e7'
}

export const darkTheme: Theme = {
  background: '#0a0a0a',
  surface: '#18181b',
  text: '#fafafa',
  textSecondary: '#a1a1aa',
  textDisabled: '#71717a',
  border: '#27272a',
  buttonBg: '#fafafa',
  buttonHover: '#e4e4e7',
  toggleBg: '#27272a',
  toggleBgActive: '#fafafa',
  toggleThumb: '#0a0a0a',
  accent: '#fafafa',
  accentHover: '#e4e4e7',
  scrim: 'rgba(0, 0, 0, 0.7)',
  modalBackground: '#0a0a0a',
  modalSurface: '#18181b',
  modalBorder: '#27272a'
}

export function getTheme(darkMode: boolean): Theme {
  return darkMode ? darkTheme : lightTheme
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24
} as const

export const borderRadius = {
  sm: 8,
  md: 10,
  lg: 12,
  xl: 16,
  full: 9999
} as const

export const fontSize = {
  xs: 12,
  sm: 13,
  md: 14,
  lg: 16,
  xl: 18,
  xxl: 24,
  display: 36
} as const
