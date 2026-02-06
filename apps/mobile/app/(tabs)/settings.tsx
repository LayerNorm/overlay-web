import React from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Switch, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { useTheme } from '../../hooks/useTheme'
import { spacing, fontSize, borderRadius } from '../../constants/theme'

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

export default function SettingsScreen(): React.ReactElement {
  const { theme, isDark, toggleTheme } = useTheme()

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
          <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>GENERAL</Text>
          <View style={[styles.sectionContent, { backgroundColor: theme.surface }]}>
            <SettingsRow icon="key" title="API Keys" description="Configure AI provider keys" onPress={() => {}} />
            <SettingsRow icon="bell" title="Notifications" description="Manage notifications" onPress={() => {}} />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>CHAT</Text>
          <View style={[styles.sectionContent, { backgroundColor: theme.surface }]}>
            <SettingsRow icon="cpu" title="Default Model" description="Select default AI model" onPress={() => {}} />
            <SettingsRow icon="message-circle" title="Chat History" description="Manage chat data" onPress={() => {}} />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>NOTES</Text>
          <View style={[styles.sectionContent, { backgroundColor: theme.surface }]}>
            <SettingsRow icon="edit-3" title="Editor" description="Editor preferences" onPress={() => {}} />
            <SettingsRow icon="save" title="Auto-save" description="Configure auto-save" onPress={() => {}} />
          </View>
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
    flex: 1,
  },
  header: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.xl,
  },
  section: {
    marginBottom: spacing.xxl,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  sectionContent: {
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
  },
  settingsRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
  },
  settingsRowText: {
    flex: 1,
  },
  settingsRowTitle: {
    fontSize: fontSize.md,
    fontWeight: '500',
  },
  settingsRowDescription: {
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  bottomPadding: {
    height: 40,
  },
})
