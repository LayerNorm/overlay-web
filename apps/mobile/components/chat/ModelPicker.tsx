import { NativeSegmented } from '../navigation/NativeSegmented'
/* eslint-disable @typescript-eslint/no-require-imports */
import React, { useMemo, useRef, useState } from 'react'
import { Image, Pressable, ScrollView, TextInput, View } from 'react-native'
import { Check, Lock, ScanEye, Search, Sparkles, Star } from 'lucide-react-native'
import type { ChatModel, ImageModel, VideoModel } from '@overlay/app-core'
import type { Theme } from '../../constants/theme'
import { modelSections, type ModelItem } from '../../lib/chatModels'
import { T } from '../shell/primitives'

export type ModelMode = 'text' | 'image' | 'video'
const logos = {
  openai: require('../../assets/model-logos/openai.png'), anthropic: require('../../assets/model-logos/anthropic.png'), google: require('../../assets/model-logos/google.png'), xai: require('../../assets/model-logos/xai.png'), deepseek: require('../../assets/model-logos/deepseek.png'), groq: require('../../assets/model-logos/groq.png'), nvidia: require('../../assets/model-logos/nvidia.png'), meta: require('../../assets/model-logos/meta.png'), mistral: require('../../assets/model-logos/mistral.png'), minimax: require('../../assets/model-logos/minimax-color.png'), moonshotai: require('../../assets/model-logos/moonshot.png'), zai: require('../../assets/model-logos/zai-actual.png'), alibaba: require('../../assets/model-logos/qwen.png'),
}
function ProviderLogo({ provider, theme }: { provider: string; theme: Theme }) {
  const logo = logos[provider.replace('z-ai', 'zai') as keyof typeof logos]
  return logo ? <Image source={logo} alt="" resizeMode="contain" style={{ width: 15, height: 15, tintColor: ['openai', 'anthropic', 'xai', 'moonshotai'].includes(provider) ? theme.foreground : undefined }} /> : <T style={{ color: theme.muted, fontSize: 11 }}>{provider.slice(0, 1).toUpperCase()}</T>
}

export function ModelPicker({ theme, models, imageModels = [], videoModels = [], selectedId, favoriteIds, onFavorite, onSelect, onAuto, autoSelected = false, mode: initialMode = 'text', isLocked = () => false, fill = false }: { /** Fill the parent's height (inside a sheet) instead of a fixed 500pt list. */ fill?: boolean; theme: Theme; models: readonly ChatModel[]; imageModels?: readonly ImageModel[]; videoModels?: readonly VideoModel[]; selectedId?: string; favoriteIds: readonly string[]; onFavorite: (id: string) => void; onSelect: (mode: ModelMode, id: string) => void; onAuto: () => void; autoSelected?: boolean; mode?: ModelMode; isLocked?: (model: ModelItem) => boolean }) {
  const [mode, setMode] = useState(initialMode)
  const [query, setQuery] = useState('')
  const scroll = useRef<ScrollView>(null)
  const positions = useRef<Record<string, number>>({})
  const catalog: readonly ModelItem[] = mode === 'text' ? models : mode === 'image' ? imageModels : videoModels
  const sections = useMemo(() => modelSections(catalog, favoriteIds, query), [catalog, favoriteIds, query])
  return <View style={{ gap: 14, ...(fill ? { flex: 1 } : null) }}>
    <NativeSegmented value={mode} onChange={(value) => { setMode(value); scroll.current?.scrollTo({ y: 0 }) }} options={(['text', 'image', 'video'] as const).map((value) => ({ label: value[0].toUpperCase() + value.slice(1), value }))} />
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.surfaceSubtle, paddingHorizontal: 12, borderRadius: 8 }}><Search size={15} color={theme.muted} /><TextInput accessibilityLabel="Search models" placeholder="Search models" placeholderTextColor={theme.muted} value={query} onChangeText={setQuery} style={{ flex: 1, paddingVertical: 11, color: theme.foreground, fontFamily: 'Geist', fontSize: 13 }} /></View>
    {mode === 'text' ? <Pressable accessibilityRole="button" accessibilityLabel="Auto" disabled={!models.length} accessibilityState={{ selected: autoSelected, disabled: !models.length }} onPress={onAuto} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 38, paddingHorizontal: 10 }}><Sparkles size={15} color={theme.muted} /><T style={{ flex: 1, color: theme.foreground, fontSize: 13 }}>Auto</T>{autoSelected ? <Check size={14} color={theme.foreground} /> : null}</Pressable> : null}
    <View style={{ flexDirection: 'row', ...(fill ? { flex: 1 } : { height: 500 }) }}>
      <ScrollView style={{ width: 38, flexGrow: 0, borderRightWidth: 1, borderRightColor: theme.border }}>{sections.map(section => <Pressable key={section.id} accessibilityRole="button" accessibilityLabel={`Jump to ${section.label}`} onPress={() => scroll.current?.scrollTo({ y: positions.current[section.id] ?? 0, animated: true })} style={{ height: 40, alignItems: 'center', justifyContent: 'center' }}>{section.provider ? <ProviderLogo provider={section.provider} theme={theme} /> : <Star size={15} color={theme.muted} />}</Pressable>)}</ScrollView>
      <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ paddingLeft: 12, paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
        {!sections.length ? <T accessibilityRole="text" style={{ color: theme.muted, padding: 12 }}>{query ? 'No models found.' : 'No models available in this mode.'}</T> : null}
        {sections.map(section => <View key={section.id} onLayout={event => { positions.current[section.id] = event.nativeEvent.layout.y }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10 }}>{section.provider ? <ProviderLogo provider={section.provider} theme={theme} /> : null}<T style={{ fontSize: 11, color: theme.muted }}>{section.label}</T></View>{section.models.map(model => {
          const selected = selectedId === model.id && (mode !== 'text' || !autoSelected)
          return <View key={model.id} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${favoriteIds.includes(model.id) ? 'Unfavorite' : 'Favorite'} ${model.name}`} accessibilityState={{ selected: favoriteIds.includes(model.id) }} hitSlop={6} onPress={() => onFavorite(model.id)} style={{ minHeight: 40, width: 24, justifyContent: 'center' }}><Star size={12} color={theme.muted} fill={favoriteIds.includes(model.id) ? theme.muted : 'none'} /></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={model.name} accessibilityState={{ selected }} onPress={() => onSelect(mode, model.id)} style={{ flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {selected ? <Check size={13} color={theme.foreground} /> : null}<T style={{ flex: 1, fontSize: 12, color: theme.foreground }}>{model.name}</T>{isLocked(model) ? <Lock size={12} color={theme.muted} /> : null}
              {model.supportsVision ? <View style={{ backgroundColor: theme.surfaceSubtle, borderRadius: 3, padding: 3 }}><ScanEye size={11} color={theme.muted} accessibilityLabel="Vision" /></View> : null}
              {model.supportsReasoning ? <View style={{ backgroundColor: theme.surfaceSubtle, borderRadius: 3, padding: 3 }}><Sparkles size={11} color={theme.muted} accessibilityLabel="Reasoning" /></View> : null}
            </Pressable>
          </View>
        })}</View>)}
      </ScrollView>
    </View>
  </View>
}
