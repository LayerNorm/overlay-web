import { usePanelTheme } from '../../hooks/usePanelTheme'

// SVG icons for each provider (inlined for simplicity)
const PROVIDER_ICONS: Record<string, { dark: string; light: string }> = {
  openai: {
    dark: `<svg xmlns="http://www.w3.org/2000/svg" fill="#fff" viewBox="0 0 24 24"><path d="M22.282 9.821a6 6 0 0 0-.516-4.91 6.05 6.05 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a6 6 0 0 0-3.998 2.9 6.05 6.05 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.05 6.05 0 0 0 6.515 2.9A6 6 0 0 0 13.26 24a6.06 6.06 0 0 0 5.772-4.206 6 6 0 0 0 3.997-2.9 6.06 6.06 0 0 0-.747-7.073M13.26 22.43a4.48 4.48 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.8.8 0 0 0 .392-.681v-6.737l2.02 1.168a.07.07 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494M3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.77.77 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646M2.34 7.896a4.5 4.5 0 0 1 2.366-1.973V11.6a.77.77 0 0 0 .388.677l5.815 3.354-2.02 1.168a.08.08 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855-5.833-3.387L15.119 7.2a.08.08 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667m2.01-3.023-.141-.085-4.774-2.782a.78.78 0 0 0-.785 0L9.409 9.23V6.897a.07.07 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.8.8 0 0 0-.393.681zm1.097-2.365 2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5Z"/></svg>`,
    light: `<svg xmlns="http://www.w3.org/2000/svg" fill="#000" viewBox="0 0 24 24"><path d="M22.282 9.821a6 6 0 0 0-.516-4.91 6.05 6.05 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a6 6 0 0 0-3.998 2.9 6.05 6.05 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.05 6.05 0 0 0 6.515 2.9A6 6 0 0 0 13.26 24a6.06 6.06 0 0 0 5.772-4.206 6 6 0 0 0 3.997-2.9 6.06 6.06 0 0 0-.747-7.073M13.26 22.43a4.48 4.48 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.8.8 0 0 0 .392-.681v-6.737l2.02 1.168a.07.07 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494M3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.77.77 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646M2.34 7.896a4.5 4.5 0 0 1 2.366-1.973V11.6a.77.77 0 0 0 .388.677l5.815 3.354-2.02 1.168a.08.08 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855-5.833-3.387L15.119 7.2a.08.08 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667m2.01-3.023-.141-.085-4.774-2.782a.78.78 0 0 0-.785 0L9.409 9.23V6.897a.07.07 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.8.8 0 0 0-.393.681zm1.097-2.365 2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5Z"/></svg>`
  },
  anthropic: {
    dark: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#CC9B7A" rx="104.187" ry="105.042"/><path fill="#1a1a1a" fill-rule="nonzero" d="M318.663 149.787h-43.368l78.952 212.423 43.368.004zm-125.326 0-78.952 212.427h44.255l15.932-44.608 82.846-.004 16.107 44.612h44.255l-79.126-212.427zm-4.251 128.341 26.91-74.701 27.083 74.701z"/></svg>`,
    light: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#CC9B7A" rx="104.187" ry="105.042"/><path fill="#1a1a1a" fill-rule="nonzero" d="M318.663 149.787h-43.368l78.952 212.423 43.368.004zm-125.326 0-78.952 212.427h44.255l15.932-44.608 82.846-.004 16.107 44.612h44.255l-79.126-212.427zm-4.251 128.341 26.91-74.701 27.083 74.701z"/></svg>`
  },
  groq: {
    dark: `<svg fill="#fff" fill-rule="evenodd" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12.036 2c-3.853-.035-7 3-7.036 6.781-.035 3.782 3.055 6.872 6.908 6.907h2.42v-2.566h-2.292c-2.407.028-4.38-1.866-4.408-4.23-.029-2.362 1.901-4.298 4.308-4.326h.1c2.407 0 4.358 1.915 4.365 4.278v6.305c0 2.342-1.944 4.25-4.323 4.279a4.375 4.375 0 01-3.033-1.252l-1.851 1.818A7 7 0 0012.029 22h.092c3.803-.056 6.858-3.083 6.879-6.816v-6.5C18.907 4.963 15.817 2 12.036 2z"/></svg>`,
    light: `<svg fill="#000" fill-rule="evenodd" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12.036 2c-3.853-.035-7 3-7.036 6.781-.035 3.782 3.055 6.872 6.908 6.907h2.42v-2.566h-2.292c-2.407.028-4.38-1.866-4.408-4.23-.029-2.362 1.901-4.298 4.308-4.326h.1c2.407 0 4.358 1.915 4.365 4.278v6.305c0 2.342-1.944 4.25-4.323 4.279a4.375 4.375 0 01-3.033-1.252l-1.851 1.818A7 7 0 0012.029 22h.092c3.803-.056 6.858-3.083 6.879-6.816v-6.5C18.907 4.963 15.817 2 12.036 2z"/></svg>`
  },
  google: {
    dark: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><radialGradient id="gemini-grad" cx="-37.129" cy="650.866" r="32" gradientTransform="matrix(16.1326 5.4553 43.7005 -129.2322 -27793.309 84523.438)" gradientUnits="userSpaceOnUse"><stop offset=".067" style="stop-color:#9168c0"/><stop offset=".343" style="stop-color:#5684d1"/><stop offset=".672" style="stop-color:#1ba1e3"/></radialGradient></defs><path d="M512 256.5c-137.5 8.4-247.1 118-255.5 255.5h-1C247.1 374.5 137.5 264.9 0 256.5v-1c137.5-8.4 247.1-118 255.5-255.5h1c8.4 137.5 118 247.1 255.5 255.5z" style="fill:url(#gemini-grad)"/></svg>`,
    light: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><radialGradient id="gemini-grad-light" cx="-37.129" cy="650.866" r="32" gradientTransform="matrix(16.1326 5.4553 43.7005 -129.2322 -27793.309 84523.438)" gradientUnits="userSpaceOnUse"><stop offset=".067" style="stop-color:#9168c0"/><stop offset=".343" style="stop-color:#5684d1"/><stop offset=".672" style="stop-color:#1ba1e3"/></radialGradient></defs><path d="M512 256.5c-137.5 8.4-247.1 118-255.5 255.5h-1C247.1 374.5 137.5 264.9 0 256.5v-1c137.5-8.4 247.1-118 255.5-255.5h1c8.4 137.5 118 247.1 255.5 255.5z" style="fill:url(#gemini-grad-light)"/></svg>`
  },
  xai: {
    dark: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0.36 0.5 33.33 32"><path d="M13.2371 21.0407L24.3186 12.8506C24.8619 12.4491 25.6384 12.6057 25.8973 13.2294C27.2597 16.5185 26.651 20.4712 23.9403 23.1851C21.2297 25.8989 17.4581 26.4941 14.0108 25.1386L10.2449 26.8843C15.6463 30.5806 22.2053 29.6665 26.304 25.5601C29.5551 22.3051 30.562 17.8683 29.6205 13.8673L29.629 13.8758C28.2637 7.99809 29.9647 5.64871 33.449 0.844576C33.5314 0.730667 33.6139 0.616757 33.6964 0.5L29.1113 5.09055V5.07631L13.2343 21.0436" fill="#fff"/><path d="M10.9503 23.0313C7.07343 19.3235 7.74185 13.5853 11.0498 10.2763C13.4959 7.82722 17.5036 6.82767 21.0021 8.2971L24.7595 6.55998C24.0826 6.07017 23.215 5.54334 22.2195 5.17313C17.7198 3.31926 12.3326 4.24192 8.67479 7.90126C5.15635 11.4239 4.0499 16.8403 5.94992 21.4622C7.36924 24.9165 5.04257 27.3598 2.69884 29.826C1.86829 30.7002 1.0349 31.5745 0.36364 32.5L10.9474 23.0341" fill="#fff"/></svg>`,
    light: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0.36 0.5 33.33 32"><path d="M13.2371 21.0407L24.3186 12.8506C24.8619 12.4491 25.6384 12.6057 25.8973 13.2294C27.2597 16.5185 26.651 20.4712 23.9403 23.1851C21.2297 25.8989 17.4581 26.4941 14.0108 25.1386L10.2449 26.8843C15.6463 30.5806 22.2053 29.6665 26.304 25.5601C29.5551 22.3051 30.562 17.8683 29.6205 13.8673L29.629 13.8758C28.2637 7.99809 29.9647 5.64871 33.449 0.844576C33.5314 0.730667 33.6139 0.616757 33.6964 0.5L29.1113 5.09055V5.07631L13.2343 21.0436" fill="#000"/><path d="M10.9503 23.0313C7.07343 19.3235 7.74185 13.5853 11.0498 10.2763C13.4959 7.82722 17.5036 6.82767 21.0021 8.2971L24.7595 6.55998C24.0826 6.07017 23.215 5.54334 22.2195 5.17313C17.7198 3.31926 12.3326 4.24192 8.67479 7.90126C5.15635 11.4239 4.0499 16.8403 5.94992 21.4622C7.36924 24.9165 5.04257 27.3598 2.69884 29.826C1.86829 30.7002 1.0349 31.5745 0.36364 32.5L10.9474 23.0341" fill="#000"/></svg>`
  },
  minimax: {
    dark: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#fff"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`,
    light: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#000"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`
  },
  openrouter: {
    dark: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#fff"><circle cx="12" cy="12" r="10" stroke="#fff" stroke-width="2" fill="none"/><path d="M12 6v12M6 12h12" stroke="#fff" stroke-width="2"/></svg>`,
    light: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#000"><circle cx="12" cy="12" r="10" stroke="#000" stroke-width="2" fill="none"/><path d="M12 6v12M6 12h12" stroke="#000" stroke-width="2"/></svg>`
  }
}

