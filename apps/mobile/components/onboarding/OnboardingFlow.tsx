import React, { useRef, useState } from 'react'
import {
  Dimensions,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { borderRadius, fontSize, spacing, type Theme } from '../../constants/theme'
import { useTheme } from '../../hooks/useTheme'

/**
 * First-run onboarding — the mobile counterpart of the web `OnboardingTour`.
 * The web version spotlights live UI elements; the native equivalent is a
 * short paged walkthrough of the surfaces the user just gained. Completion is
 * recorded by the caller (`finishOnboarding`) — local flag first, then the
 * server's `hasSeenOnboarding`.
 */

interface OnboardingPage {
  icon: keyof typeof Feather.glyphMap
  title: string
  body: string
}

const PAGES: OnboardingPage[] = [
  {
    icon: 'message-square',
    title: 'Chat with your agents',
    body: 'Ask, attach files, mention knowledge and tools — agents run on your Overlay backend and answer with full context.',
  },
  {
    icon: 'users',
    title: 'Rooms, DMs, and threads',
    body: 'Talk to people and agents in channels, direct messages, and threads. Reactions, pins, and typing presence all work here.',
  },
  {
    icon: 'database',
    title: 'Knowledge that answers back',
    body: 'Index files, notes, and knowledge bases. Agents cite what they retrieve, and every source stays one tap away.',
  },
  {
    icon: 'zap',
    title: 'Automate the routine',
    body: 'Turn chats into scheduled automations and connect integrations, skills, and MCP servers from the Tools tab.',
  },
  {
    icon: 'mic',
    title: 'Speak instead of type',
    body: 'Overlay dictation works in any app with the keyboard — enable it from Settings → Voice & Keyboard when you are ready.',
  },
]

export function OnboardingFlow({ onFinish }: { onFinish: () => void }): React.ReactElement {
  const { theme } = useTheme()
  const [page, setPage] = useState(0)
  const listRef = useRef<FlatList<OnboardingPage>>(null)
  const width = Dimensions.get('window').width
  const isLast = page === PAGES.length - 1

  function handleScroll(event: NativeSyntheticEvent<NativeScrollEvent>): void {
    const next = Math.round(event.nativeEvent.contentOffset.x / width)
    if (next !== page && next >= 0 && next < PAGES.length) setPage(next)
  }

  function advance(): void {
    if (isLast) {
      onFinish()
      return
    }
    listRef.current?.scrollToIndex({ index: page + 1, animated: true })
    setPage(page + 1)
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
      <View style={styles.skipRow}>
        <TouchableOpacity onPress={onFinish} hitSlop={12}>
          <Text style={[styles.skip, { color: theme.textSecondary }]}>Skip</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        ref={listRef}
        data={PAGES}
        keyExtractor={(item) => item.title}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScroll}
        scrollEnabled={false}
        renderItem={({ item }) => (
          <View style={[styles.page, { width }]}>
            <View style={[styles.iconRing, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
              <Feather name={item.icon} size={30} color={theme.text} />
            </View>
            <Text style={[styles.title, { color: theme.text }]}>{item.title}</Text>
            <Text style={[styles.body, { color: theme.textSecondary }]}>{item.body}</Text>
          </View>
        )}
      />
      <View style={styles.footer}>
        <View style={styles.dots}>
          {PAGES.map((item, index) => (
            <View
              key={item.title}
              style={[
                styles.dot,
                { backgroundColor: index === page ? theme.text : theme.border },
              ]}
            />
          ))}
        </View>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={advance}
          style={[styles.nextButton, { backgroundColor: theme.foreground }]}
        >
          <Text style={[styles.nextLabel, { color: theme.background }]}>
            {isLast ? 'Get started' : 'Next'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  skipRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    minHeight: 40,
    alignItems: 'center',
  },
  skip: {
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  page: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    gap: spacing.lg,
  },
  iconRing: {
    width: 88,
    height: 88,
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
  body: {
    fontSize: fontSize.md,
    lineHeight: 24,
    textAlign: 'center',
    maxWidth: 320,
  },
  footer: {
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.lg,
    gap: spacing.lg,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: borderRadius.full,
  },
  nextButton: {
    minHeight: 50,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextLabel: {
    fontSize: fontSize.md,
    fontWeight: '700',
  },
})
