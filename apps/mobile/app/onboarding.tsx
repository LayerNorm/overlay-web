import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  Linking
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Audio } from 'expo-av'
import { Feather } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useTheme } from '../hooks/useTheme'
import { borderRadius, fontSize, spacing } from '../constants/theme'
import {
  completeOnboarding,
  getOnboardingState,
  setOnboardingDisplayName
} from '../services/onboardingStorage'
import { useAuth } from '../contexts/AuthContext'
import { AuthPanel } from '../components/auth/AuthPanel'

type OnboardingStepId =
  | 'welcome'
  | 'name'
  | 'auth'
  | 'all-in-one'
  | 'control-panel'
  | 'permissions'
  | 'test-transcription'
  | 'shortcut-notebook'
  | 'shortcut-chat'
  | 'shortcut-browser'
  | 'shortcut-agent'
  | 'integrations-skills'
  | 'upgrade'
  | 'get-started'

interface OnboardingStepConfig {
  id: OnboardingStepId
  eyebrow: string
  title: string
  description: string
  icon: keyof typeof Feather.glyphMap
}

const ONBOARDING_STEPS: OnboardingStepConfig[] = [
  {
    id: 'welcome',
    eyebrow: 'Welcome',
    title: 'Overlay on mobile',
    description: 'A guided setup inspired by the desktop onboarding flow.',
    icon: 'zap'
  },
  {
    id: 'name',
    eyebrow: 'Profile',
    title: 'Make it yours',
    description: 'We will use your name in onboarding copy and later personalization.',
    icon: 'user'
  },
  {
    id: 'auth',
    eyebrow: 'Account',
    title: 'Sign in to Overlay',
    description: 'Use the same hosted auth flow as desktop so your mobile session lands in the same account and Convex profile.',
    icon: 'shield'
  },
  {
    id: 'all-in-one',
    eyebrow: 'All In One',
    title: 'Notes, chat, and voice',
    description: 'Overlay keeps the same workspace philosophy on mobile.',
    icon: 'layers'
  },
  {
    id: 'control-panel',
    eyebrow: 'Control Panel',
    title: 'Your mobile home base',
    description: 'Home, chats, notes, and settings are always one tap away.',
    icon: 'grid'
  },
  {
    id: 'permissions',
    eyebrow: 'Permissions',
    title: 'Enable microphone access',
    description: 'Voice capture and keyboard dictation need microphone permission.',
    icon: 'mic'
  },
  {
    id: 'test-transcription',
    eyebrow: 'Voice',
    title: 'Test transcription',
    description: 'Use the mic in chat or notes to turn speech into text.',
    icon: 'activity'
  },
  {
    id: 'shortcut-notebook',
    eyebrow: 'Notebook',
    title: 'Capture ideas fast',
    description: 'Notes are designed for quick drafting, voice inserts, and edits.',
    icon: 'file-text'
  },
  {
    id: 'shortcut-chat',
    eyebrow: 'Chat',
    title: 'Ask without context switching',
    description: 'Start chats from the home screen and pick the right model per task.',
    icon: 'message-square'
  },
  {
    id: 'shortcut-browser',
    eyebrow: 'Browser',
    title: 'Browser flow on the roadmap',
    description: 'Desktop browser workflows are being adapted for mobile surfaces.',
    icon: 'globe'
  },
  {
    id: 'shortcut-agent',
    eyebrow: 'Agent',
    title: 'Agent mode will expand here',
    description: 'The mobile app will follow the same assistant-first direction as desktop.',
    icon: 'cpu'
  },
  {
    id: 'integrations-skills',
    eyebrow: 'Integrations',
    title: 'Skills and integrations follow next',
    description: 'This onboarding lays the routing and permissions groundwork first.',
    icon: 'link'
  },
  {
    id: 'upgrade',
    eyebrow: 'Upgrade',
    title: 'Free now, extensible later',
    description: 'Billing and account flows can slot into this onboarding sequence later.',
    icon: 'star'
  },
  {
    id: 'get-started',
    eyebrow: 'Get Started',
    title: 'You are ready to enter Overlay',
    description: 'Finish setup and land directly in the mobile workspace.',
    icon: 'arrow-right-circle'
  }
]

const AUTH_ONLY_STEPS = ONBOARDING_STEPS.filter((step) => step.id === 'auth')

