import React, { useState } from 'react'
import {
  Modal,
  Pressable,
  ScrollView,
  Switch,
  TextInput,
  View,
} from 'react-native'
import { ChevronDown, ChevronLeft, Search, X } from 'lucide-react-native'
import type { ChatModel } from '@overlay/app-core'
import type { Theme } from '../../constants/theme'
import type { AgentToolGroup } from '../../lib/agentToolGroups'
import type { AgentIdentity } from './AgentThreadViews'
import { AgentAvatar } from '../shell/AgentAvatar'
import { Button, IconButton, T } from '../shell/primitives'

export function AgentEditorView({
  theme,
  dark,
  agent,
  name,
  description,
  modelId,
  models,
  groups,
  enabled,
  onName,
  onDescription,
  onModel,
  onToggle,
  onAdvanced,
  onSave,
  onBack,
  computerPreview,
  busy = false,
  valid = true,
  error,
  isNew = false,
}: {
  theme: Theme
  dark: boolean
  agent: AgentIdentity
  name: string
  description: string
  modelId: string
  models: ChatModel[]
  groups: readonly AgentToolGroup[]
  enabled: ReadonlySet<string>
  onName: (name: string) => void
  onDescription: (description: string) => void
  onModel: (id: string) => void
  onToggle: (id: string) => void
  onAdvanced: () => void
  onSave: () => void
  onBack: () => void
  computerPreview?: React.ReactNode
  busy?: boolean
  valid?: boolean
  error?: string | null
  isNew?: boolean
}) {
  const [picker, setPicker] = useState(false)
  const [query, setQuery] = useState('')
  const field = {
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surfaceSubtle,
    borderRadius: 8,
    padding: 12,
    color: theme.foreground,
    fontFamily: 'Geist',
    fontSize: 14,
  }
  const providers = [...new Set(models.map((model) => model.provider))]
  return (
    <View style={{ flex: 1, backgroundColor: theme.surface }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 10,
          height: 50,
          borderBottomWidth: 1,
          borderColor: theme.border,
        }}
      >
        <IconButton
          icon={ChevronLeft}
          label="Back"
          theme={theme}
          onPress={onBack}
        />
        <T style={{ color: theme.muted, fontSize: 12 }}>Workspace › Agents</T>
      </View>
      <ScrollView
        contentContainerStyle={{ padding: 20, gap: 20 }}
        keyboardShouldPersistTaps="handled"
      >
        <T
          style={{
            color: theme.foreground,
            fontSize: 24,
            fontWeight: '600',
            marginBottom: 4,
          }}
        >
          {isNew ? 'New agent' : 'Edit agent'}
        </T>
        <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
          <AgentAvatar
            agent={{ ...agent, name }}
            dark={dark}
            foreground={theme.foreground}
            size={48}
          />
          <Button theme={theme} secondary disabled={busy} onPress={onAdvanced}>
            Change appearance
          </Button>
        </View>
        <View style={{ gap: 8 }}>
          <T style={{ color: theme.muted, fontSize: 12 }}>Name</T>
          <TextInput
            accessibilityLabel="Agent name"
            value={name}
            onChangeText={onName}
            editable={!busy}
            style={field}
          />
        </View>
        <View style={{ gap: 8 }}>
          <T style={{ color: theme.muted, fontSize: 12 }}>Description</T>
          <TextInput
            accessibilityLabel="Agent description"
            value={description}
            onChangeText={onDescription}
            editable={!busy}
            multiline
            style={[
              field,
              { minHeight: 78, textAlignVertical: 'top', lineHeight: 21 },
            ]}
          />
        </View>
        <View style={{ gap: 8 }}>
          <T style={{ color: theme.muted, fontSize: 12 }}>Model</T>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose agent model"
            disabled={busy}
            onPress={() => setPicker(true)}
            style={[
              field,
              {
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              },
            ]}
          >
            <T style={{ color: theme.foreground, fontSize: 13 }}>
              {models.find((model) => model.id === modelId)?.name ??
                (modelId || 'Auto')}
            </T>
            <ChevronDown size={14} color={theme.muted} />
          </Pressable>
        </View>
        <T style={{ color: theme.muted, fontSize: 11, marginTop: 4 }}>
          Tools and permissions
        </T>
        <View>
          {groups.map((group) => (
            <View
              key={group.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                minHeight: 49,
                borderBottomWidth: 1,
                borderColor: theme.border,
              }}
            >
              <T style={{ color: theme.foreground, flex: 1, fontSize: 13 }}>
                {group.label}
              </T>
              <Switch
                accessibilityLabel={group.label}
                value={enabled.has(group.id)}
                disabled={busy}
                onValueChange={() => onToggle(group.id)}
                trackColor={{ false: theme.border, true: theme.toggleBgActive }}
                thumbColor={theme.toggleThumb}
              />
            </View>
          ))}
        </View>
        {computerPreview}
        {error ? (
          <T accessibilityRole="alert" style={{ color: theme.foreground }}>
            {error}
          </T>
        ) : null}
        <Button
          theme={theme}
          secondary
          disabled={busy || !valid}
          onPress={onSave}
        >
          {busy ? 'Saving…' : isNew ? 'Create agent' : 'Save changes'}
        </Button>
        <Button theme={theme} disabled={busy} onPress={onAdvanced}>
          Instructions and more settings
        </Button>
      </ScrollView>
      <Modal
        transparent
        visible={picker}
        animationType="slide"
        onRequestClose={() => setPicker(false)}
      >
        <View
          style={{
            flex: 1,
            justifyContent: 'flex-end',
            backgroundColor: theme.scrim,
          }}
        >
          <View
            style={{
              maxHeight: '85%',
              backgroundColor: theme.surface,
              padding: 20,
              paddingBottom: 34,
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              gap: 14,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <T
                style={{ flex: 1, color: theme.foreground, fontWeight: '600' }}
              >
                Choose model
              </T>
              <IconButton
                icon={X}
                label="Close model picker"
                theme={theme}
                onPress={() => setPicker(false)}
              />
            </View>
            <View
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
            >
              <Search size={15} color={theme.muted} />
              <TextInput
                accessibilityLabel="Search models"
                placeholder="Search models"
                placeholderTextColor={theme.muted}
                value={query}
                onChangeText={setQuery}
                style={[field, { flex: 1 }]}
              />
            </View>
            <ScrollView>
              {providers.map((provider) => (
                <View key={provider}>
                  <T
                    style={{
                      color: theme.muted,
                      fontSize: 11,
                      paddingVertical: 10,
                    }}
                  >
                    {provider}
                  </T>
                  {models
                    .filter(
                      (model) =>
                        model.provider === provider &&
                        `${model.name} ${provider}`
                          .toLowerCase()
                          .includes(query.toLowerCase()),
                    )
                    .map((model) => (
                      <Button
                        key={model.id}
                        theme={theme}
                        secondary={model.id === modelId}
                        onPress={() => {
                          onModel(model.id)
                          setPicker(false)
                        }}
                      >
                        {model.name}
                      </Button>
                    ))}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  )
}
