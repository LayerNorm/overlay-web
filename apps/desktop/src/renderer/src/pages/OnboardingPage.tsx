import React, { useEffect, useMemo, useState } from 'react'
import { useSettings } from '../hooks/useSettings'
import { useOnboarding } from '../hooks/useOnboarding'
import { useSubscription } from '../hooks/useSubscription'
import { getTheme } from '../utils/theme'
import {
  onboardingKeyframes,
  getSecondaryButtonStyle,
  applySecondaryButtonHover,
  resetSecondaryButtonHover,
  getButtonStyle,
  applyButtonHover,
  resetButtonHover
} from '../components/onboarding/styles'
import { OnboardingStep } from '../components/onboarding/types'
import {
  WelcomeStep,
  AllInOneStep,
  NameStep,
  AuthStep,
  ControlPanelStep,
  PermissionsStep,
  TestTranscriptionStep,
  ShortcutNotebookStep,
  ShortcutChatStep,
  ShortcutBrowserStep,
  ShortcutAgentStep,
  IntegrationsSkillsStep,
  UpgradeStep,
  GetStartedStep
} from '../components/onboarding/steps'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface OnboardingPageProps {
  onComplete: () => void
  startAtAuth?: boolean
}

const STEP_ORDER: OnboardingStep[] = [
  'welcome',
  'name',
  'auth',
  'all-in-one',
  'control-panel',
  'permissions',
  'test-transcription',
  'shortcut-notebook',
  'shortcut-chat',
  'shortcut-browser',
  'shortcut-agent',
  'integrations-skills',
  'upgrade',
  'get-started'
]

// Steps where navigation buttons should be hidden
const STEPS_WITHOUT_NAV = ['welcome', 'auth', 'all-in-one']

