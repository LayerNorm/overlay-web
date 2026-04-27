import React, { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Dimensions,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme } from '../../../hooks/useTheme'
import { borderRadius, fontSize, spacing } from '../../../constants/theme'
import { listOutputs } from '../../../services/knowledgeService'
import type { OutputSummary } from '@overlay/app-core'

const { width } = Dimensions.get('window')

export default function OutputDetailScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { theme } = useTheme()
  const router = useRouter()
  const [output, setOutput] = useState<OutputSummary | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const loadOutput = useCallback(async () => {
    if (!id) return
    setIsLoading(true)
    try {
      const all = await listOutputs()
      const found = all.find((o) => o._id === id)
      if (found) setOutput(found)
    } catch {
      // ignore
    } finally {
      setIsLoading(false)
    }
  }, [id])

  useEffect(() => {
    void loadOutput()
  }, [loadOutput])

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={styles.centered}>
          <ActivityIndicator color={theme.textSecondary} />
        </View>
      </SafeAreaView>
    )
  }

  if (!output) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={styles.centered}>
          <Text style={{ color: theme.textSecondary }}>Output not found</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backButton, { borderColor: theme.border }]}>
          <Feather name="arrow-left" size={18} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>
          Output
        </Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {output.type === 'image' && output.url ? (
          <Image source={{ uri: output.url }} style={[styles.image, { borderColor: theme.border }]} resizeMode="contain" />
        ) : output.type === 'video' && output.url ? (
          <View style={[styles.videoPlaceholder, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}>
            <Feather name="film" size={40} color={theme.textSecondary} />
            <Text style={[styles.videoHint, { color: theme.textSecondary }]}>Video output</Text>
            <Text style={[styles.videoUrl, { color: theme.textSecondary }]} numberOfLines={2}>
              {output.url}
            </Text>
          </View>
        ) : (
          <View style={[styles.genericPlaceholder, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}>
            <Feather name="file" size={40} color={theme.textSecondary} />
            <Text style={[styles.genericHint, { color: theme.textSecondary }]}>{output.fileName || output.prompt || 'Output'}</Text>
          </View>
        )}

        <View style={[styles.metaCard, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
          <Text style={[styles.metaLabel, { color: theme.textSecondary }]}>Prompt</Text>
          <Text style={[styles.metaValue, { color: theme.text }]}>{output.prompt || '—'}</Text>

          <Text style={[styles.metaLabel, { color: theme.textSecondary }]}>Model</Text>
          <Text style={[styles.metaValue, { color: theme.text }]}>{output.modelId}</Text>

          <Text style={[styles.metaLabel, { color: theme.textSecondary }]}>Status</Text>
          <Text style={[styles.metaValue, { color: theme.text }]}>{output.status}</Text>

          <Text style={[styles.metaLabel, { color: theme.textSecondary }]}>Created</Text>
          <Text style={[styles.metaValue, { color: theme.text }]}>
            {new Date(output.createdAt).toLocaleString()}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    fontFamily: 'LibreBaskerville',
    textAlign: 'center',
  },
  scrollContent: {
    padding: 16,
    gap: spacing.lg,
  },
  image: {
    width: width - 32,
    height: width - 32,
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  videoPlaceholder: {
    width: width - 32,
    height: 240,
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 16,
  },
  videoHint: {
    fontSize: fontSize.md,
    fontWeight: '500',
  },
  videoUrl: {
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
  genericPlaceholder: {
    width: width - 32,
    height: 200,
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 16,
  },
  genericHint: {
    fontSize: fontSize.md,
    fontWeight: '500',
  },
  metaCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  metaLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  metaValue: {
    fontSize: fontSize.md,
    lineHeight: 22,
  },
})
