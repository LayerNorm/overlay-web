import React, { useCallback, useState } from 'react'
import { Alert } from 'react-native'
import { Stack, useFocusEffect, useRouter } from 'expo-router'
import {
  Button,
  ContentUnavailableView,
  ContextMenu,
  Form,
  HStack,
  Host,
  Image as Symbol,
  Section,
  Spacer,
  Text,
  VStack,
} from '@expo/ui/swift-ui'
import { font, foregroundStyle, frame, lineLimit, tint } from '@expo/ui/swift-ui/modifiers'
import { useTheme } from '../../hooks/useTheme'
import { useAppSession } from '../../contexts/AppSessionContext'
import type { ChatMeta } from '../../services/chatTypes'
import { loadArchivedChats } from '../../services/chatStorage'
import { deleteConversation, unarchiveConversation } from '../../services/conversationActionsService'
import { FeatureGate } from '../ui/FeatureGate'
import { RoomConfirmDialog, type RoomConfirmation } from './RoomSheets'

const secondary = foregroundStyle({ type: 'hierarchical', style: 'secondary' })

function archivedOn(chat: ChatMeta) {
  return chat.archivedAt
    ? `Archived ${new Date(chat.archivedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    : 'Archived'
}

/**
 * Archived conversations as a native list with the system search bar. Touch
 * and hold a chat to unarchive or delete it.
 */
export function ArchivedScreen(): React.ReactElement {
  const { theme, isDark } = useTheme()
  const router = useRouter()
  const { capabilities } = useAppSession()
  const [chats, setChats] = useState<ChatMeta[] | null>(null)
  const [query, setQuery] = useState('')
  const [confirmation, setConfirmation] = useState<RoomConfirmation | null>(null)

  useFocusEffect(
    useCallback(() => {
      let active = true
      loadArchivedChats()
        .then((items) => { if (active) setChats(items) })
        .catch(() => { if (active) setChats((current) => current ?? []) })
      return () => { active = false }
    }, []),
  )

  const drop = (id: string) => setChats((current) => current?.filter((chat) => chat.id !== id) ?? null)
  const unarchive = (chat: ChatMeta) => {
    drop(chat.id)
    void unarchiveConversation(chat.id).catch((error) => {
      setChats((current) => (current ? [chat, ...current] : [chat]))
      Alert.alert('Could not unarchive the chat', error instanceof Error ? error.message : 'Try again in a moment.')
    })
  }
  const remove = (chat: ChatMeta) =>
    setConfirmation({
      title: `Delete “${chat.title || 'this chat'}”?`,
      message: 'This can’t be undone.',
      label: 'Delete chat',
      destructive: true,
      run: () => {
        drop(chat.id)
        void deleteConversation(chat.id).catch((error) => {
          setChats((current) => (current ? [chat, ...current] : [chat]))
          Alert.alert('Could not delete the chat', error instanceof Error ? error.message : 'Try again in a moment.')
        })
      },
    })

  if (!capabilities.chat) return <FeatureGate title="Chat is turned off" />

  const needle = query.trim().toLowerCase()
  const visible = (chats ?? []).filter((chat) => !needle || chat.title.toLowerCase().includes(needle))
  return (
    <>
      <Stack.Screen
        options={{
          headerSearchBarOptions: {
            placeholder: 'Search archived chats',
            hideWhenScrolling: true,
            onChangeText: (event) => setQuery(event.nativeEvent.text),
            onCancelButtonPress: () => setQuery(''),
          },
        }}
      />
      <Host style={{ flex: 1 }} colorScheme={isDark ? 'dark' : 'light'}>
        {chats !== null && !visible.length ? (
          <ContentUnavailableView
            title={needle ? 'No matches' : 'No archived chats'}
            systemImage={needle ? 'magnifyingglass' : 'archivebox'}
            description={needle ? 'Try a different search.' : 'Chats you archive show up here.'}
          />
        ) : (
          <Form modifiers={[tint(theme.foreground as string)]}>
            <Section footer={chats === null ? <Text>Loading…</Text> : <Text>Touch and hold a chat to unarchive it.</Text>}>
              {visible.map((chat) => {
                const kind = chat.conversationType && chat.conversationType !== 'personal' ? chat.conversationType : null
                return (
                  <ContextMenu key={chat.id}>
                    <ContextMenu.Items>
                      <Button label="Unarchive" systemImage="tray.and.arrow.up" onPress={() => unarchive(chat)} />
                      {/* Channels and DMs are shared rooms; only personal chats can be deleted here. */}
                      {kind ? null : <Button label="Delete" systemImage="trash" role="destructive" onPress={() => remove(chat)} />}
                    </ContextMenu.Items>
                    <ContextMenu.Trigger>
                      <Button onPress={() => router.push((kind ? `/${kind}/${chat.id}` : `/chat/${chat.id}`) as never)}>
                        <HStack spacing={12}>
                          <Symbol
                            systemName={kind === 'channel' ? 'number' : kind === 'dm' ? 'person.2' : 'bubble.left'}
                            size={17}
                            modifiers={[frame({ width: 26 }), secondary]}
                          />
                          <VStack alignment="leading" spacing={2}>
                            <Text modifiers={[lineLimit(1)]}>{chat.title || 'Chat'}</Text>
                            <Text modifiers={[secondary, font({ size: 13 })]}>
                              {kind ? `${kind === 'dm' ? 'Direct message' : 'Channel'} · ${archivedOn(chat)}` : archivedOn(chat)}
                            </Text>
                          </VStack>
                          <Spacer />
                          <Symbol systemName="chevron.right" size={13} modifiers={[secondary]} />
                        </HStack>
                      </Button>
                    </ContextMenu.Trigger>
                  </ContextMenu>
                )
              })}
            </Section>
          </Form>
        )}
      </Host>
      <RoomConfirmDialog request={confirmation} onClose={() => setConfirmation(null)} />
    </>
  )
}
