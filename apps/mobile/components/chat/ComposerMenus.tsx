import React from 'react'
import { View } from 'react-native'
import { Button, HStack, Host, Image as Symbol, Menu, Picker, Section, Text, Toggle } from '@expo/ui/swift-ui'
import { font, foregroundStyle, frame, menuActionDismissBehavior, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers'
import type { ImageModel, VideoModel } from '@overlay/app-core'
import { useTheme } from '../../hooks/useTheme'
import type { Theme } from '../../constants/theme'

const keepOpen = [menuActionDismissBehavior('disabled')]

/** A composer chip that opens a native menu: SF Symbol label, optional count. */
function MenuChip({ symbol, count = 0, label, chipStyle, children }: { symbol: string; count?: number; label: string; chipStyle: object; children: React.ReactNode }) {
  const { theme, isDark } = useTheme()
  const width = count > 0 ? 52 : 34
  return (
    <View accessibilityLabel={label} style={[chipStyle, { width, paddingHorizontal: 0, overflow: 'hidden', borderColor: count > 0 ? theme.text : theme.border }]}>
      <Host style={{ width, height: 34 }} colorScheme={isDark ? 'dark' : 'light'}>
        <Menu
          label={
            count > 0 ? (
              <HStack spacing={4} modifiers={[frame({ width, height: 34 })]}>
                <Symbol systemName={symbol as never} size={14} color={theme.text as string} />
                <Text modifiers={[font({ size: 13, weight: 'semibold' }), foregroundStyle(theme.text as string)]}>{String(count)}</Text>
              </HStack>
            ) : (
              <Symbol systemName={symbol as never} size={16} color={theme.text as string} modifiers={[frame({ width, height: 34 })]} />
            )
          }
        >
          {children}
        </Menu>
      </Host>
    </View>
  )
}

export function AttachMenu({ chipStyle, onPickImage, onPickCamera, onPickFile }: { chipStyle: object; onPickImage: () => void; onPickCamera: () => void; onPickFile: () => void }) {
  return (
    <MenuChip symbol="plus" label="Add attachment" chipStyle={chipStyle}>
      <Button label="Photo Library" systemImage="photo.on.rectangle" onPress={onPickImage} />
      <Button label="Take Photo" systemImage="camera" onPress={onPickCamera} />
      <Button label="Attach File" systemImage="doc" onPress={onPickFile} />
    </MenuChip>
  )
}

export function ToolsMenu({
  chipStyle,
  tools,
  selectedToolIds,
  onToggleTool,
  memoryAvailable,
  memoryEnabled,
  onToggleMemory,
  requestMode,
  onChangeRequestMode,
  imageModels,
  videoModels,
  generationKind,
  activeGenerationModelId,
  onSelectGeneration,
}: {
  chipStyle: object
  theme?: Theme
  tools: { id: string; label: string }[]
  selectedToolIds: readonly string[]
  onToggleTool: (id: string) => void
  memoryAvailable: boolean
  memoryEnabled: boolean
  onToggleMemory: () => void
  requestMode: 'chat' | 'automate'
  onChangeRequestMode: (mode: 'chat' | 'automate') => void
  imageModels: ImageModel[]
  videoModels: VideoModel[]
  generationKind: 'image' | 'video' | null
  activeGenerationModelId: string | null | undefined
  onSelectGeneration: (kind: 'image' | 'video', id: string | null) => void
}) {
  const generation = (kind: 'image' | 'video', models: { id: string; name: string }[]) =>
    models.length ? (
      <Menu label={kind === 'image' ? 'Generate Image' : 'Generate Video'} systemImage={kind === 'image' ? 'photo' : 'film'}>
        {generationKind === kind ? <Button label="Off" systemImage="xmark" onPress={() => onSelectGeneration(kind, null)} /> : null}
        {models.map((model) => (
          <Button
            key={model.id}
            label={model.name}
            systemImage={generationKind === kind && model.id === activeGenerationModelId ? 'checkmark' : undefined}
            onPress={() => onSelectGeneration(kind, model.id)}
          />
        ))}
      </Menu>
    ) : null
  return (
    <MenuChip symbol="slider.horizontal.3" count={selectedToolIds.length} label={selectedToolIds.length ? `Tools and modes, ${selectedToolIds.length} active` : 'Tools and modes'} chipStyle={chipStyle}>
      {tools.length ? (
        <Section title="Tools for this turn">
          {tools.map((tool) => (
            <Toggle key={tool.id} label={tool.label} isOn={selectedToolIds.includes(tool.id)} onIsOnChange={() => onToggleTool(tool.id)} modifiers={keepOpen} />
          ))}
        </Section>
      ) : null}
      {memoryAvailable ? <Toggle label="Use memory" systemImage="brain" isOn={memoryEnabled} onIsOnChange={onToggleMemory} modifiers={keepOpen} /> : null}
      <Picker label="Mode" systemImage="bolt" selection={requestMode} onSelectionChange={(mode: 'chat' | 'automate') => onChangeRequestMode(mode)} modifiers={[pickerStyle('menu')]}>
        <Text modifiers={[tag('chat')]}>Chat</Text>
        <Text modifiers={[tag('automate')]}>Automate</Text>
      </Picker>
      {imageModels.length || videoModels.length ? (
        <Section title="Generate">
          {generation('image', imageModels)}
          {generation('video', videoModels)}
        </Section>
      ) : null}
    </MenuChip>
  )
}
