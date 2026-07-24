import React from 'react'
import { OnboardingTheme } from './types'

// Animation keyframes and font face - inject into document head
export const onboardingKeyframes = `
@font-face {
  font-family: 'Libre Baskerville';
  src: url('../../../../../resources/fonts/Libre_Baskerville/LibreBaskerville-VariableFont_wght.ttf') format('truetype');
  font-weight: 100 900;
  font-style: normal;
}

@keyframes unblur {
  0% {
    filter: blur(12px);
    opacity: 0;
    transform: translateY(8px);
  }
  100% {
    filter: blur(0);
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes fadeSlideIn {
  0% {
    filter: blur(8px);
    opacity: 0;
    transform: translateY(20px);
  }
  100% {
    filter: blur(0);
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.1); }
}
`

export function getContainerStyle(
  theme: OnboardingTheme,
  _isTransitioning: boolean
): React.CSSProperties {
  return {
    width: '100%',
    height: '100vh',
    background: theme.background,
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
    userSelect: 'none',
    // @ts-expect-error - webkit property for electron drag region
    WebkitAppRegion: 'drag'
  }
}

export function getButtonStyle(theme: OnboardingTheme): React.CSSProperties {
  return {
    // @ts-expect-error - webkit property for electron drag region
    WebkitAppRegion: 'no-drag',
    padding: '10px 14px',
    fontSize: '14px',
    fontWeight: 500,
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    border: 'none',
    borderRadius: '8px',
    background: theme.buttonBg,
    color: theme.toggleThumb,
    cursor: 'pointer',
    transition: 'background 0.15s ease, color 0.15s ease',
    animation: 'fadeSlideIn 0.8s ease forwards',
    animationDelay: '0.6s',
    opacity: 0
  }
}

export function getSecondaryButtonStyle(theme: OnboardingTheme): React.CSSProperties {
  return {
    // @ts-expect-error - webkit property for electron drag region
    WebkitAppRegion: 'no-drag',
    padding: '10px 14px',
    fontSize: '14px',
    fontWeight: 500,
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    border: 'none',
    borderRadius: '8px',
    background: 'transparent',
    color: theme.text,
    cursor: 'pointer',
    transition: 'background 0.15s ease'
  }
}

export function getEmojiStyle(delay = '0.1s'): React.CSSProperties {
  return {
    fontSize: '64px',
    marginBottom: '24px',
    animation: 'unblur 0.8s ease forwards',
    animationDelay: delay,
    opacity: 0
  }
}

export function getTitleStyle(theme: OnboardingTheme, delay = '0.3s'): React.CSSProperties {
  return {
    fontSize: '28px',
    fontWeight: 400,
    fontFamily: "'Libre Baskerville', Georgia, serif",
    color: theme.text,
    margin: 0,
    marginBottom: '16px',
    animation: 'unblur 0.8s ease forwards',
    animationDelay: delay,
    opacity: 0
  }
}

export function getSubtitleStyle(theme: OnboardingTheme, delay = '0.3s'): React.CSSProperties {
  return {
    fontSize: '15px',
    color: theme.textSecondary,
    margin: 0,
    marginBottom: '32px',
    animation: 'unblur 0.8s ease forwards',
    animationDelay: delay,
    opacity: 0,
    lineHeight: 2.0
  }
}

export function getInputStyle(
  theme: OnboardingTheme,
  hasError = false,
  delay = '0.4s'
): React.CSSProperties {
  return {
    // @ts-expect-error - webkit property for electron drag region
    WebkitAppRegion: 'no-drag',
    width: '100%',
    padding: '14px 20px',
    fontSize: '16px',
    background: theme.surface,
    border: hasError ? '1px solid #ef4444' : `1px solid ${theme.border}`,
    borderRadius: '12px',
    color: theme.text,
    outline: 'none',
    marginBottom: hasError ? '8px' : '24px',
    animation: 'fadeSlideIn 0.8s ease forwards',
    animationDelay: delay,
    opacity: 0,
    boxSizing: 'border-box' as const
  }
}

export function getHotkeyBadgeStyle(theme: OnboardingTheme): React.CSSProperties {
  return {
    background: theme.surface,
    padding: '4px 10px',
    borderRadius: '6px',
    border: `1px solid ${theme.border}`,
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    fontSize: '14px',
    cursor: 'pointer',
    transition: 'all 0.2s'
  }
}

export function applyButtonHover(
  e: React.MouseEvent<HTMLButtonElement>,
  theme: OnboardingTheme,
  isDisabled = false
): void {
  if (!isDisabled) {
    e.currentTarget.style.background = theme.buttonHover
    e.currentTarget.style.color = theme.text
  }
}

export function resetButtonHover(
  e: React.MouseEvent<HTMLButtonElement>,
  theme: OnboardingTheme
): void {
  e.currentTarget.style.background = theme.buttonBg
  e.currentTarget.style.color = theme.toggleThumb
}

export function applySecondaryButtonHover(
  e: React.MouseEvent<HTMLButtonElement>,
  theme: OnboardingTheme
): void {
  e.currentTarget.style.background = theme.border
}

export function resetSecondaryButtonHover(e: React.MouseEvent<HTMLButtonElement>): void {
  e.currentTarget.style.background = 'transparent'
}
