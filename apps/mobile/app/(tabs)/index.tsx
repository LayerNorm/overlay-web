import React from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useTheme } from '../../hooks/useTheme'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const overlayLogo = require('../../assets/images/logo-big-no-bg.png')

export default function HomeScreen(): React.ReactElement {
  const { theme } = useTheme()
  const router = useRouter()

  const handleNewChat = (): void => {
    router.push('/chat/new')
  }

  const handleNewNote = (): void => {
    router.push('/note/new')
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.content}>
        {/* Logo + overlay text — centered, matching desktop */}
        <View style={styles.logoSection}>
          <Image source={overlayLogo} style={styles.logoImage} resizeMode="contain" />
          <Text style={[styles.appName, { color: theme.text }]}>overlay</Text>
        </View>

        {/* Action buttons — centered below */}
        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: 'transparent' }]}
            onPress={handleNewChat}
            activeOpacity={0.7}
          >
            <Feather name="message-square" size={22} color={theme.textSecondary} />
            <Text style={[styles.actionButtonText, { color: theme.text }]}>New Chat</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: 'transparent' }]}
            onPress={handleNewNote}
            activeOpacity={0.7}
          >
            <Feather name="file-text" size={22} color={theme.textSecondary} />
            <Text style={[styles.actionButtonText, { color: theme.text }]}>New Note</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: -60
  },
  logoSection: {
    alignItems: 'center',
    gap: 12,
    marginBottom: 32
  },
  logoImage: {
    width: 72,
    height: 72
  },
  appName: {
    fontFamily: 'InstrumentSerif-Regular',
    fontSize: 56,
    fontWeight: '400',
    letterSpacing: -0.5,
    lineHeight: 56
  },
  actionButtons: {
    gap: 6
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10
  },
  actionButtonText: {
    fontSize: 17,
    fontWeight: '400'
  }
})
