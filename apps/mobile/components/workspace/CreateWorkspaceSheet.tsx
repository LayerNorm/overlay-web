/**
 * Create-workspace sheet — mirrors the web workspace-creator dialog:
 * name input → POST /workspaces → the new organization workspace becomes
 * active (WorkspaceContext.createWorkspace handles list refresh + activate
 * + session entitlement refresh).
 */
import React, { useState } from 'react'
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import type { Theme } from '../../constants/theme'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { BottomSheet } from '../ui/AppChrome'

export function CreateWorkspaceSheet({
  visible,
  theme,
  onClose,
  onCreated,
}: {
  visible: boolean
  theme: Theme
  onClose: () => void
  /** Called after the workspace is created and activated. */
  onCreated?: () => void
}): React.ReactElement {
  const { createWorkspace } = useWorkspace()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setError(null)
    try {
      await createWorkspace(trimmed)
      setName('')
      onClose()
      onCreated?.()
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create workspace')
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet
      theme={theme}
      visible={visible}
      onClose={onClose}
      title="New workspace"
    >
      <View style={styles.form}>
        <Text style={[styles.hint, { color: theme.textSecondary }]}>
          Workspaces hold shared agents, channels, files, and their own billing wallet.
        </Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Workspace name"
          placeholderTextColor={theme.textDisabled}
          autoFocus
          maxLength={64}
          style={[
            styles.input,
            { color: theme.text, backgroundColor: theme.surfaceSubtle, borderColor: theme.border },
          ]}
        />
        {error ? <Text style={[styles.error, { color: '#EF4444' }]}>{error}</Text> : null}
        <TouchableOpacity
          activeOpacity={0.85}
          disabled={busy || !name.trim()}
          onPress={() => void handleCreate()}
          style={[
            styles.submit,
            { backgroundColor: theme.foreground, opacity: name.trim() ? 1 : 0.45 },
          ]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={theme.background} />
          ) : (
            <Text style={[styles.submitText, { color: theme.background }]}>Create workspace</Text>
          )}
        </TouchableOpacity>
      </View>
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  form: { gap: spacing.sm },
  hint: { fontSize: fontSize.sm, lineHeight: 19 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    fontSize: fontSize.md,
  },
  error: { fontSize: fontSize.sm },
  submit: {
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginTop: spacing.xs,
  },
  submitText: { fontSize: fontSize.sm, fontWeight: '700' },
})
