import React, { useState, useEffect } from 'react'
import { OnboardingStepProps } from '../types'
import { getContainerStyle } from '../styles'
import { Check } from 'lucide-react'
import logoImage from '../../../../../../resources/logos/logo-big-no-bg.png'
import { desktopAppJson } from '../../../services/app-api-client'

// Import integration icons
import gmailIcon from '../../../../../../resources/logos/integrations/gmail-icon.png'
import calendarIcon from '../../../../../../resources/logos/integrations/google-calendar-icon.png'
import sheetsIcon from '../../../../../../resources/logos/integrations/sheets-icon.png'
import driveIcon from '../../../../../../resources/logos/integrations/google-drive-icon.png'

interface Integration {
  id: string
  composioId: 'gmail' | 'googlecalendar' | 'googlesheets' | 'googledrive'
  name: string
  icon: string
  connected: boolean
  connecting?: boolean
}

const INTEGRATIONS: Integration[] = [
  { id: 'gmail', composioId: 'gmail', name: 'Gmail', icon: gmailIcon, connected: false },
  {
    id: 'google-calendar',
    composioId: 'googlecalendar',
    name: 'Google Calendar',
    icon: calendarIcon,
    connected: false
  },
  {
    id: 'google-sheets',
    composioId: 'googlesheets',
    name: 'Google Sheets',
    icon: sheetsIcon,
    connected: false
  },
  {
    id: 'google-drive',
    composioId: 'googledrive',
    name: 'Google Drive',
    icon: driveIcon,
    connected: false
  }
]

interface IntegrationsResponse {
  connected?: string[]
}

interface IntegrationActionResponse {
  redirectUrl?: string | null
  connectionId?: string | null
}

export function IntegrationsSkillsStep({
  theme,
  isTransitioning
}: OnboardingStepProps): React.ReactElement {
  const containerStyle = getContainerStyle(theme, isTransitioning)
  const [integrations, setIntegrations] = useState<Integration[]>(INTEGRATIONS)

  useEffect(() => {
    const checkConnections = async (): Promise<void> => {
      try {
        const data = await desktopAppJson<IntegrationsResponse>('/api/v1/integrations')
        const connectedToolkits = new Set(
          (data.connected ?? []).map((toolkit) => toolkit.toLowerCase())
        )
        setIntegrations((prev) =>
          prev.map((item) => ({
            ...item,
            connected: connectedToolkits.has(item.composioId)
          }))
        )
      } catch (err) {
        console.error('Failed to check integrations:', err)
      }
    }
    void checkConnections()
  }, [])

  const handleConnect = async (integration: Integration): Promise<void> => {
    if (integration.connecting) return

    setIntegrations((prev) =>
      prev.map((item) => (item.id === integration.id ? { ...item, connecting: true } : item))
    )

    try {
      if (integration.connected) {
        await desktopAppJson('/api/v1/integrations', {
          method: 'POST',
          body: JSON.stringify({ action: 'disconnect', toolkit: integration.composioId })
        })
        setIntegrations((prev) =>
          prev.map((item) =>
            item.id === integration.id ? { ...item, connected: false, connecting: false } : item
          )
        )
      } else {
        const result = await desktopAppJson<IntegrationActionResponse>(
          '/api/v1/integrations',
          {
            method: 'POST',
            body: JSON.stringify({ action: 'connect', toolkit: integration.composioId })
          }
        )
        if (result.redirectUrl) {
          window.bridge?.openExternal?.(result.redirectUrl)
          for (let attempt = 0; attempt < 150; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 2000))
            const data = await desktopAppJson<IntegrationsResponse>('/api/v1/integrations')
            const connectedToolkits = new Set(
              (data.connected ?? []).map((toolkit) => toolkit.toLowerCase())
            )
            if (connectedToolkits.has(integration.composioId)) {
              setIntegrations((prev) =>
                prev.map((item) =>
                  item.id === integration.id
                    ? { ...item, connected: true, connecting: false }
                    : item
                )
              )
              return
            }
          }
        } else if (result.connectionId) {
          setIntegrations((prev) =>
            prev.map((item) =>
              item.id === integration.id ? { ...item, connected: true, connecting: false } : item
            )
          )
          return
        }
        setIntegrations((prev) =>
          prev.map((item) => (item.id === integration.id ? { ...item, connecting: false } : item))
        )
      }
    } catch {
      setIntegrations((prev) =>
        prev.map((item) => (item.id === integration.id ? { ...item, connecting: false } : item))
      )
    }
  }

  return (
    <div style={containerStyle}>
      <div
        style={{
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          maxWidth: '500px',
          width: '100%',
          padding: '0 24px'
        }}
      >
        <img
          src={logoImage}
          alt="Overlay Logo"
          style={{
            width: '48px',
            height: '48px',
            marginBottom: '16px',
            animation: 'unblur 0.8s ease forwards',
            opacity: 0
          }}
        />
        <h2
          style={{
            fontSize: '24px',
            fontWeight: 500,
            color: theme.text,
            margin: 0,
            marginBottom: '12px',
            animation: 'unblur 0.8s ease forwards',
            animationDelay: '0.1s',
            opacity: 0,
            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
          }}
        >
          connect your apps
        </h2>
        <p
          style={{
            fontSize: '14px',
            color: theme.textSecondary,
            margin: 0,
            marginBottom: '32px',
            animation: 'unblur 0.8s ease forwards',
            animationDelay: '0.2s',
            opacity: 0
          }}
        >
          enable integrations to extend agent capabilities
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '12px',
            width: '100%',
            // @ts-expect-error - webkit property for electron drag region
            WebkitAppRegion: 'no-drag'
          }}
        >
          {integrations.map((integration, index) => (
            <button
              key={integration.id}
              onClick={() => handleConnect(integration)}
              disabled={integration.connecting}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                padding: '20px',
                background: integration.connected ? `${theme.accent}10` : theme.surface,
                border: `1px solid ${integration.connected ? theme.accent : theme.border}`,
                borderRadius: '12px',
                cursor: integration.connecting ? 'wait' : 'pointer',
                transition: 'all 0.15s ease',
                animation: 'unblur 0.8s ease forwards',
                animationDelay: `${0.3 + index * 0.1}s`,
                opacity: 0
              }}
              onMouseEnter={(e) => {
                if (!integration.connecting) {
                  e.currentTarget.style.background = integration.connected
                    ? `${theme.accent}15`
                    : theme.border
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = integration.connected
                  ? `${theme.accent}10`
                  : theme.surface
              }}
            >
              <img
                src={integration.icon}
                alt={integration.name}
                style={{ width: '28px', height: '28px', objectFit: 'contain' }}
              />
              <span
                style={{
                  fontSize: '13px',
                  fontWeight: 500,
                  color: theme.text
                }}
              >
                {integration.name}
              </span>
              {integration.connected && (
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '11px',
                    color: theme.accent
                  }}
                >
                  <Check size={12} /> Connected
                </span>
              )}
              {integration.connecting && (
                <span style={{ fontSize: '11px', color: theme.textSecondary }}>Connecting...</span>
              )}
            </button>
          ))}
        </div>

        <p
          style={{
            fontSize: '12px',
            color: theme.textSecondary,
            marginTop: '24px',
            marginBottom: '24px',
            animation: 'unblur 0.8s ease forwards',
            animationDelay: '0.8s',
            opacity: 0
          }}
        >
          you can add more integrations and custom skills in settings
        </p>
      </div>
    </div>
  )
}
