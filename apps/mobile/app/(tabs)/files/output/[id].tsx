import React, { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Dimensions,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../../../../hooks/useTheme'
import { borderRadius, fontSize, spacing } from '../../../../constants/theme'
import { MainScreenHeader, TopBarIconButton } from '../../../../components/ui/AppChrome'
import { ShareSheet } from '../../../../components/workspace/ShareSheet'
import { listOutputs, shareOutput } from '../../../../services/knowledgeService'
import type { OutputSummary } from '@overlay/app-core'

const { width } = Dimensions.get('window')

export default function OutputDetailScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { theme, isDark } = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [output, setOutput] = useState<OutputSummary | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [shareOpen, setShareOpen] = useState(false)

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
      <MainScreenHeader
        theme={theme}
        isDark={isDark}
        topInset={insets.top}
        blurHeight={insets.top + 52}
        leftSlot={<TopBarIconButton theme={theme} icon="arrow-left" onPress={() => router.back()} />}
        centerSlot={
          <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>
            Output
          </Text>
        }
        rightSlot={
          <TopBarIconButton theme={theme} icon="share-2" onPress={() => setShareOpen(true)} />
        }
      />

      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 54 }]}>
        {output.type === 'image' && output.url ? (
          <Image
            source={{ uri: output.url }}
            style={[styles.image, { borderColor: theme.border }]}
            resizeMode="contain"
            alt={output.prompt || output.fileName || 'Generated output'}
          />
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

      <ShareSheet
        visible={shareOpen}
        theme={theme}
        resource={null}
        resourceTitle={output.fileName || output.prompt || 'Output'}
        onSetPublicVisibility={async (visibility) => {
          const response = await shareOutput(output._id, visibility)
          return response.url
        }}
        onClose={() => setShareOpen(false)}
      />
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
  headerTitle: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '700',
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
