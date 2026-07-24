import React from 'react'
import { OnboardingStepProps } from '../types'
import { getContainerStyle } from '../styles'
import { Check, X, Zap, Crown, Sparkles } from 'lucide-react'
import { CUSTOM_AUTH_BASE_URL } from '../../../services/auth-service'

interface Feature {
  name: string
  included: boolean
  detail?: string
}

interface Tier {
  name: string
  price: string
  period: string
  description: string
  icon: typeof Zap
  features: Feature[]
  cta: string
  highlighted: boolean
}

const tiers: Tier[] = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    description: 'Get started with essential features',
    icon: Zap,
    features: [
      { name: 'Unlimited notes (non-AI)', included: true },
      { name: 'Unlimited browser (non-AI)', included: true },
      { name: '10 min cloud transcription/week', included: true },
      { name: '5 Ask messages/week', included: true },
      { name: '5 Agent messages/week', included: true },
      { name: 'Trinity Large + Auto models only', included: true },
      { name: 'Premium AI models', included: false }
    ],
    cta: 'Continue Free',
    highlighted: false
  },
  {
    name: 'Pro',
    price: '$20',
    period: '/month',
    description: 'For power users who need more',
    icon: Crown,
    features: [
      { name: 'Everything in Free', included: true },
      { name: 'Unlimited transcription', included: true },
      { name: 'Unlimited Trinity/Auto usage', included: true },
      { name: 'Premium AI models', included: true },
      { name: 'Usage tracking dashboard', included: true },
      { name: 'Cloud jobs (coming soon)', included: true }
    ],
    cta: 'Subscribe to Pro',
    highlighted: true
  },
  {
    name: 'Max',
    price: '$100',
    period: '/month',
    description: 'For heavy users',
    icon: Sparkles,
    features: [
      { name: 'Everything in Pro', included: true },
      { name: 'Premium AI models', included: true },
      { name: 'Advanced usage analytics', included: true },
      { name: '6x requests', included: true },
      { name: 'Early access to features', included: true }
    ],
    cta: 'Subscribe to Max',
    highlighted: false
  }
]

export function UpgradeStep({
  theme,
  onNext,
  isTransitioning
}: OnboardingStepProps): React.ReactElement {
  const containerStyle = getContainerStyle(theme, isTransitioning)

  const handleSelect = (tier: Tier): void => {
    if (tier.name === 'Free') {
      // Free tier - advance to next step
      onNext?.()
      return
    }
    // Pro/Max - open pricing page
    window.bridge?.openExternal?.(`${CUSTOM_AUTH_BASE_URL}/pricing`)
  }

  return (
    <div style={containerStyle}>
      <div
        style={{
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          maxWidth: '900px',
          width: '100%',
          padding: '0 24px'
        }}
      >
        <h2
          style={{
            fontSize: '28px',
            fontWeight: 500,
            color: theme.text,
            margin: 0,
            marginBottom: '8px',
            animation: 'unblur 0.8s ease forwards',
            animationDelay: '0.1s',
            opacity: 0,
            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
          }}
        >
          simple, transparent pricing
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
          start free, upgrade when you need more
        </p>

        <div
          style={{
            display: 'flex',
            gap: '16px',
            width: '100%',
            // @ts-expect-error - webkit property for electron drag region
            WebkitAppRegion: 'no-drag'
          }}
        >
          {tiers.map((tier, tierIndex) => {
            const Icon = tier.icon
            return (
              <div
                key={tier.name}
                style={{
                  flex: 1,
                  position: 'relative',
                  padding: '24px',
                  background: tier.highlighted ? theme.surface : 'transparent',
                  border: tier.highlighted
                    ? `2px solid ${theme.text}`
                    : `1px solid ${theme.border}`,
                  borderRadius: '16px',
                  textAlign: 'left',
                  transition: 'all 0.2s ease',
                  transform: tier.highlighted ? 'scale(1.02)' : 'scale(1)',
                  animation: 'unblur 0.8s ease forwards',
                  animationDelay: `${0.3 + tierIndex * 0.1}s`,
                  opacity: 0,
                  display: 'flex',
                  flexDirection: 'column'
                }}
              >
                {tier.highlighted && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '-12px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      background: theme.text,
                      color: theme.background,
                      fontSize: '11px',
                      fontWeight: 500,
                      padding: '4px 12px',
                      borderRadius: '12px'
                    }}
                  >
                    Most Popular
                  </div>
                )}

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    marginBottom: '12px'
                  }}
                >
                  <div
                    style={{
                      padding: '8px',
                      borderRadius: '8px',
                      background: tier.highlighted ? theme.text : theme.border,
                      color: tier.highlighted ? theme.background : theme.textSecondary,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    <Icon size={18} />
                  </div>
                  <span style={{ fontSize: '18px', fontWeight: 500, color: theme.text }}>
                    {tier.name}
                  </span>
                </div>

                <div style={{ marginBottom: '8px' }}>
                  <span style={{ fontSize: '36px', fontWeight: 600, color: theme.text }}>
                    {tier.price}
                  </span>
                  <span style={{ fontSize: '14px', color: theme.textSecondary, marginLeft: '4px' }}>
                    {tier.period}
                  </span>
                </div>

                <p style={{ fontSize: '13px', color: theme.textSecondary, margin: '0 0 16px 0' }}>
                  {tier.description}
                </p>

                <ul style={{ margin: '0 0 20px 0', padding: 0, listStyle: 'none', flex: 1 }}>
                  {tier.features.map((feature, idx) => (
                    <li
                      key={idx}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '8px',
                        marginBottom: '8px'
                      }}
                    >
                      {feature.included ? (
                        <Check
                          size={14}
                          style={{ marginTop: '2px', flexShrink: 0, color: '#10b981' }}
                        />
                      ) : (
                        <X
                          size={14}
                          style={{
                            marginTop: '2px',
                            flexShrink: 0,
                            color: theme.textSecondary,
                            opacity: 0.5
                          }}
                        />
                      )}
                      <span
                        style={{
                          fontSize: '12px',
                          color: feature.included ? theme.text : theme.textSecondary,
                          opacity: feature.included ? 1 : 0.6
                        }}
                      >
                        {feature.name}
                        {feature.detail && (
                          <span style={{ color: theme.textSecondary, marginLeft: '4px' }}>
                            ({feature.detail})
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => handleSelect(tier)}
                  style={{
                    width: '100%',
                    padding: '10px 16px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 500,
                    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    background: tier.highlighted ? theme.text : theme.border,
                    color: tier.highlighted ? theme.background : theme.text,
                    marginTop: 'auto'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = '0.85'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = '1'
                  }}
                >
                  {tier.cta}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
