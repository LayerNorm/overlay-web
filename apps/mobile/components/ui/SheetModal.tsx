import React, { useEffect, useLayoutEffect, useState } from 'react'
import { Animated, Easing, Modal, StyleSheet, useWindowDimensions } from 'react-native'
import { useTheme } from '../../hooks/useTheme'

/**
 * Modal for bottom sheets: the shade fades in place while only the sheet
 * slides up (and back down on close). Children draw the sheet itself on a
 * transparent background; the shade comes from here.
 */
export function SheetModal({
  visible,
  onRequestClose,
  children,
}: {
  visible: boolean
  onRequestClose: () => void
  children: React.ReactNode
}): React.ReactElement {
  const { theme } = useTheme()
  const { height } = useWindowDimensions()
  const [mounted, setMounted] = useState(visible)
  const [shade] = useState(() => new Animated.Value(0))
  const [offset] = useState(() => new Animated.Value(height))
  // Keep showing the last open content while the sheet slides away (callers
  // often render nothing once closed).
  const [held, setHeld] = useState<React.ReactNode>(children)
  useLayoutEffect(() => {
    // Copying the open content is the point of this effect; it only runs while open.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (visible) setHeld(children)
  }, [visible, children])
  // Mount as soon as it opens; unmount only after the closing animation.
  if (visible && !mounted) setMounted(true)

  useEffect(() => {
    if (visible) {
      offset.setValue(height)
      Animated.parallel([
        Animated.timing(shade, { toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.spring(offset, { toValue: 0, tension: 80, friction: 14, useNativeDriver: true }),
      ]).start()
      return
    }
    let active = true
    Animated.parallel([
      Animated.timing(shade, { toValue: 0, duration: 180, useNativeDriver: true }),
      Animated.timing(offset, { toValue: height, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]).start(() => {
      if (active) setMounted(false)
    })
    return () => {
      active = false
    }
  }, [visible, height, offset, shade])

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onRequestClose}>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: theme.overlayScrim, opacity: shade }]}
      />
      <Animated.View style={{ flex: 1, transform: [{ translateY: offset }] }}>
        {visible ? children : held}
      </Animated.View>
    </Modal>
  )
}
