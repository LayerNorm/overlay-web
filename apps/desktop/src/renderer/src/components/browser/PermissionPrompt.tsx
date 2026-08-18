import { useState, ReactElement } from 'react'
import { MapPin, Bell, Camera, Mic, Clipboard, Music, MousePointer, X } from 'lucide-react'

export type PermissionType =
  | 'geolocation'
  | 'notifications'
  | 'media'
  | 'mediaKeySystem'
  | 'midi'
  | 'midiSysex'
  | 'pointerLock'
  | 'fullscreen'
  | 'openExternal'
  | 'clipboard-read'
  | 'clipboard-sanitized-write'
  | 'window-management'
  | 'display-capture'
  | 'idle-detection'
  | 'storage-access'
  | 'speaker-selection'

export interface PermissionRequest {
  id: string
  permission: PermissionType
  origin: string
  requestingUrl: string
}

interface PermissionPromptProps {
  request: PermissionRequest | null
  onAllow: (id: string, remember: boolean) => void
  onDeny: (id: string, remember: boolean) => void
  theme: {
    background: string
    surface: string
    text: string
    textSecondary: string
    border: string
    accent: string
  }
}

const permissionConfig: Record<
  PermissionType,
  { icon: typeof MapPin; label: string; description: string }
> = {
  geolocation: {
    icon: MapPin,
    label: 'Location',
    description: 'wants to know your location'
  },
  notifications: {
    icon: Bell,
    label: 'Notifications',
    description: 'wants to show notifications'
  },
  media: {
    icon: Camera,
    label: 'Camera & Microphone',
    description: 'wants to use your camera and microphone'
  },
  mediaKeySystem: {
    icon: Music,
    label: 'Protected Content',
    description: 'wants to play protected content'
  },
  midi: {
    icon: Music,
    label: 'MIDI Devices',
    description: 'wants to access your MIDI devices'
  },
  midiSysex: {
    icon: Music,
    label: 'MIDI System Exclusive',
    description: 'wants full control of your MIDI devices'
  },
  pointerLock: {
    icon: MousePointer,
    label: 'Pointer Lock',
    description: 'wants to lock your mouse pointer'
  },
  fullscreen: {
    icon: MousePointer,
    label: 'Fullscreen',
    description: 'wants to enter fullscreen mode'
  },
  openExternal: {
    icon: MousePointer,
    label: 'Open External App',
    description: 'wants to open an external application'
  },
  'clipboard-read': {
    icon: Clipboard,
    label: 'Clipboard Read',
    description: 'wants to read your clipboard'
  },
  'clipboard-sanitized-write': {
    icon: Clipboard,
    label: 'Clipboard Write',
    description: 'wants to write to your clipboard'
  },
  'window-management': {
    icon: MousePointer,
    label: 'Window Management',
    description: 'wants to manage windows'
  },
  'display-capture': {
    icon: Camera,
    label: 'Screen Capture',
    description: 'wants to capture your screen'
  },
  'idle-detection': {
    icon: MousePointer,
    label: 'Idle Detection',
    description: 'wants to know when you are idle'
  },
  'storage-access': {
    icon: Clipboard,
    label: 'Storage Access',
    description: 'wants to access storage'
  },
  'speaker-selection': {
    icon: Mic,
    label: 'Speaker Selection',
    description: 'wants to select audio output'
  }
}

export const PERMISSION_BAR_HEIGHT = 44

export function PermissionPrompt({
  request,
  onAllow,
  onDeny,
  theme
}: PermissionPromptProps): ReactElement<any> | null {
  const [rememberChoice, setRememberChoice] = useState(false)

  if (!request) return null

  const config = permissionConfig[request.permission] || {
    icon: Bell,
    label: request.permission,
    description: `wants ${request.permission} permission`
  }

  const Icon = config.icon
  const hostname = new URL(request.requestingUrl).hostname

  const handleAllow = (): void => {
    onAllow(request.id, rememberChoice)
    setRememberChoice(false)
  }

  const handleDeny = (): void => {
    onDeny(request.id, rememberChoice)
    setRememberChoice(false)
  }

  // Bottom status bar style - renders ABOVE the WebContentsView area
  return (
    <div
      style={{
        height: PERMISSION_BAR_HEIGHT,
        background: theme.surface,
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        gap: 12,
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 6,
          background: `${theme.accent}20`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0
        }}
      >
        <Icon size={14} color={theme.accent} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>{hostname}</span>
        <span style={{ fontSize: 13, color: theme.textSecondary, marginLeft: 6 }}>
          {config.description}
        </span>
      </div>

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          cursor: 'pointer',
          fontSize: 12,
          color: theme.textSecondary,
          flexShrink: 0
        }}
      >
        <input
          type="checkbox"
          checked={rememberChoice}
          onChange={(e) => setRememberChoice(e.target.checked)}
          style={{ width: 12, height: 12, cursor: 'pointer' }}
        />
        Remember
      </label>

      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <button
          onClick={handleDeny}
          style={{
            padding: '5px 12px',
            borderRadius: 6,
            border: `1px solid ${theme.border}`,
            background: 'transparent',
            color: theme.text,
            fontSize: 12,
            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
            fontWeight: 500,
            cursor: 'pointer'
          }}
        >
          Block
        </button>
        <button
          onClick={handleAllow}
          style={{
            padding: '5px 12px',
            borderRadius: 6,
            border: 'none',
            background: theme.accent,
            color: theme.background,
            fontSize: 12,
            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
            fontWeight: 500,
            cursor: 'pointer'
          }}
        >
          Allow
        </button>
      </div>

      <button
        onClick={handleDeny}
        style={{
          width: 20,
          height: 20,
          borderRadius: 4,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: 0.6,
          flexShrink: 0
        }}
        title="Dismiss"
      >
        <X size={12} color={theme.textSecondary} />
      </button>
    </div>
  )
}
