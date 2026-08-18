import React, { useState, useEffect, useRef } from 'react'
import { OnboardingStepProps } from '../types'
import { getContainerStyle } from '../styles'

export function AllInOneStep({
  theme,
  onNext,
  isTransitioning
}: OnboardingStepProps): React.ReactElement<any> {
  const containerStyle = getContainerStyle(theme, isTransitioning)
  // Phases: 0-3 for AllInOne content, 4-5 for ReduceFriction content, 6 = done
  const [phase, setPhase] = useState<number>(0)
  const hasAdvancedRef = useRef(false)

  useEffect(() => {
    // Combined seamless animation timeline:
    // Phase 0: Show "everything you need from ai" (initial)
    // Phase 1: Start fading out intro (after 1.5s)
    // Phase 2: Show features (after 2s)
    // Phase 3: Show "powered by voice" (after 2.5s)
    // Phase 4: Transition to "reduce friction" (after 4s)
    // Phase 5: Show "reduce your work" (after 6s)
    // Phase 6: Auto-advance to next step (after 8s)
    const timers = [
      setTimeout(() => setPhase(1), 1500),
      setTimeout(() => setPhase(2), 2000),
      setTimeout(() => setPhase(3), 2500),
      setTimeout(() => setPhase(4), 4000),
      setTimeout(() => setPhase(5), 6000),
      setTimeout(() => setPhase(6), 8000)
    ]
    return () => timers.forEach(clearTimeout)
  }, [])

  // Auto-advance when phase 6 is reached
  useEffect(() => {
    if (phase === 6 && !hasAdvancedRef.current) {
      hasAdvancedRef.current = true
      onNext()
    }
  }, [phase, onNext])

  return (
    <div style={containerStyle}>
      <style>
        {`
          @keyframes blurFadeIn {
            0% {
              opacity: 0;
              filter: blur(12px);
              transform: scale(0.95);
            }
            100% {
              opacity: 1;
              filter: blur(0);
              transform: scale(1);
            }
          }
          @keyframes blurFadeOut {
            0% {
              opacity: 1;
              filter: blur(0);
              transform: scale(1);
            }
            100% {
              opacity: 0;
              filter: blur(12px);
              transform: scale(0.95);
            }
          }
        `}
      </style>
      <div
        style={{
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          maxWidth: '500px',
          minHeight: '150px',
          position: 'relative'
        }}
      >
        {/* Phase 0-3: AllInOne content */}
        {phase < 4 && (
          <>
            {/* Intro text - fades in then fades out smoothly */}
            <h2
              style={{
                fontSize: '32px',
                fontWeight: 400,
                fontFamily: "'Libre Baskerville', Georgia, serif",
                color: theme.text,
                margin: 0,
                position: 'absolute',
                pointerEvents: phase >= 1 ? 'none' : 'auto',
                animation:
                  phase >= 1 ? 'blurFadeOut 0.6s ease forwards' : 'blurFadeIn 0.8s ease forwards'
              }}
            >
              everything you need from ai
            </h2>

            {/* Features container - fades in */}
            <div
              style={{
                opacity: phase >= 2 ? 1 : 0,
                transform: phase >= 2 ? 'translateY(0)' : 'translateY(15px)',
                transition: 'opacity 0.6s ease-out, transform 0.6s ease-out',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center'
              }}
            >
              <p
                style={{
                  fontSize: '28px',
                  fontFamily: "'Libre Baskerville', Georgia, serif",
                  color: theme.textSecondary,
                  margin: 0,
                  marginBottom: '20px',
                  lineHeight: 1.5,
                  letterSpacing: '0.02em'
                }}
              >
                chat + notes + browser + agents
              </p>
              <p
                style={{
                  fontSize: '20px',
                  fontFamily: "'Libre Baskerville', Georgia, serif",
                  color: theme.accent,
                  margin: 0,
                  fontWeight: 500,
                  opacity: phase >= 3 ? 1 : 0,
                  transform: phase >= 3 ? 'translateY(0)' : 'translateY(8px)',
                  transition: 'opacity 0.5s ease-out 0.1s, transform 0.5s ease-out 0.1s'
                }}
              >
                powered by voice
              </p>
            </div>
          </>
        )}

        {/* Phase 4-5: ReduceFriction content */}
        {phase >= 4 && (
          <>
            <h2
              style={{
                fontSize: '32px',
                fontWeight: 400,
                fontFamily: "'Libre Baskerville', Georgia, serif",
                color: theme.text,
                margin: 0,
                marginBottom: '16px',
                position: 'absolute',
                animation:
                  phase >= 5 ? 'blurFadeOut 0.8s ease forwards' : 'blurFadeIn 0.8s ease forwards',
                whiteSpace: 'nowrap'
              }}
            >
              reduce the friction in your work
            </h2>
            <h2
              style={{
                fontSize: '32px',
                fontWeight: 400,
                fontFamily: "'Libre Baskerville', Georgia, serif",
                color: theme.text,
                margin: 0,
                marginBottom: '16px',
                opacity: 0,
                animation: phase >= 5 ? 'blurFadeIn 0.8s ease 0.3s forwards' : 'none'
              }}
            >
              reduce your work
            </h2>
          </>
        )}
      </div>
    </div>
  )
}
