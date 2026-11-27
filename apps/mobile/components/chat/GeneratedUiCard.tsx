import React from 'react'
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import type { GeneratedUiPart } from '@overlay/chat-core'
import type { Theme } from '../../constants/theme'
import { borderRadius, fontSize, spacing } from '../../constants/theme'

/**
 * Card renderer for `overlay.generated_ui` data parts — model-authored
 * draft surfaces (text doc, email draft, connector connect prompt).
 * Mirrors the web generated-ui kinds; compact native cards instead of the
 * web's interactive draft editor.
 */
export function GeneratedUiCard({
  part,
  theme,
}: {
  part: GeneratedUiPart
  theme: Theme
}): React.ReactElement | null {
  const data = part.data

  if (data.kind === 'draft.text') {
    return (
      <View style={[styles.card, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
        <View style={styles.cardHeader}>
          <View style={[styles.iconChip, { backgroundColor: theme.surfaceSubtle }]}>
            <Feather name="file-text" size={14} color={theme.textSecondary} />
          </View>
          <Text style={[styles.cardTitle, { color: theme.text }]} numberOfLines={1}>
            {data.title?.trim() || 'Draft'}
          </Text>
        </View>
        {data.body ? (
          <Text style={[styles.cardBody, { color: theme.textSecondary }]} numberOfLines={6}>
            {data.body}
          </Text>
        ) : null}
      </View>
    )
  }

  if (data.kind === 'draft.email') {
    const recipients = [...(data.to ?? []), ...(data.cc ?? [])].join(', ')
    return (
      <View style={[styles.card, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
        <View style={styles.cardHeader}>
          <View style={[styles.iconChip, { backgroundColor: theme.surfaceSubtle }]}>
            <Feather name="mail" size={14} color={theme.textSecondary} />
          </View>
          <Text style={[styles.cardTitle, { color: theme.text }]} numberOfLines={1}>
            {data.subject?.trim() || 'Email draft'}
          </Text>
          <View style={[styles.kindPill, { backgroundColor: theme.surfaceSubtle }]}>
            <Text style={[styles.kindPillText, { color: theme.textSecondary }]}>Email</Text>
          </View>
        </View>
        {recipients ? (
          <Text style={[styles.cardMeta, { color: theme.textSecondary }]} numberOfLines={1}>
            To: {recipients}
          </Text>
        ) : null}
        {data.body ? (
          <Text style={[styles.cardBody, { color: theme.textSecondary }]} numberOfLines={6}>
            {data.body}
          </Text>
        ) : null}
      </View>
    )
  }

  if (data.kind === 'connector.connect') {
    return (
      <View style={[styles.card, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
        <View style={styles.cardHeader}>
          <View style={[styles.iconChip, { backgroundColor: theme.surfaceSubtle }]}>
            <Feather name="grid" size={14} color={theme.textSecondary} />
          </View>
          <Text style={[styles.cardTitle, { color: theme.text }]} numberOfLines={1}>
            {data.connected ? `${data.serviceName} connected` : `Connect ${data.serviceName}`}
          </Text>
        </View>
        {data.description ? (
          <Text style={[styles.cardBody, { color: theme.textSecondary }]} numberOfLines={3}>
            {data.description}
          </Text>
        ) : null}
        {!data.connected && data.connectUrl ? (
          <TouchableOpacity
            activeOpacity={0.8}
            style={[styles.connectButton, { backgroundColor: theme.foreground }]}
            onPress={() => void Linking.openURL(data.connectUrl!)}
          >
            <Text style={[styles.connectButtonText, { color: theme.background }]}>Connect</Text>
            <Feather name="external-link" size={13} color={theme.background} />
          </TouchableOpacity>
        ) : null}
      </View>
    )
  }

  return null
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: borderRadius.xl,
    padding: spacing.md,
    marginTop: spacing.sm,
    gap: spacing.xs,
    alignSelf: 'stretch',
    maxWidth: 420,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconChip: {
    width: 26,
    height: 26,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  kindPill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  kindPillText: {
    fontSize: 10,
    fontWeight: '700',
  },
  cardMeta: {
    fontSize: 12,
  },
  cardBody: {
    fontSize: 13,
    lineHeight: 19,
  },
  connectButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: borderRadius.lg,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: spacing.xs,
  },
  connectButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
})