function FeatureCard({
  title,
  description,
  icon
}: {
  title: string
  description: string
  icon: keyof typeof Feather.glyphMap
}): React.ReactElement {
  const { theme } = useTheme()

  return (
    <View
      style={[
        styles.featureCard,
        {
          backgroundColor: theme.surface,
          borderColor: theme.border
        }
      ]}
    >
      <View style={[styles.featureIcon, { backgroundColor: theme.background }]}>
        <Feather name={icon} size={16} color={theme.textSecondary} />
      </View>
      <View style={styles.featureBody}>
        <Text style={[styles.featureTitle, { color: theme.text }]}>{title}</Text>
        <Text style={[styles.featureDescription, { color: theme.textSecondary }]}>
          {description}
        </Text>
      </View>
    </View>
  )
}

export default function OnboardingScreen(): React.ReactElement {
  const router = useRouter()
  const params = useLocalSearchParams<{ startAtAuth?: string }>()
  const { theme } = useTheme()
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const startAtAuth = params.startAtAuth === 'true'
  const stepSequence = startAtAuth ? AUTH_ONLY_STEPS : ONBOARDING_STEPS
  const [currentIndex, setCurrentIndex] = useState(0)
  const [displayName, setDisplayName] = useState('')
  const [micPermission, setMicPermission] = useState<'undetermined' | 'granted' | 'denied'>('undetermined')

  const currentStep = stepSequence[currentIndex]

  useEffect(() => {
    let isMounted = true

    async function hydrate(): Promise<void> {
      const [onboardingState, permission] = await Promise.all([
        getOnboardingState(),
        Audio.getPermissionsAsync()
      ])

      if (!isMounted) return

      if (onboardingState.completed && !startAtAuth) {
        router.replace('/(tabs)')
        return
      }

      setDisplayName(onboardingState.displayName)
      setMicPermission(
        permission.status === 'granted'
          ? 'granted'
          : permission.status === 'denied'
            ? 'denied'
            : 'undetermined'
      )
    }

    hydrate()

    return () => {
      isMounted = false
    }
  }, [router, startAtAuth])

  useEffect(() => {
    if (authLoading || !isAuthenticated || currentStep.id !== 'auth') {
      return
    }

    if (startAtAuth) {
      router.replace('/(tabs)')
      return
    }

    setCurrentIndex((index) => Math.min(stepSequence.length - 1, index + 1))
  }, [authLoading, currentStep.id, isAuthenticated, router, startAtAuth, stepSequence.length])

  const requestMicPermission = useCallback(async () => {
    const { status } = await Audio.requestPermissionsAsync()
    const nextStatus = status === 'granted' ? 'granted' : 'denied'
    setMicPermission(nextStatus)

    if (nextStatus === 'denied') {
      Alert.alert(
        'Microphone Access Denied',
        'Enable microphone access in iOS Settings to use Overlay voice input and keyboard dictation.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openURL('app-settings:') }
        ]
      )
    }
  }, [])

  const canGoBack = currentIndex > 0
  const canGoNext = useMemo(() => {
    if (currentStep.id === 'auth') {
      return false
    }
    if (currentStep.id === 'name') {
      return displayName.trim().length > 0
    }
    return true
  }, [currentStep.id, displayName])

  const handleBack = useCallback(() => {
    if (!canGoBack) return
    setCurrentIndex((index) => Math.max(0, index - 1))
  }, [canGoBack])

  const handleNext = useCallback(async () => {
    if (currentStep.id === 'name') {
      await setOnboardingDisplayName(displayName.trim())
    }

    if (currentStep.id === 'get-started') {
      await completeOnboarding(displayName.trim())
      router.replace('/(tabs)')
      return
    }

    setCurrentIndex((index) => Math.min(stepSequence.length - 1, index + 1))
  }, [currentStep.id, displayName, router, stepSequence.length])

  const renderStepBody = (): React.ReactElement => {
    switch (currentStep.id) {
      case 'welcome':
        return (
          <View style={styles.stepBody}>
            <FeatureCard
              icon="smartphone"
              title="Mobile-first workspace"
              description="A guided first-run experience that mirrors desktop onboarding without feeling transplanted."
            />
            <FeatureCard
              icon="mic"
              title="Voice-ready"
              description="We will walk through the microphone and keyboard setup needed for dictation."
            />
          </View>
        )

      case 'name':
        return (
          <View style={styles.stepBody}>
            <View style={[styles.inputCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>Display name</Text>
              <TextInput
                style={[
                  styles.nameInput,
                  {
                    color: theme.text,
                    backgroundColor: theme.background,
                    borderColor: theme.border
                  }
                ]}
                placeholder="Enter your name"
                placeholderTextColor={theme.textDisabled}
                value={displayName}
                onChangeText={setDisplayName}
                autoFocus
                returnKeyType="done"
              />
            </View>
          </View>
        )

      case 'auth':
        return (
          <View style={styles.stepBody}>
            <AuthPanel context="onboarding" />
          </View>
        )

      case 'all-in-one':
        return (
          <View style={styles.stepBody}>
            <FeatureCard
              icon="message-square"
              title="Chat"
              description="Ask questions, attach images, and switch models from the conversation header."
            />
            <FeatureCard
              icon="file-text"
              title="Notes"
              description="Capture drafts, structure folders, and bring in voice input where it helps."
            />
            <FeatureCard
              icon="settings"
              title="Settings"
              description="API keys, keyboard setup, and appearance live in one place."
            />
          </View>
        )

      case 'control-panel':
        return (
          <View style={styles.stepBody}>
            <FeatureCard
              icon="home"
              title="Home tab"
              description="Start a new chat or note from the same launch surface."
            />
            <FeatureCard
              icon="layout"
              title="Tabs"
              description="Chats, notes, and settings stay one tap away throughout the app."
            />
          </View>
        )

      case 'permissions':
        return (
          <View style={styles.stepBody}>
            <View style={[styles.permissionCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <View style={styles.permissionHeader}>
                <View
                  style={[
                    styles.permissionBadge,
                    {
                      backgroundColor:
                        micPermission === 'granted'
                          ? 'rgba(16, 185, 129, 0.12)'
                          : 'rgba(239, 68, 68, 0.12)'
                    }
                  ]}
                >
                  <Feather
                    name={micPermission === 'granted' ? 'check' : 'mic'}
                    size={16}
                    color={micPermission === 'granted' ? '#10B981' : '#EF4444'}
                  />
                </View>
                <View style={styles.permissionText}>
                  <Text style={[styles.featureTitle, { color: theme.text }]}>Microphone access</Text>
                  <Text style={[styles.featureDescription, { color: theme.textSecondary }]}>
                    {micPermission === 'granted'
                      ? 'Granted and ready.'
                      : micPermission === 'denied'
                        ? 'Denied. Open Settings to enable it.'
                        : 'Not granted yet.'}
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                style={[styles.primaryInlineButton, { backgroundColor: theme.buttonBg }]}
                onPress={requestMicPermission}
                activeOpacity={0.82}
              >
                <Text style={[styles.primaryInlineButtonText, { color: theme.surface }]}>
                  {micPermission === 'granted' ? 'Check Again' : 'Enable Microphone'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )

      case 'test-transcription':
        return (
          <View style={styles.stepBody}>
            <FeatureCard
              icon="activity"
              title="Voice in chat and notes"
              description="Use the mic button in editors to record, transcribe, and insert text directly."
            />
            <FeatureCard
              icon="type"
              title="Keyboard setup lives in Settings"
              description="Finish the Overlay keyboard install from the Settings tab after onboarding."
            />
          </View>
        )

      case 'shortcut-notebook':
        return (
          <View style={styles.stepBody}>
            <FeatureCard
              icon="edit-3"
              title="Quick capture"
              description="Notebook-style note entry is optimized for fast creation and later refinement."
            />
          </View>
        )

      case 'shortcut-chat':
        return (
          <View style={styles.stepBody}>
            <FeatureCard
              icon="send"
              title="Model-aware chat"
              description="Choose a model per conversation, attach images, and keep chats organized over time."
            />
          </View>
        )

      case 'shortcut-browser':
        return (
          <View style={styles.stepBody}>
            <FeatureCard
              icon="globe"
              title="Browser workflows"
              description="The desktop browser panel is being translated into a mobile-friendly browsing and capture flow."
            />
          </View>
        )

      case 'shortcut-agent':
        return (
          <View style={styles.stepBody}>
            <FeatureCard
              icon="cpu"
              title="Assistant-first direction"
              description="Agent capabilities on desktop are informing the mobile roadmap and model routing choices."
            />
          </View>
        )

      case 'integrations-skills':
        return (
          <View style={styles.stepBody}>
            <FeatureCard
              icon="link"
              title="Integrations"
              description="This first pass focuses on permissions, storage, and first-run structure so richer integrations can slot in cleanly."
            />
          </View>
        )

      case 'upgrade':
        return (
          <View style={styles.stepBody}>
            <FeatureCard
              icon="star"
              title="Account-aware from day one"
              description="Your mobile session now follows the same account and Convex-backed identity flow as desktop."
            />
          </View>
        )

      case 'get-started':
      default:
        return (
          <View style={styles.stepBody}>
            <View style={[styles.finishCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.finishName, { color: theme.text }]}>
                {displayName.trim() ? `See you inside, ${displayName.trim()}.` : 'See you inside.'}
              </Text>
              <Text style={[styles.featureDescription, { color: theme.textSecondary }]}>
                You can revisit setup details from the Settings tab after onboarding is complete.
              </Text>
            </View>
          </View>
        )
    }
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.ambientOrb, styles.ambientOrbLeft, { backgroundColor: theme.surface }]} />
      <View style={[styles.ambientOrb, styles.ambientOrbRight, { backgroundColor: theme.surface }]} />

      <View style={styles.header}>
        <Text style={[styles.progressLabel, { color: theme.textSecondary }]}>
          {startAtAuth ? 'Account Setup' : `Step ${currentIndex + 1} of ${stepSequence.length}`}
        </Text>
        <View style={styles.progressRow}>
          {stepSequence.map((step, index) => (
            <View
              key={step.id}
              style={[
                styles.progressDot,
                {
                  backgroundColor:
                    index <= currentIndex ? theme.text : theme.border
                }
              ]}
            />
          ))}
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={[styles.heroIcon, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Feather name={currentStep.icon} size={22} color={theme.text} />
          </View>
          <Text style={[styles.eyebrow, { color: theme.textSecondary }]}>{currentStep.eyebrow}</Text>
          <Text style={[styles.title, { color: theme.text }]}>{currentStep.title}</Text>
          <Text style={[styles.description, { color: theme.textSecondary }]}>
            {currentStep.description}
          </Text>
        </View>

        {renderStepBody()}
      </ScrollView>

      {currentStep.id !== 'auth' ? (
        <View style={[styles.footer, { borderTopColor: theme.border }]}>
          <TouchableOpacity
            onPress={handleBack}
            disabled={!canGoBack}
            activeOpacity={0.82}
            style={[
              styles.secondaryButton,
              {
                borderColor: theme.border,
                opacity: canGoBack ? 1 : 0.35
              }
            ]}
          >
            <Feather name="chevron-left" size={16} color={theme.text} />
            <Text style={[styles.secondaryButtonText, { color: theme.text }]}>Back</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleNext}
            disabled={!canGoNext}
            activeOpacity={0.82}
            style={[
              styles.primaryButton,
              {
                backgroundColor: theme.buttonBg,
                opacity: canGoNext ? 1 : 0.45
              }
            ]}
          >
            <Text style={[styles.primaryButtonText, { color: theme.surface }]}>
              {currentStep.id === 'get-started' ? 'Enter Overlay' : 'Next'}
            </Text>
            <Feather
              name={currentStep.id === 'get-started' ? 'arrow-right-circle' : 'chevron-right'}
              size={16}
              color={theme.surface}
            />
          </TouchableOpacity>
        </View>
      ) : null}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  ambientOrb: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 999,
    opacity: 0.24
  },
  ambientOrbLeft: {
    top: -80,
    left: -60
  },
  ambientOrbRight: {
    right: -70,
    top: 140
  },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    gap: spacing.sm
  },
  progressLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6
  },
  progressRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap'
  },
  progressDot: {
    width: 18,
    height: 4,
    borderRadius: 999
  },
  scroll: {
    flex: 1
  },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl
  },
  hero: {
    marginBottom: spacing.xl
  },
  heroIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    marginBottom: spacing.lg
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: 10
  },
  title: {
    fontFamily: 'InstrumentSerif-Regular',
    fontSize: 42,
    lineHeight: 42,
    marginBottom: spacing.md
  },
  description: {
    fontSize: fontSize.lg,
    lineHeight: 24,
    maxWidth: 520
  },
  stepBody: {
    gap: spacing.md
  },
  featureCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md
  },
  featureIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  featureBody: {
    flex: 1
  },
  featureTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    marginBottom: 4
  },
  featureDescription: {
    fontSize: fontSize.sm,
    lineHeight: 20
  },
  inputCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: spacing.lg,
    gap: spacing.sm
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6
  },
  nameInput: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: fontSize.lg
  },
  permissionCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: spacing.lg,
    gap: spacing.lg
  },
  permissionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md
  },
  permissionBadge: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center'
  },
  permissionText: {
    flex: 1
  },
  primaryInlineButton: {
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center'
  },
  primaryInlineButtonText: {
    fontSize: fontSize.md,
    fontWeight: '700'
  },
  finishCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: spacing.xl,
    gap: spacing.sm
  },
  finishName: {
    fontFamily: 'InstrumentSerif-Regular',
    fontSize: 30,
    lineHeight: 32
  },
  footer: {
    borderTopWidth: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md
  },
  secondaryButton: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  secondaryButtonText: {
    fontSize: fontSize.md,
    fontWeight: '600'
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  primaryButtonText: {
    fontSize: fontSize.md,
    fontWeight: '700'
  }
})
