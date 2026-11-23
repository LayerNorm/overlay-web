import React from 'react'
import {
  BottomSheet,
  Button,
  ConfirmationDialog,
  ContentUnavailableView,
  ContextMenu,
  Group,
  HStack,
  Host,
  Image as Symbol,
  List,
  Section,
  Spacer,
  Text,
  VStack,
} from '@expo/ui/swift-ui'
import {
  font,
  foregroundStyle,
  frame,
  lineLimit,
  listSectionSpacing,
  listStyle,
  padding,
  presentationDetents,
  presentationDragIndicator,
  tint,
} from '@expo/ui/swift-ui/modifiers'
import { useTheme } from '../../hooks/useTheme'

const secondary = foregroundStyle({ type: 'hierarchical', style: 'secondary' })

/** A request for a native confirmation dialog (action sheet). */
export type RoomConfirmation = {
  title: string
  message?: string
  label: string
  destructive?: boolean
  run: () => void
}

/**
 * A native SwiftUI sheet for a room panel: medium/large detents, drag
 * indicator, an inline title with an optional toolbar-style button, and
 * either an inset-grouped list or a system empty state.
 */
function RoomSheet({
  open,
  onClose,
  title,
  action,
  empty,
  confirmation,
  onConfirmationClose,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  action?: { label: string; icon: string; onPress: () => void }
  empty?: { title: string; icon: string; description: string }
  confirmation?: RoomConfirmation | null
  onConfirmationClose?: () => void
  children?: React.ReactNode
}) {
  const { theme, isDark } = useTheme()
  const header = (inset: boolean) => (
    <HStack modifiers={[padding(inset ? { horizontal: 20, top: 24, bottom: 4 } : { top: 8, bottom: 4 })]}>
      <Text modifiers={[font({ size: 20, weight: 'semibold' }), foregroundStyle(theme.foreground)]}>{title}</Text>
      <Spacer />
      {action ? (
        <Button onPress={action.onPress}>
          <Symbol systemName={action.icon as never} size={18} />
        </Button>
      ) : null}
    </HStack>
  )
  return (
    <Host matchContents style={{ position: 'absolute' }} colorScheme={isDark ? 'dark' : 'light'}>
      <BottomSheet isPresented={open} onIsPresentedChange={(presented) => { if (!presented) onClose() }}>
        <Group modifiers={[presentationDetents(['medium', 'large']), presentationDragIndicator('visible'), tint(theme.foreground)]}>
          <ConfirmationDialog
            title={confirmation?.title ?? ''}
            titleVisibility="visible"
            isPresented={Boolean(confirmation)}
            onIsPresentedChange={(presented) => { if (!presented) onConfirmationClose?.() }}
          >
            <ConfirmationDialog.Trigger>
              {empty ? (
                <VStack spacing={0}>
                  {header(true)}
                  <ContentUnavailableView title={empty.title} systemImage={empty.icon as never} description={empty.description} />
                </VStack>
              ) : (
                // The title lives in the list so it shares the grouped background.
                <List modifiers={[listStyle('insetGrouped'), listSectionSpacing('compact')]}>
                  <Section header={header(false)}>{null}</Section>
                  {children}
                </List>
              )}
            </ConfirmationDialog.Trigger>
            <ConfirmationDialog.Actions>
              {confirmation ? (
                <Button
                  label={confirmation.label}
                  role={confirmation.destructive ? 'destructive' : undefined}
                  onPress={() => {
                    confirmation.run()
                    onConfirmationClose?.()
                  }}
                />
              ) : null}
            </ConfirmationDialog.Actions>
            {confirmation?.message ? (
              <ConfirmationDialog.Message>
                <Text>{confirmation.message}</Text>
              </ConfirmationDialog.Message>
            ) : null}
          </ConfirmationDialog>
        </Group>
      </BottomSheet>
    </Host>
  )
}

/** One two-line list row; touch and hold for its actions. */
function MenuRow({
  title,
  detail,
  trailing,
  actions,
}: {
  title: string
  detail: string
  trailing?: string
  actions: { label: string; icon: string; destructive?: boolean; onPress: () => void }[]
}) {
  const row = (
    <HStack spacing={12}>
      <VStack alignment="leading" spacing={2}>
        <Text modifiers={[lineLimit(1)]}>{title}</Text>
        <Text modifiers={[secondary, font({ size: 13 }), lineLimit(2)]}>{detail}</Text>
      </VStack>
      <Spacer />
      {trailing ? <Text modifiers={[secondary, font({ size: 13 })]}>{trailing}</Text> : null}
    </HStack>
  )
  if (actions.length === 0) return row
  return (
    <ContextMenu>
      <ContextMenu.Items>
        {actions.map((action) => (
          <Button
            key={action.label}
            label={action.label}
            systemImage={action.icon as never}
            role={action.destructive ? 'destructive' : undefined}
            onPress={action.onPress}
          />
        ))}
      </ContextMenu.Items>
      <ContextMenu.Trigger>{row}</ContextMenu.Trigger>
    </ContextMenu>
  )
}

