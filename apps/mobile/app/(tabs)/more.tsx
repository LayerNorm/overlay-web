import React from 'react'
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { useTheme } from '../../hooks/useTheme'
import { spacing, fontSize } from '../../constants/theme'
import { PanelCard, SectionLabel } from '../../components/ui/PanelPrimitives'
import { AuthPanel } from '../../components/auth/AuthPanel'

const MORE_ITEMS = [
  {
    label: 'Account',
    description: 'Profile, plan, and sign-in state',
    icon: 'user',
    href: '/settings?tab=account',
  },
  {
    label: 'Extensions',
    description: 'Connectors, skills, and extension surfaces',
    icon: 'grid',
    href: '/more/extensions',
  },
  {
    label: 'Automations',
    description: 'Recurring workflows and recent runs',
    icon: 'repeat',
    href: '/more/automations',
  },
  {
    label: 'Settings',
    description: 'Theme, account, model guidance, and contact',
    icon: 'settings',
    href: '/settings',
  },
] as const

export default function MoreScreen(): React.ReactElement {
  const { theme } = useTheme()
  const router = useRouter()

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <SectionLabel theme={theme}>More</SectionLabel>
        <Text style={[styles.title, { color: theme.text }]}>Account & Tools</Text>
        <Text style={[styles.description, { color: theme.textSecondary }]}>
          Mobile keeps these surfaces under More while preserving the same functionality contract as the web app.
        </Text>

        <PanelCard theme={theme} padded={false}>
          {MORE_ITEMS.map((item, index) => (
            <TouchableOpacity
              key={item.label}
              onPress={() => router.push(item.href)}
              style={[
                styles.row,
                {
                  borderBottomColor:
                    index === MORE_ITEMS.length - 1 ? 'transparent' : theme.border,
                },
              ]}
            >
              <View style={[styles.iconWrap, { backgroundColor: theme.background }]}>
                <Feather name={item.icon} size={16} color={theme.textSecondary} />
              </View>
              <View style={styles.rowBody}>
                <Text style={[styles.rowTitle, { color: theme.text }]}>{item.label}</Text>
                <Text style={[styles.rowMeta, { color: theme.textSecondary }]}>
                  {item.description}
                </Text>
              </View>
              <Feather name="chevron-right" size={16} color={theme.textDisabled} />
            </TouchableOpacity>
          ))}
        </PanelCard>

        <AuthPanel context="settings" />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    padding: spacing.xl,
    gap: spacing.md,
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
  },
  description: {
    fontSize: fontSize.md,
    lineHeight: 22,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  rowBody: {
    flex: 1,
    gap: 4,
  },
  rowTitle: {
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  rowMeta: {
    fontSize: fontSize.sm,
    lineHeight: 19,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
