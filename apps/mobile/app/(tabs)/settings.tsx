import React, { useState, useCallback, useEffect } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Switch,
  ScrollView,
  TextInput,
  Alert,
  Linking
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { Audio } from 'expo-av'
import { useTheme } from '../../hooks/useTheme'
import { spacing, fontSize, borderRadius } from '../../constants/theme'
import { PROVIDER_COLORS } from '../../services/chatTypes'
import { getApiKey, setApiKey, deleteApiKey, type AIProvider } from '../../services/aiService'

interface SettingsRowProps {
  icon: string
  title: string
  description?: string
  onPress?: () => void
  rightElement?: React.ReactNode
}

function SettingsRow({ icon, title, description, onPress, rightElement }: SettingsRowProps): React.ReactElement {
  const { theme } = useTheme()

  return (
    <TouchableOpacity
      style={[styles.settingsRow, { borderBottomColor: theme.border }]}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
      disabled={!onPress}
    >
      <View style={styles.settingsRowLeft}>
        <Feather name={icon as keyof typeof Feather.glyphMap} size={20} color={theme.textSecondary} />
        <View style={styles.settingsRowText}>
          <Text style={[styles.settingsRowTitle, { color: theme.text }]}>{title}</Text>
          {description && (
            <Text style={[styles.settingsRowDescription, { color: theme.textSecondary }]}>{description}</Text>
          )}
        </View>
      </View>
      {rightElement || (onPress && <Feather name="chevron-right" size={20} color={theme.textSecondary} />)}
    </TouchableOpacity>
  )
}

interface APIKeyRowProps {
  provider: AIProvider
  label: string
  theme: ReturnType<typeof useTheme>['theme']
}

