import React from 'react'
import {
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import type { Theme } from '../../constants/theme'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { getAccountUrl } from '../../services/authService'
import { GlassSurface } from '../ui/GlassSurface'

const FEATURES = [
  'Access to top AI models',
  'Access to Computer',
  'Access to deep research',
  'Premium app connectors',
  'More usage and memory',
] as const

export function UpgradePrompt({
  visible,
  theme,
  onClose,
}: {
  visible: boolean
  theme: Theme
  onClose: () => void
}): React.ReactElement {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: theme.scrim }]}>
        <GlassSurface style={[styles.sheet, { backgroundColor: theme.background, borderColor: theme.border }]}>
          <View style={styles.header}>
            <TouchableOpacity
              onPress={onClose}
              activeOpacity={0.82}
              style={[styles.closeButton, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}
            >
              <Feather name="x" size={26} color={theme.text} />
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.82}
              onPress={() => void Linking.openURL(getAccountUrl())}
              style={[styles.restoreButton, { borderColor: theme.border }]}
            >
              <Text style={[styles.restoreText, { color: theme.textSecondary }]}>Restore</Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.title, { color: theme.text }]}>Get the most accurate answers</Text>
          <Text style={[styles.models, { color: theme.textSecondary }]}>
            Sonnet 4.6   Kimi K2.6   Claude Opus 4.7
          </Text>

          <View style={[styles.segment, { borderColor: theme.border }]}>
            <View style={[styles.segmentActive, { backgroundColor: '#35C4D4' }]}>
              <Text style={styles.segmentActiveText}>Pro</Text>
            </View>
            <Text style={[styles.segmentText, { color: theme.textSecondary }]}>Max</Text>
          </View>

          <View style={[styles.featureCard, { borderColor: theme.border }]}>
            <View style={styles.featureHeader}>
              <Text style={[styles.featureHeaderText, { color: theme.textSecondary }]}>Features</Text>
              <Text style={[styles.featureHeaderText, { color: theme.textSecondary }]}>Free</Text>
              <Text style={[styles.featureHeaderText, { color: '#35C4D4' }]}>Pro</Text>
            </View>
            {FEATURES.map((feature) => (
              <View key={feature} style={styles.featureRow}>
                <Text style={[styles.featureText, { color: theme.text }]}>{feature}</Text>
                <Text style={[styles.featureMark, { color: theme.textSecondary }]}>-</Text>
                <Text style={[styles.featureMark, { color: '#35C4D4' }]}>✓</Text>
              </View>
            ))}
          </View>

          <View style={styles.planRow}>
            <View style={[styles.planCard, styles.planCardSelected, { borderColor: '#35C4D4' }]}>
              <View style={[styles.checkBadge, { backgroundColor: '#35C4D4' }]}>
                <Feather name="check" size={16} color="#071114" />
              </View>
              <Text style={[styles.planLabel, { color: theme.textSecondary }]}>Yearly</Text>
              <Text style={[styles.planPrice, { color: theme.text }]}>$200 <Text style={styles.planSuffix}>/yr</Text></Text>
              <Text style={[styles.planSub, { color: theme.textSecondary }]}>$17/mo</Text>
            </View>
            <View style={[styles.planCard, { borderColor: theme.border }]}>
              <Text style={[styles.planLabel, { color: theme.textSecondary }]}>Monthly</Text>
              <Text style={[styles.planPrice, { color: theme.textSecondary }]}>$20 <Text style={styles.planSuffix}>/mo</Text></Text>
              <Text style={[styles.planSub, { color: theme.textSecondary }]}>$240/yr</Text>
            </View>
          </View>

          <Pressable
            onPress={() => void Linking.openURL(getAccountUrl())}
            style={[styles.cta, { backgroundColor: '#35C4D4' }]}
          >
            <Text style={styles.ctaText}>Get Pro</Text>
          </Pressable>
        </GlassSurface>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    minHeight: '92%',
    borderTopLeftRadius: 34,
    borderTopRightRadius: 34,
    borderWidth: 1,
    padding: 20,
    gap: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  closeButton: {
    width: 58,
    height: 58,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  restoreButton: {
    height: 52,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    paddingHorizontal: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  restoreText: {
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  title: {
    marginTop: 42,
    fontSize: 38,
    lineHeight: 48,
    fontWeight: '400',
    textAlign: 'center',
  },
  models: {
    textAlign: 'center',
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  segment: {
    alignSelf: 'center',
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: borderRadius.full,
    padding: 4,
    gap: 8,
  },
  segmentActive: {
    borderRadius: borderRadius.full,
    paddingHorizontal: 28,
    paddingVertical: 8,
  },
  segmentActiveText: {
    fontSize: 20,
    color: '#071114',
  },
  segmentText: {
    fontSize: 20,
    paddingHorizontal: 28,
    paddingVertical: 8,
  },
  featureCard: {
    borderWidth: 1,
    borderRadius: 28,
    padding: 22,
    gap: 16,
  },
  featureHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  featureHeaderText: {
    flex: 1,
    fontSize: fontSize.md,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  featureText: {
    flex: 1,
    fontSize: fontSize.md,
  },
  featureMark: {
    flex: 1,
    textAlign: 'center',
    fontSize: 22,
  },
  planRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  planCard: {
    flex: 1,
    minHeight: 124,
    borderWidth: 1,
    borderRadius: 22,
    padding: 16,
    gap: 8,
  },
  planCardSelected: {
    position: 'relative',
  },
  checkBadge: {
    position: 'absolute',
    top: -14,
    right: -14,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planLabel: {
    fontSize: fontSize.md,
  },
  planPrice: {
    fontSize: 30,
    fontWeight: '700',
  },
  planSuffix: {
    fontSize: fontSize.md,
    fontWeight: '500',
  },
  planSub: {
    fontSize: fontSize.sm,
  },
  cta: {
    minHeight: 62,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    color: '#071114',
    fontSize: 20,
    fontWeight: '700',
  },
})