interface ProviderIconProps {
  provider: string
  size?: number
  isLoading?: boolean
  isSelected?: boolean
  isPulsating?: boolean
  showBorder?: boolean
  onClick?: () => void
  title?: string
}

// Provider accent colors for selection borders
const PROVIDER_ACCENT_COLORS: Record<string, string> = {
  openai: '#10a37f',
  anthropic: '#CC9B7A',
  groq: '#f55036',
  google: '#4285f4',
  xai: '#fff',
  minimax: '#6366f1',
  openrouter: '#22c55e',
  deepseek: '#4f46e5',
  nvidia: '#76b900',
  alibaba: '#ff6a00',
  zai: '#7c3aed',
  moonshot: '#64748b'
}

export function ProviderIcon({
  provider,
  size = 20,
  isLoading = false,
  isSelected = false,
  isPulsating = false,
  showBorder = false,
  onClick,
  title
}: ProviderIconProps): React.ReactElement {
  const { isDarkMode } = usePanelTheme()

  const iconData = PROVIDER_ICONS[provider]
  const svgContent = iconData ? (isDarkMode ? iconData.dark : iconData.light) : null
  const accentColor = PROVIDER_ACCENT_COLORS[provider] || '#888'

  const borderColor = isSelected ? accentColor : 'rgba(255,255,255,0.2)'
  const borderStyle = showBorder ? `2px solid ${borderColor}` : 'none'

  return (
    <div
      onClick={onClick}
      title={title}
      style={{
        width: size + (showBorder ? 8 : 0),
        height: size + (showBorder ? 8 : 0),
        padding: showBorder ? 3 : 0,
        borderRadius: '50%',
        border: borderStyle,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: onClick ? 'pointer' : 'default',
        position: 'relative',
        opacity: isSelected || isPulsating ? 1 : 0.6,
        transition: 'opacity 0.15s ease, border-color 0.15s ease, transform 0.15s ease',
        animation: isPulsating ? 'pulse 1.2s ease-in-out infinite' : 'none',
        boxSizing: 'border-box'
      }}
      onMouseEnter={(e) => {
        if (onClick) {
          e.currentTarget.style.opacity = '1'
        }
      }}
      onMouseLeave={(e) => {
        if (onClick && !isSelected && !isPulsating) {
          e.currentTarget.style.opacity = '0.6'
        }
      }}
    >
      {svgContent && (
        <div
          dangerouslySetInnerHTML={{ __html: svgContent }}
          style={{
            width: size,
            height: size,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        />
      )}
      {!svgContent && (
        <span
          style={{
            width: size,
            height: size,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: isDarkMode ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
            color: isDarkMode ? '#fff' : '#111',
            fontSize: Math.max(9, Math.floor(size * 0.55)),
            fontWeight: 700,
            lineHeight: 1,
            textTransform: 'uppercase'
          }}
        >
          {provider.charAt(0)}
        </span>
      )}
      {isLoading && !isPulsating && (
        <div
          style={{
            position: 'absolute',
            inset: showBorder ? 1 : -2,
            borderRadius: '50%',
            border: '2px solid transparent',
            borderTopColor: accentColor,
            animation: 'spin 1s linear infinite'
          }}
        />
      )}
    </div>
  )
}