function APIKeyRow({ provider, label, theme }: APIKeyRowProps): React.ReactElement {
  const [key, setKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [isEditing, setIsEditing] = useState(false)

  useEffect(() => {
    getApiKey(provider).then((k) => {
      setHasKey(!!k)
    })
  }, [provider])

  const handleSave = useCallback(async () => {
    if (key.trim()) {
      await setApiKey(provider, key.trim())
      setHasKey(true)
      setIsEditing(false)
      setKey('')
    }
  }, [key, provider])

  const handleRemove = useCallback(() => {
    Alert.alert('Remove API Key', `Remove ${label} API key?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await deleteApiKey(provider)
          setHasKey(false)
        }
      }
    ])
  }, [provider, label])

  const color = PROVIDER_COLORS[provider] || theme.textSecondary

  if (isEditing) {
    return (
      <View style={[styles.apiKeyRow, { borderBottomColor: theme.border }]}>
        <View style={[styles.providerDot, { backgroundColor: color }]} />
        <TextInput
          style={[styles.apiKeyInput, { color: theme.text, backgroundColor: theme.background }]}
          placeholder={`Paste ${label} key...`}
          placeholderTextColor={theme.textDisabled}
          value={key}
          onChangeText={setKey}
          autoFocus
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity onPress={handleSave} style={styles.apiKeyAction}>
          <Feather name="check" size={18} color="#10B981" />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { setIsEditing(false); setKey('') }} style={styles.apiKeyAction}>
          <Feather name="x" size={18} color={theme.textSecondary} />
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <TouchableOpacity
      style={[styles.apiKeyRow, { borderBottomColor: theme.border }]}
      onPress={() => setIsEditing(true)}
      activeOpacity={0.7}
    >
      <View style={[styles.providerDot, { backgroundColor: color }]} />
      <Text style={[styles.apiKeyLabel, { color: theme.text }]}>{label}</Text>
      {hasKey ? (
        <View style={styles.apiKeyStatus}>
          <Feather name="check-circle" size={14} color="#10B981" />
          <TouchableOpacity onPress={handleRemove} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="trash-2" size={14} color={theme.textDisabled} />
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={[styles.apiKeyPlaceholder, { color: theme.textDisabled }]}>Not set</Text>
      )}
    </TouchableOpacity>
  )
}

export default function SettingsScreen(): React.ReactElement {
  const { theme, isDark, toggleTheme } = useTheme()
  const [micPermission, setMicPermission] = useState<'undetermined' | 'granted' | 'denied'>('undetermined')

  useEffect(() => {
    Audio.getPermissionsAsync().then(({ status }) => {
      setMicPermission(status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined')
    })
  }, [])

  const requestMicPermission = useCallback(async () => {
    const { status } = await Audio.requestPermissionsAsync()
    setMicPermission(status === 'granted' ? 'granted' : 'denied')
    if (status === 'denied') {
      Alert.alert(
        'Microphone Access Denied',
        'Please enable microphone access in Settings to use voice transcription.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openURL('app-settings:') }
        ]
      )
    }
  }, [])

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>Settings</Text>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>APPEARANCE</Text>
          <View style={[styles.sectionContent, { backgroundColor: theme.surface }]}>
            <SettingsRow
              icon="moon"
              title="Dark Mode"
              description="Use dark theme"
              rightElement={
                <Switch
                  value={isDark}
                  onValueChange={toggleTheme}
                  trackColor={{ false: theme.toggleBg, true: theme.toggleBgActive }}
                  thumbColor={theme.toggleThumb}
                />
              }
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>API KEYS</Text>
          <View style={[styles.sectionContent, { backgroundColor: theme.surface }]}>
            <APIKeyRow provider="groq" label="Groq" theme={theme} />
            <APIKeyRow provider="google" label="Google" theme={theme} />
            <APIKeyRow provider="openai" label="OpenAI" theme={theme} />
            <APIKeyRow provider="anthropic" label="Anthropic" theme={theme} />
            <APIKeyRow provider="xai" label="xAI" theme={theme} />
          </View>
          <Text style={[styles.sectionHint, { color: theme.textDisabled }]}>
            API keys are stored securely on-device using the system keychain.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>VOICE KEYBOARD</Text>
          <View style={[styles.sectionContent, { backgroundColor: theme.surface }]}>
            <TouchableOpacity
              style={[styles.micPermissionRow, { borderBottomColor: theme.border }]}
              onPress={micPermission !== 'granted' ? requestMicPermission : undefined}
              activeOpacity={micPermission !== 'granted' ? 0.7 : 1}
            >
              <View style={[styles.stepBadge, { backgroundColor: micPermission === 'granted' ? '#10B981' : '#EF4444' }]}>
                <Feather name={micPermission === 'granted' ? 'check' : 'mic'} size={12} color="white" />
              </View>
              <View style={styles.micPermissionText}>
                <Text style={[styles.micPermissionTitle, { color: theme.text }]}>Microphone Access</Text>
                <Text style={[styles.micPermissionStatus, { color: micPermission === 'granted' ? '#10B981' : theme.textSecondary }]}>
                  {micPermission === 'granted' ? 'Granted' : micPermission === 'denied' ? 'Denied — tap to open Settings' : 'Tap to grant permission'}
                </Text>
              </View>
              {micPermission !== 'granted' && <Feather name="chevron-right" size={18} color={theme.textSecondary} />}
            </TouchableOpacity>
            <View style={[styles.keyboardStep, { borderBottomColor: theme.border }]}>
              <View style={[styles.stepBadge, { backgroundColor: theme.border }]}>
                <Text style={[styles.stepNumber, { color: theme.textSecondary }]}>1</Text>
              </View>
              <Text style={[styles.stepText, { color: theme.text }]}>Settings → General → Keyboard → Keyboards → Add New Keyboard…</Text>
            </View>
            <View style={[styles.keyboardStep, { borderBottomColor: theme.border }]}>
              <View style={[styles.stepBadge, { backgroundColor: theme.border }]}>
                <Text style={[styles.stepNumber, { color: theme.textSecondary }]}>2</Text>
              </View>
              <Text style={[styles.stepText, { color: theme.text }]}>Select <Text style={{ fontWeight: '600' }}>Overlay</Text> from the list</Text>
            </View>
            <View style={[styles.keyboardStep, { borderBottomColor: theme.border }]}>
              <View style={[styles.stepBadge, { backgroundColor: theme.border }]}>
                <Text style={[styles.stepNumber, { color: theme.textSecondary }]}>3</Text>
              </View>
              <Text style={[styles.stepText, { color: theme.text }]}>Tap <Text style={{ fontWeight: '600' }}>Overlay</Text> → enable <Text style={{ fontWeight: '600' }}>Allow Full Access</Text> (required for mic + network)</Text>
            </View>
            <TouchableOpacity
              style={[styles.openSettingsBtn, { borderTopColor: theme.border }]}
              onPress={() => Linking.openURL('app-settings:')}
              activeOpacity={0.7}
            >
              <Feather name="external-link" size={16} color={theme.textSecondary} />
              <Text style={[styles.openSettingsText, { color: theme.text }]}>Open Settings</Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.sectionHint, { color: theme.textDisabled }]}>
            Your Groq API key must be saved above — the keyboard reads it to transcribe your voice.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>ABOUT</Text>
          <View style={[styles.sectionContent, { backgroundColor: theme.surface }]}>
            <SettingsRow icon="info" title="Version" description="1.0.0" />
            <SettingsRow icon="github" title="Source Code" description="View on GitHub" onPress={() => {}} />
          </View>
        </View>

        <View style={styles.bottomPadding} />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  header: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: '600'
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.xl
  },
  section: {
    marginBottom: spacing.xxl
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs
  },
  sectionHint: {
    fontSize: fontSize.xs,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xs
  },
  sectionContent: {
    borderRadius: borderRadius.lg,
    overflow: 'hidden'
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1
  },
  settingsRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1
  },
  settingsRowText: {
    flex: 1
  },
  settingsRowTitle: {
    fontSize: fontSize.md,
    fontWeight: '500'
  },
  settingsRowDescription: {
    fontSize: fontSize.xs,
    marginTop: 2
  },
  apiKeyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1
  },
  providerDot: {
    width: 10,
    height: 10,
    borderRadius: 5
  },
  apiKeyLabel: {
    flex: 1,
    fontSize: fontSize.md,
    fontWeight: '500'
  },
  apiKeyInput: {
    flex: 1,
    fontSize: fontSize.sm,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  apiKeyAction: {
    padding: 4
  },
  apiKeyStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  apiKeyPlaceholder: {
    fontSize: fontSize.xs
  },
  bottomPadding: {
    height: 40
  },
  keyboardStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1
  },
  stepBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1
  },
  stepNumber: {
    fontSize: 11,
    fontWeight: '600'
  },
  stepText: {
    flex: 1,
    fontSize: fontSize.sm,
    lineHeight: 20
  },
  openSettingsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderTopWidth: 1
  },
  openSettingsText: {
    fontSize: fontSize.md,
    fontWeight: '500'
  },
  micPermissionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1
  },
  micPermissionText: {
    flex: 1
  },
  micPermissionTitle: {
    fontSize: fontSize.md,
    fontWeight: '500'
  },
  micPermissionStatus: {
    fontSize: fontSize.xs,
    marginTop: 2
  }
})
