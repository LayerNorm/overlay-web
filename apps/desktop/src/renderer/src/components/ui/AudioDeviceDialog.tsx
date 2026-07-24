import React, { useState, useEffect, useCallback } from 'react'
import { Theme, lightTheme } from '../../utils/theme'

const DIALOG_ANIMATION_DURATION = 150

interface AudioDevice {
  deviceId: string
  label: string
  kind: string
}

interface AudioDeviceDialogProps {
  isOpen: boolean
  onClose: () => void
  onSave: (deviceId: string, deviceLabel: string) => void
  currentDeviceId?: string
  title?: string
  theme?: Theme
}

export function AudioDeviceDialog({
  isOpen,
  onClose,
  onSave,
  currentDeviceId,
  title = 'Select audio input device:',
  theme = lightTheme
}: AudioDeviceDialogProps): React.ReactElement | null {
  const [devices, setDevices] = useState<AudioDevice[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(currentDeviceId || 'default')
  const [loading, setLoading] = useState<boolean>(true)

  useEffect(() => {
    if (!isOpen) {
      setDevices([])
      setSelectedDeviceId(currentDeviceId || 'default')
      setLoading(true)
      return
    }

    const getAudioDevices = async (): Promise<void> => {
      try {
        // First try to enumerate devices without requesting permission
        let deviceList = await navigator.mediaDevices.enumerateDevices()
        let audioInputDevices = deviceList.filter((device) => device.kind === 'audioinput')

        // If devices don't have labels, we need to request permission
        const needsPermission =
          audioInputDevices.length > 0 && audioInputDevices.every((d) => !d.label)

        if (needsPermission) {
          // Request microphone permission to get device labels
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
          // Immediately stop the stream - we only needed it for permission
          stream.getTracks().forEach((track) => track.stop())

          // Now enumerate devices again to get labels
          deviceList = await navigator.mediaDevices.enumerateDevices()
          audioInputDevices = deviceList.filter((device) => device.kind === 'audioinput')
        }

        setDevices(audioInputDevices)

        // Set selected device to current device if it exists, otherwise default
        if (currentDeviceId && audioInputDevices.some((d) => d.deviceId === currentDeviceId)) {
          setSelectedDeviceId(currentDeviceId)
        } else {
          setSelectedDeviceId('default')
        }
      } catch (error) {
        console.error('Failed to get audio devices:', error)
        setDevices([])
      } finally {
        setLoading(false)
      }
    }

    getAudioDevices()
  }, [isOpen, currentDeviceId])

  const handleSave = (): void => {
    const selectedDevice = devices.find((d) => d.deviceId === selectedDeviceId)
    const deviceLabel =
      selectedDevice?.label || (selectedDeviceId === 'default' ? 'Default' : 'Unknown Device')
    onSave(selectedDeviceId, deviceLabel)
    onClose()
  }

  const [isAnimating, setIsAnimating] = useState(false)
  const [shouldRender, setShouldRender] = useState(false)

  useEffect(() => {
    let timer: NodeJS.Timeout | undefined
    if (isOpen) {
      setShouldRender(true)
      requestAnimationFrame(() => setIsAnimating(true))
    } else {
      setIsAnimating(false)
      timer = setTimeout(() => setShouldRender(false), DIALOG_ANIMATION_DURATION)
    }
    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [isOpen])

  const handleCancel = useCallback(() => {
    onClose()
  }, [onClose])

  const handleDeviceSelect = (deviceId: string): void => {
    setSelectedDeviceId(deviceId)
  }

  if (!shouldRender) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: theme.scrim,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        opacity: isAnimating ? 1 : 0,
        transition: `opacity ${DIALOG_ANIMATION_DURATION}ms ease-out`,
        overflow: 'hidden'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleCancel()
      }}
    >
      <div
        style={{
          background: theme.modalBackground,
          borderRadius: '16px',
          padding: '32px',
          minWidth: '420px',
          maxWidth: '520px',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          gap: '20px',
          boxShadow: '0 24px 80px rgba(0, 0, 0, 0.35)',
          border: `1px solid ${theme.modalBorder}`,
          transform: isAnimating ? 'scale(1) translateY(0)' : 'scale(0.96) translateY(8px)',
          transition: `transform ${DIALOG_ANIMATION_DURATION}ms ease-out`
        }}
      >
        <h2
          style={{
            color: theme.text,
            fontSize: '18px',
            fontWeight: '600',
            margin: 0,
            textAlign: 'left',
            lineHeight: '1.4',
            fontFamily:
              'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
          }}
        >
          {title}
        </h2>

        <div
          style={{
            background: 'transparent',
            borderRadius: '16px',
            padding: '4px',
            width: '100%',
            maxHeight: '350px',
            overflowY: 'auto'
          }}
        >
          {loading ? (
            <div
              style={{
                color: theme.textSecondary,
                fontSize: '16px',
                textAlign: 'center',
                padding: '20px',
                fontFamily:
                  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
              }}
            >
              Loading audio devices...
            </div>
          ) : devices.length === 0 ? (
            <div
              style={{
                color: theme.textSecondary,
                fontSize: '16px',
                textAlign: 'center',
                padding: '20px',
                fontFamily:
                  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
              }}
            >
              No audio input devices found
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}
            >
              {devices.map((device) => (
                <div
                  key={device.deviceId}
                  onClick={() => handleDeviceSelect(device.deviceId)}
                  style={{
                    padding: '14px 20px',
                    borderRadius: '12px',
                    cursor: 'pointer',
                    background:
                      selectedDeviceId === device.deviceId ? theme.selectionBg : 'transparent',
                    border: `1px solid ${
                      selectedDeviceId === device.deviceId ? theme.text : theme.border
                    }`,
                    color: theme.text,
                    transition: 'background 0.15s ease, border-color 0.15s ease',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px'
                  }}
                  onMouseEnter={(e) => {
                    if (selectedDeviceId !== device.deviceId) {
                      e.currentTarget.style.background = theme.surface
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (selectedDeviceId !== device.deviceId) {
                      e.currentTarget.style.background = 'transparent'
                    }
                  }}
                >
                  <div
                    style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '50%',
                      border: `1.5px solid ${
                        selectedDeviceId === device.deviceId ? theme.text : theme.textDisabled
                      }`,
                      background: 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      transition: 'all 0.15s'
                    }}
                  >
                    {selectedDeviceId === device.deviceId && (
                      <div
                        style={{
                          width: '10px',
                          height: '10px',
                          borderRadius: '50%',
                          background: theme.text
                        }}
                      />
                    )}
                  </div>
                  <div
                    style={{
                      flex: 1,
                      fontSize: '14px',
                      fontWeight: '500',
                      fontFamily:
                        'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
                    }}
                  >
                    {device.label || `Microphone ${device.deviceId.slice(0, 8)}...`}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            gap: '12px',
            width: '100%'
          }}
        >
          <button
            onClick={handleCancel}
            style={{
              flex: 1,
              padding: '10px 16px',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 500,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              color: theme.text,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              transition: 'background 0.15s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = theme.border
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={devices.length === 0}
            style={{
              flex: 1,
              padding: '10px 16px',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 500,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              color: devices.length > 0 ? theme.toggleThumb : theme.textDisabled,
              background: devices.length > 0 ? theme.buttonBg : 'transparent',
              border: 'none',
              cursor: devices.length > 0 ? 'pointer' : 'not-allowed',
              opacity: devices.length > 0 ? 1 : 0.5,
              transition: 'background 0.15s ease'
            }}
            onMouseEnter={(e) => {
              if (devices.length > 0) e.currentTarget.style.background = theme.buttonHover
            }}
            onMouseLeave={(e) => {
              if (devices.length > 0) e.currentTarget.style.background = theme.buttonBg
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
