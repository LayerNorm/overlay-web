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

function getPricingUrl(): string {
  return getAccountUrl().replace('/account', '/pricing')
}

const PLANS = [
  { label: 'Cheapest', price: '$8', period: '/mo', note: 'For light monthly use' },
  { label: 'Most popular', price: '$24', period: '/mo', note: 'For regular work', highlight: true },
  { label: 'Best value', price: '$96', period: '/mo', note: 'More storage & budget' },
  { label: 'Custom', price: '$8–$200', period: '/mo', note: 'Pick your own budget' },
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
  function openPricing() {
    void Linking.openURL(getPricingUrl())
    onClose()
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, { backgroundColor: theme.scrim }]} onPress={onClose}>
        <Pressable style={[styles.dialog, { backgroundColor: theme.background, borderColor: theme.border }]}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.title, { color: theme.text }]}>Upgrade your plan</Text>
            <TouchableOpacity
              onPress={onClose}
              activeOpacity={0.8}
              style={[styles.closeButton, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather name="x" size={18} color={theme.text} />
            </TouchableOpacity>
          </View>

          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            Premium models, browser tasks, agents, and more.
          </Text>

          {/* Plan options */}
          <View style={styles.plans}>
            {PLANS.map((plan) => (
              <Pressable
                key={plan.label}
                onPress={openPricing}
                style={({ pressed }) => [
                  styles.planRow,
                  { borderColor: plan.highlight ? '#35C4D4' : theme.border },
                  pressed && styles.planRowPressed,
                ]}
              >
                <View style={styles.planLeft}>
                  <Text style={[styles.planLabel, { color: plan.highlight ? '#35C4D4' : theme.text }]}>
                    {plan.label}
                  </Text>
                  <Text style={[styles.planNote, { color: theme.textSecondary }]}>{plan.note}</Text>
                </View>
                <Text style={[styles.planPrice, { color: plan.highlight ? '#35C4D4' : theme.text }]}>
                  {plan.price}
                  <Text style={[styles.planPeriod, { color: theme.textSecondary }]}>{plan.period}</Text>
                </Text>
              </Pressable>
            ))}
          </View>

          {/* CTA */}
          <Pressable
            onPress={openPricing}
            style={({ pressed }) => [styles.cta, { backgroundColor: '#35C4D4', opacity: pressed ? 0.85 : 1 }]}
          >
            <Text style={styles.ctaText}>See all plans</Text>
            <Feather name="arrow-right" size={16} color="#071114" />
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 24,
    borderWidth: 1,
    padding: 20,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    flex: 1,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
  },
  subtitle: {
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  plans: {
    gap: 8,
  },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  planRowPressed: {
    opacity: 0.7,
  },
  planLeft: {
    flex: 1,
    gap: 2,
  },
  planLabel: {
    fontSize: fontSize.md,
    fontWeight: '500',
  },
  planNote: {
    fontSize: fontSize.sm,
  },
  planPrice: {
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  planPeriod: {
    fontSize: fontSize.sm,
    fontWeight: '400',
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 52,
    borderRadius: borderRadius.full,
    marginTop: 4,
  },
  ctaText: {
    color: '#071114',
    fontSize: fontSize.md,
    fontWeight: '600',
  },
})
