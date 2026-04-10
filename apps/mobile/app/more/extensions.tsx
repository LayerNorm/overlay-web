import React, { useCallback, useState } from 'react'
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { useTheme } from '../../hooks/useTheme'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { PanelCard, SectionLabel } from '../../components/ui/PanelPrimitives'
import { listConnectedIntegrations, listSkills, searchIntegrations } from '../../services/integrationsService'
import type { IntegrationSummary, SkillSummary } from '../../services/appContracts'

type ExtensionsTab = 'connectors' | 'skills' | 'mcps' | 'apps' | 'all'

export default function ExtensionsScreen(): React.ReactElement {
  const { theme } = useTheme()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<ExtensionsTab>('connectors')
  const [integrations, setIntegrations] = useState<IntegrationSummary[]>([])
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [connected, setConnected] = useState<string[]>([])

  useFocusEffect(
    useCallback(() => {
      void Promise.all([
        searchIntegrations().then((data) => setIntegrations(data.items)).catch(() => setIntegrations([])),
        listSkills().then(setSkills).catch(() => setSkills([])),
        listConnectedIntegrations().then((data) => setConnected(data.connected)).catch(() => setConnected([])),
      ])
    }, []),
  )

  const placeholder = (
    <View style={styles.emptyState}>
      <Feather name="box" size={24} color={theme.textSecondary} />
      <Text style={[styles.emptyTitle, { color: theme.text }]}>Matches web status</Text>
      <Text style={[styles.emptyCopy, { color: theme.textSecondary }]}>
        This subview is still a placeholder on web and remains a placeholder on mobile.
      </Text>
    </View>
  )

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backRow}>
          <Feather name="chevron-left" size={18} color={theme.textSecondary} />
          <Text style={[styles.backText, { color: theme.textSecondary }]}>Back</Text>
        </TouchableOpacity>

        <SectionLabel theme={theme}>Extensions</SectionLabel>
        <Text style={[styles.title, { color: theme.text }]}>Connectors & Skills</Text>

        <View style={[styles.segmented, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {(['connectors', 'skills', 'mcps', 'apps', 'all'] as ExtensionsTab[]).map((tab) => {
            const active = tab === activeTab
            return (
              <TouchableOpacity
                key={tab}
                onPress={() => setActiveTab(tab)}
                style={[styles.segment, { backgroundColor: active ? theme.text : 'transparent' }]}
              >
                <Text style={[styles.segmentText, { color: active ? theme.surface : theme.textSecondary }]}>
                  {tab}
                </Text>
              </TouchableOpacity>
            )
          })}
        </View>

        <PanelCard theme={theme} padded={false}>
          {activeTab === 'connectors'
            ? integrations.map((integration) => (
                <View key={integration.slug} style={[styles.row, { borderBottomColor: theme.border }]}>
                  <Feather name="link" size={16} color={theme.textSecondary} />
                  <View style={styles.rowBody}>
                    <Text style={[styles.rowTitle, { color: theme.text }]}>{integration.name}</Text>
                    <Text style={[styles.rowMeta, { color: theme.textSecondary }]}>
                      {integration.description}
                    </Text>
                  </View>
                  <Text style={[styles.statusText, { color: connected.includes(integration.slug) ? '#10B981' : theme.textDisabled }]}>
                    {connected.includes(integration.slug) ? 'Connected' : 'Available'}
                  </Text>
                </View>
              ))
            : activeTab === 'skills'
              ? skills.map((skill) => (
                  <View key={skill._id} style={[styles.row, { borderBottomColor: theme.border }]}>
                    <Feather name="zap" size={16} color={theme.textSecondary} />
                    <View style={styles.rowBody}>
                      <Text style={[styles.rowTitle, { color: theme.text }]}>{skill.name}</Text>
                      <Text style={[styles.rowMeta, { color: theme.textSecondary }]} numberOfLines={2}>
                        {skill.description || skill.instructions}
                      </Text>
                    </View>
                  </View>
                ))
              : placeholder}
        </PanelCard>
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
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  backText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
  },
  segmented: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderWidth: 1,
    borderRadius: borderRadius.xl,
    padding: 4,
    gap: 4,
  },
  segment: {
    borderRadius: borderRadius.full,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  segmentText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    textTransform: 'capitalize',
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
  statusText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl * 2,
    gap: spacing.sm,
  },
  emptyTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  emptyCopy: {
    fontSize: fontSize.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
})