export type RoomMemberRow = {
  id: string
  name: string
  status: string
  moderator: boolean
  removable: boolean
}

export function RoomMembersSheet({
  open,
  onClose,
  members,
  roomLabel,
  onAdd,
  onRemove,
}: {
  open: boolean
  onClose: () => void
  members: RoomMemberRow[]
  roomLabel: string
  onAdd?: () => void
  onRemove: (id: string) => void
}) {
  const [confirmation, setConfirmation] = React.useState<RoomConfirmation | null>(null)
  const removable = members.some((member) => member.removable)
  return (
    <RoomSheet
      open={open}
      onClose={onClose}
      title="Members"
      action={onAdd ? { label: 'Add people', icon: 'person.badge.plus', onPress: onAdd } : undefined}
      empty={members.length === 0 ? { title: 'No members yet', icon: 'person.2', description: 'People you add will appear here.' } : undefined}
      confirmation={confirmation}
      onConfirmationClose={() => setConfirmation(null)}
    >
      <Section
        title={`${members.length} member${members.length === 1 ? '' : 's'}`}
        footer={removable ? <Text>Touch and hold a member to remove them.</Text> : undefined}
      >
        {members.map((member) => (
          <MenuRow
            key={member.id}
            title={member.name}
            detail={member.status}
            trailing={member.moderator ? 'Moderator' : undefined}
            actions={
              member.removable
                ? [{
                    label: 'Remove member',
                    icon: 'person.badge.minus',
                    destructive: true,
                    onPress: () =>
                      setConfirmation({
                        title: `Remove ${member.name}?`,
                        message: `They will lose access to ${roomLabel}.`,
                        label: 'Remove',
                        destructive: true,
                        run: () => onRemove(member.id),
                      }),
                  }]
                : []
            }
          />
        ))}
      </Section>
    </RoomSheet>
  )
}

export type RoomMessageRow = { id: string; author: string; text: string }

export function RoomMessagesSheet({
  kind,
  open,
  onClose,
  messages,
  onRemove,
  onCopy,
}: {
  kind: 'pinned' | 'saved'
  open: boolean
  onClose: () => void
  messages: RoomMessageRow[]
  onRemove: (id: string) => void
  onCopy: (text: string) => void
}) {
  const pinned = kind === 'pinned'
  return (
    <RoomSheet
      open={open}
      onClose={onClose}
      title={pinned ? 'Pinned messages' : 'Saved messages'}
      empty={
        messages.length === 0
          ? pinned
            ? { title: 'Nothing pinned', icon: 'pin', description: 'Touch and hold a message and choose Pin.' }
            : { title: 'Nothing saved', icon: 'bookmark', description: 'Touch and hold a message and choose Save.' }
          : undefined
      }
    >
      <Section footer={<Text>{pinned ? 'Touch and hold to copy or unpin.' : 'Touch and hold to copy or remove.'}</Text>}>
        {messages.map((message) => (
          <MenuRow
            key={message.id}
            title={message.author}
            detail={message.text}
            actions={[
              ...(message.text ? [{ label: 'Copy', icon: 'doc.on.doc', onPress: () => onCopy(message.text) }] : []),
              pinned
                ? { label: 'Unpin', icon: 'pin.slash', onPress: () => onRemove(message.id) }
                : { label: 'Remove from saved', icon: 'bookmark.slash', onPress: () => onRemove(message.id) },
            ]}
          />
        ))}
      </Section>
    </RoomSheet>
  )
}

/**
 * Root-level native confirmation dialog for room actions (delete, report),
 * replacing JS alerts. Mount once; drive it with `request`.
 */
export function RoomConfirmDialog({ request, onClose }: { request: RoomConfirmation | null; onClose: () => void }) {
  const { isDark } = useTheme()
  // The dialog points at its anchor, so keep the invisible anchor mid-screen.
  return (
    <Host matchContents style={{ position: 'absolute', left: '50%', top: '42%' }} colorScheme={isDark ? 'dark' : 'light'}>
      <ConfirmationDialog
        title={request?.title ?? ''}
        titleVisibility="visible"
        isPresented={Boolean(request)}
        onIsPresentedChange={(presented) => { if (!presented) onClose() }}
      >
        <ConfirmationDialog.Trigger>
          <Text modifiers={[frame({ width: 0, height: 0 })]}>{' '}</Text>
        </ConfirmationDialog.Trigger>
        <ConfirmationDialog.Actions>
          {request ? (
            <Button
              label={request.label}
              role={request.destructive ? 'destructive' : undefined}
              onPress={() => {
                request.run()
                onClose()
              }}
            />
          ) : null}
        </ConfirmationDialog.Actions>
        {request?.message ? (
          <ConfirmationDialog.Message>
            <Text>{request.message}</Text>
          </ConfirmationDialog.Message>
        ) : null}
      </ConfirmationDialog>
    </Host>
  )
}
