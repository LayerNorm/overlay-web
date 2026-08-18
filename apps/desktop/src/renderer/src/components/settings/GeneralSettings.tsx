import { SettingsRow } from '../ui/SettingsRow'
import { Toggle } from '../ui/Toggle'
import { AudioDeviceDialog } from '../ui/AudioDeviceDialog'
import { Settings } from '../../hooks/useSettings'
import { DARK_PRESETS, LIGHT_PRESETS, Theme, type ThemePresetId } from '../../utils/theme'
import { useState, useEffect, useCallback, ReactElement } from 'react'

interface GeneralSettingsProps {
  settings: Settings
  onUpdateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  theme: Theme
}

export function GeneralSettings({
  settings,
  onUpdateSetting,
  theme
}: GeneralSettingsProps): ReactElement<any> {
  const [isDeviceDialogOpen, setIsDeviceDialogOpen] = useState(false)
  const [selectedDeviceName, setSelectedDeviceName] = useState('Default')
  const [launchAtStartup, setLaunchAtStartup] = useState(false)

  // Load launch at startup setting
  const loadLaunchAtStartup = useCallback(async () => {
    if (window.bridge?.getLaunchAtStartup) {
      const enabled = await window.bridge.getLaunchAtStartup()
      setLaunchAtStartup(enabled)
    }
  }, [])

  useEffect(() => {
    loadLaunchAtStartup()
  }, [loadLaunchAtStartup])

  const handleLaunchAtStartupChange = async (val: boolean): Promise<void> => {
    setLaunchAtStartup(val)
    if (window.bridge?.setLaunchAtStartup) {
      await window.bridge.setLaunchAtStartup(val)
    }
  }

  // Initialize device name on component mount (only once, without activating microphone)
  useEffect(() => {
    // Only set device name if we haven't already set it from a previous selection
    if (selectedDeviceName === 'Default' && settings.inputDevice !== 'default') {
      // Try to get device label without requesting microphone access
      // This will only work if we already have permission
      navigator.mediaDevices
        .enumerateDevices()
        .then((deviceList) => {
          const device = deviceList.find(
            (d) => d.deviceId === settings.inputDevice && d.kind === 'audioinput'
          )
          if (device?.label) {
            setSelectedDeviceName(device.label)
          }
        })
        .catch(() => {
          // Silently fail - we'll get the device name when the dialog is opened
        })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Empty dependency array means this runs only once on mount

  const handleAutoMuteChange = (val: boolean): void => {
    onUpdateSetting('autoMute', val)
    void window.bridge?.updateAutoMute?.(val)
  }

  const handleSoundEffectsChange = (val: boolean): void => {
    onUpdateSetting('soundEffects', val)
    void window.bridge?.updateSoundEffects?.(val)
  }

  const handleInputDeviceClick = (): void => {
    setIsDeviceDialogOpen(true)
  }

  const handleInputDeviceSave = (deviceId: string, deviceLabel: string): void => {
    onUpdateSetting('inputDevice', deviceId)
    if (window.bridge?.updateInputDevice) {
      window.bridge.updateInputDevice(deviceId)
    }

    // Update the displayed device name immediately
    setSelectedDeviceName(deviceLabel)
  }

  const renderPresetSelect = (
    value: ThemePresetId,
    presets: typeof LIGHT_PRESETS,
    onChange: (value: ThemePresetId) => void
  ): ReactElement<any> => {
    const active = presets.find((preset) => preset.id === value)
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {active && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              border: `1px solid ${theme.border}`,
              borderRadius: 7,
              padding: '5px 7px',
              background: theme.surface
            }}
          >
            <span
              style={{
                width: 13,
                height: 13,
                borderRadius: 999,
                border: `1px solid ${theme.border}`,
                background: active.previewColors.background
              }}
            />
            <span
              style={{
                width: 13,
                height: 13,
                borderRadius: 999,
                border: `1px solid ${theme.border}`,
                background: active.previewColors.accent
              }}
            />
          </div>
        )}
        <select
          value={value}
          onChange={(event) => onChange(event.target.value as ThemePresetId)}
          style={{
            height: 32,
            minWidth: 160,
            borderRadius: 8,
            border: `1px solid ${theme.border}`,
            background: theme.surface,
            color: theme.text,
            outline: 'none',
            padding: '0 10px',
            fontSize: 13,
            fontFamily: 'system-ui, -apple-system, sans-serif'
          }}
        >
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </select>
      </div>
    )
  }

  return (
    <>
      <div>
        <SettingsRow
          title="Sound Effects"
          description="Play audio feedback for recording and typing"
          theme={theme}
        >
          <Toggle
            checked={settings.soundEffects}
            onChange={handleSoundEffectsChange}
            theme={theme}
          />
        </SettingsRow>

        <SettingsRow
          title="Auto-Mute System"
          description="Mute system volume during recording"
          theme={theme}
        >
          <Toggle checked={settings.autoMute} onChange={handleAutoMuteChange} theme={theme} />
        </SettingsRow>

        <SettingsRow title="Dark Mode" description="Use dark theme for the interface" theme={theme}>
          <Toggle
            checked={settings.darkMode}
            onChange={(val) => onUpdateSetting('darkMode', val)}
            theme={theme}
          />
        </SettingsRow>

        <SettingsRow
          title="Light Theme"
          description="Choose the web app theme preset used in light mode"
          theme={theme}
        >
          {renderPresetSelect(settings.lightThemePreset, LIGHT_PRESETS, (value) =>
            onUpdateSetting('lightThemePreset', value)
          )}
        </SettingsRow>

        <SettingsRow
          title="Dark Theme"
          description="Choose the web app theme preset used in dark mode"
          theme={theme}
        >
          {renderPresetSelect(settings.darkThemePreset, DARK_PRESETS, (value) =>
            onUpdateSetting('darkThemePreset', value)
          )}
        </SettingsRow>

        <SettingsRow
          title="Dynamic Opacity"
          description="Reduce window opacity when clicking outside panels"
          theme={theme}
        >
          <Toggle
            checked={settings.dynamicOpacity}
            onChange={(val) => onUpdateSetting('dynamicOpacity', val)}
            theme={theme}
          />
        </SettingsRow>

        <SettingsRow
          title="Launch at Startup"
          description="Automatically start overlay when your computer starts"
          theme={theme}
        >
          <Toggle checked={launchAtStartup} onChange={handleLaunchAtStartupChange} theme={theme} />
        </SettingsRow>

        <SettingsRow
          title="Snap to Edges"
          description="Panels dock to screen edges when dragged nearby"
          theme={theme}
        >
          <Toggle
            checked={settings.snapToEdges}
            onChange={(val) => onUpdateSetting('snapToEdges', val)}
            theme={theme}
          />
        </SettingsRow>

        <SettingsRow
          title="Float Pill Above Dock"
          description="Keep the overlay pill above the system dock when docked to the bottom"
          theme={theme}
        >
          <Toggle
            checked={settings.floatPillAboveDock}
            onChange={(val) => onUpdateSetting('floatPillAboveDock', val)}
            theme={theme}
          />
        </SettingsRow>

        <SettingsRow
          title="Show Panels On Startup"
          description="Reopen chat, notebook, and browser panels when the app launches"
          theme={theme}
        >
          <Toggle
            checked={settings.showPanelsOnStartup}
            onChange={(val) => onUpdateSetting('showPanelsOnStartup', val)}
            theme={theme}
          />
        </SettingsRow>

        <SettingsRow
          title="Share Anonymous Diagnostics"
          description="Send redacted crash reports and aggregate usage counters"
          theme={theme}
        >
          <Toggle
            checked={settings.analyticsConsentEnabled}
            onChange={(val) => onUpdateSetting('analyticsConsentEnabled', val)}
            theme={theme}
          />
        </SettingsRow>

        <SettingsRow
          title="Show Notifications"
          description="Display notifications when agent jobs complete"
          theme={theme}
        >
          <Toggle
            checked={settings.showNotifications}
            onChange={(val) => onUpdateSetting('showNotifications', val)}
            theme={theme}
          />
        </SettingsRow>

        <SettingsRow
          title="Notification Sound"
          description="Play a sound when notifications appear"
          theme={theme}
        >
          <Toggle
            checked={settings.notificationSound}
            onChange={(val) => onUpdateSetting('notificationSound', val)}
            theme={theme}
            disabled={!settings.showNotifications}
          />
        </SettingsRow>

        <SettingsRow
          title="Keep Microphone Warm"
          description="Faster starts; no audio stored. macOS shows microphone activity."
          theme={theme}
        >
          <Toggle
            checked={settings.keepMicrophoneWarm}
            onChange={(val) => onUpdateSetting('keepMicrophoneWarm', val)}
            theme={theme}
          />
        </SettingsRow>

        <SettingsRow
          title="Auto-Dismiss Delay"
          description="Seconds before notifications automatically close"
          theme={theme}
        >
          <input
            type="number"
            min={1}
            max={30}
            value={settings.notificationAutoDismissSeconds}
            onChange={(e) => {
              const val = Math.max(1, Math.min(30, parseInt(e.target.value) || 3))
              onUpdateSetting('notificationAutoDismissSeconds', val)
            }}
            disabled={!settings.showNotifications}
            style={{
              width: 60,
              padding: '6px 10px',
              borderRadius: 8,
              border: `1px solid ${theme.border}`,
              background: theme.surface,
              color: theme.text,
              fontSize: 13,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              textAlign: 'center',
              opacity: settings.showNotifications ? 1 : 0.5
            }}
          />
        </SettingsRow>

        <SettingsRow
          title="Input Device"
          description="Select microphone for recording"
          theme={theme}
        >
          <button
            onClick={handleInputDeviceClick}
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              fontSize: '13px',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              color: theme.text,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              transition: 'background 0.15s ease',
              textDecoration: 'underline',
              textDecorationThickness: '2px',
              textUnderlineOffset: '3px',
              maxWidth: '200px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = theme.border
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            {selectedDeviceName}
          </button>
        </SettingsRow>

        <SettingsRow
          title="Data Location"
          description="Access your app data and recordings"
          theme={theme}
        >
          <button
            onClick={() => {
              if (window.bridge?.openModelsFolder) {
                window.bridge.openModelsFolder()
              }
            }}
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              fontSize: '13px',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              color: theme.text,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              transition: 'background 0.15s ease',
              textDecoration: 'underline',
              textDecorationThickness: '2px',
              textUnderlineOffset: '3px'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = theme.border
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            Open Folder
          </button>
        </SettingsRow>
      </div>

      <AudioDeviceDialog
        isOpen={isDeviceDialogOpen}
        onClose={() => setIsDeviceDialogOpen(false)}
        onSave={handleInputDeviceSave}
        currentDeviceId={settings.inputDevice}
        theme={theme}
      />
    </>
  )
}