export function OnboardingPage({
  onComplete,
  startAtAuth = false
}: OnboardingPageProps): React.ReactElement<any> | null {
  const { settings, updateSetting } = useSettings()
  const theme = getTheme(settings.darkMode, settings.lightThemePreset, settings.darkThemePreset)
  const subscription = useSubscription()
  const { step, isTransitioning, transitionTo } = useOnboarding({ startAtAuth, onComplete })
  const [isNameValid, setIsNameValid] = useState(false)

  // Determine if we should skip the upgrade step (user already has a paid subscription)
  const hasPaidSubscription = subscription.tier === 'pro' || subscription.tier === 'max'

  // Compute effective step order based on subscription status
  const effectiveStepOrder = useMemo(() => {
    if (hasPaidSubscription) {
      // Skip 'upgrade' step for users with paid subscriptions
      return STEP_ORDER.filter((s) => s !== 'upgrade')
    }
    return STEP_ORDER
  }, [hasPaidSubscription])

  // Inject keyframes
  useEffect(() => {
    const styleEl = document.createElement('style')
    styleEl.textContent = onboardingKeyframes
    document.head.appendChild(styleEl)
    return () => {
      document.head.removeChild(styleEl)
    }
  }, [])

  // Handle hotkey updates for chat panel
  const handleChatHotkeyChange = (hotkey: string): void => {
    updateSetting('chatPanelHotkey', hotkey)
    window.bridge?.updateChatPanelHotkey?.(hotkey)
  }

  // Handle hotkey updates for notebook panel
  const handleNotebookHotkeyChange = (hotkey: string): void => {
    updateSetting('notebookPanelHotkey', hotkey)
    window.bridge?.updateNotebookPanelHotkey?.(hotkey)
  }

  // Handle hotkey updates for browser panel
  const handleBrowserHotkeyChange = (hotkey: string): void => {
    updateSetting('browserPanelHotkey', hotkey)
    window.bridge?.updateBrowserPanelHotkey?.(hotkey)
  }

  // Handle hotkey updates for agent
  const handleAgentHotkeyChange = (hotkey: string): void => {
    updateSetting('assistantModeHotkey', hotkey)
    window.bridge?.updateAssistantModeHotkey?.(hotkey)
  }

  const currentIndex = effectiveStepOrder.indexOf(step)
  const canGoBack = currentIndex > 0 && !STEPS_WITHOUT_NAV.includes(step)
  const canGoNext =
    currentIndex < effectiveStepOrder.length - 1 &&
    !STEPS_WITHOUT_NAV.includes(step) &&
    (step !== 'name' || isNameValid)
  const isLastStep = step === 'get-started'

  const goBack = (): void => {
    if (canGoBack) {
      transitionTo(effectiveStepOrder[currentIndex - 1])
    }
  }

  const goNext = (): void => {
    if (canGoNext) {
      transitionTo(effectiveStepOrder[currentIndex + 1])
    }
  }

  const secondaryButtonStyle = getSecondaryButtonStyle(theme)
  const primaryButtonStyle = getButtonStyle(theme)

  // Navigation buttons component
  const NavigationButtons = (): React.ReactElement<any> | null => {
    if (STEPS_WITHOUT_NAV.includes(step) || isLastStep) return null

    return (
      <div
        style={{
          position: 'fixed',
          bottom: '32px',
          left: '32px',
          right: '32px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          // @ts-expect-error - webkit property for electron drag region
          WebkitAppRegion: 'no-drag'
        }}
      >
        {canGoBack ? (
          <button
            onClick={goBack}
            style={{
              ...secondaryButtonStyle,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              opacity: 1
            }}
            onMouseEnter={(e) => applySecondaryButtonHover(e, theme)}
            onMouseLeave={(e) => resetSecondaryButtonHover(e)}
          >
            <ChevronLeft size={16} />
            back
          </button>
        ) : (
          <div />
        )}
        {canGoNext && (
          <button
            onClick={goNext}
            style={{
              ...primaryButtonStyle,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              opacity: 1,
              animation: 'none'
            }}
            onMouseEnter={(e) => applyButtonHover(e, theme)}
            onMouseLeave={(e) => resetButtonHover(e, theme)}
          >
            next
            <ChevronRight size={16} />
          </button>
        )}
      </div>
    )
  }

  // Render the current step
  const renderStep = (): React.ReactElement<any> | null => {
    switch (step) {
      case 'welcome':
        return (
          <WelcomeStep
            theme={theme}
            onNext={() => transitionTo('name')}
            isTransitioning={isTransitioning}
          />
        )

      case 'name':
        return (
          <NameStep
            theme={theme}
            onNext={() => transitionTo('auth')}
            isTransitioning={isTransitioning}
            onNameValidChange={setIsNameValid}
          />
        )

      case 'auth':
        return (
          <AuthStep
            theme={theme}
            onNext={() => transitionTo('all-in-one')}
            isTransitioning={isTransitioning}
          />
        )

      case 'all-in-one':
        return (
          <AllInOneStep
            theme={theme}
            onNext={() => transitionTo('control-panel')}
            isTransitioning={isTransitioning}
          />
        )

      case 'control-panel':
        return <ControlPanelStep theme={theme} onNext={goNext} isTransitioning={isTransitioning} />

      case 'permissions':
        return (
          <PermissionsStep
            theme={theme}
            onNext={() => transitionTo('test-transcription')}
            isTransitioning={isTransitioning}
          />
        )

      case 'test-transcription':
        return (
          <TestTranscriptionStep
            theme={theme}
            onNext={() => transitionTo('shortcut-notebook')}
            isTransitioning={isTransitioning}
            pushToTalkHotkey={settings.pushToTalkHotkey}
          />
        )

      case 'shortcut-notebook':
        return (
          <ShortcutNotebookStep
            theme={theme}
            onNext={() => transitionTo('shortcut-chat')}
            isTransitioning={isTransitioning}
            initialHotkey={settings.notebookPanelHotkey || 'Cmd ⌘ + /'}
            onHotkeyChange={handleNotebookHotkeyChange}
          />
        )

      case 'shortcut-chat':
        return (
          <ShortcutChatStep
            theme={theme}
            onNext={() => transitionTo('shortcut-browser')}
            isTransitioning={isTransitioning}
            initialHotkey={settings.chatPanelHotkey || 'Cmd ⌘ + .'}
            onHotkeyChange={handleChatHotkeyChange}
          />
        )

      case 'shortcut-browser':
        return (
          <ShortcutBrowserStep
            theme={theme}
            onComplete={() => transitionTo('shortcut-agent')}
            isTransitioning={isTransitioning}
            initialHotkey={settings.browserPanelHotkey || 'Cmd ⌘ + \\'}
            onHotkeyChange={handleBrowserHotkeyChange}
          />
        )

      case 'shortcut-agent':
        return (
          <ShortcutAgentStep
            theme={theme}
            onNext={() => transitionTo('integrations-skills')}
            isTransitioning={isTransitioning}
            initialHotkey={settings.assistantModeHotkey || 'Ctrl ⌃ + A'}
            onHotkeyChange={handleAgentHotkeyChange}
          />
        )

      case 'integrations-skills':
        return (
          <IntegrationsSkillsStep theme={theme} onNext={goNext} isTransitioning={isTransitioning} />
        )

      case 'upgrade':
        return <UpgradeStep theme={theme} onNext={goNext} isTransitioning={isTransitioning} />

      case 'get-started':
        return (
          <GetStartedStep
            theme={theme}
            onNext={onComplete}
            isTransitioning={isTransitioning}
            onComplete={onComplete}
          />
        )

      default:
        return null
    }
  }

  return (
    <>
      {renderStep()}
      <NavigationButtons />
    </>
  )
}
