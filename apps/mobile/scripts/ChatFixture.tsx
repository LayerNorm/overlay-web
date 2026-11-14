import React, { useState } from 'react'
import { ScrollView, View } from 'react-native'
import { BatteryFull, Hash, MessageSquare, Signal, Wifi } from 'lucide-react-native'
import { getTheme } from '../constants/theme'
import { ThemeProvider } from '../hooks/useTheme'
import { T } from '../components/shell/primitives'
import { ChatHeader, ChatSheet, EmptyPersonalChat } from '../components/chat/ChatViews'
import { ModelPicker } from '../components/chat/ModelPicker'
import { Composer } from '../components/chat/Composer'
import { MessageBubble } from '../components/chat/MessageBubble'
import { RoomMessageItem } from '../components/chat/RoomMessageItem'
import { RoomMessageActions } from '../components/chat/RoomMessageActions'
import type { ChatModel } from '@overlay/app-core'
import type { RoomMessageView } from '../lib/roomMessages'

const models: ChatModel[] = [
  { id: 'anthropic/claude-opus-4.7', name: 'Claude Opus 4.7', provider: 'anthropic', supportsVision: true, supportsReasoning: true },
  { id: 'gpt-5.4', name: 'GPT-5.4', provider: 'openai', supportsVision: true, supportsReasoning: true },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'anthropic', supportsVision: true, supportsReasoning: true },
  { id: 'openai/gpt-5.4-mini', name: 'GPT-5.4 mini', provider: 'openai', supportsVision: true, supportsReasoning: true },
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', provider: 'google', supportsVision: true, supportsReasoning: true },
].map(model => ({ ...model, cost: 1, intelligence: 0, speedTier: 2, supportsSearch: false }))
const output = 'Start with one clear outcome: a small group of people using the product and telling you what matters.\n\n### Three priorities\n\n**1. Make the first minute feel effortless.**\nTest sign in and the first conversation on a real phone.\n\n**2. Invite a small, thoughtful group.**\nChoose people who will give specific feedback.\n\n**3. Keep a short feedback loop.**\nReview what you learn at the end of each day.\n\n'
const roomTexts = ['The mobile beta is ready for a final pass. Can we check onboarding today?', 'I’ll test the flow and share a short checklist here.', 'I found two small copy issues. Adding notes now.']

export function ChatFixture({ initialScreen = 'personal-new', dark = false, error = false, onAction = () => {} }: { initialScreen?: string; dark?: boolean; error?: boolean; animate?: boolean; onAction?: (action: string) => void }) {
  const theme = getTheme(dark)
  const [screen, setScreen] = useState(initialScreen)
  const [input, setInput] = useState('')
  const [stopped, setStopped] = useState(false)
  const [picker, setPicker] = useState(initialScreen === 'model-picker')
  const [actions, setActions] = useState(initialScreen === 'message-thread')
  const [actionMine, setActionMine] = useState(true)
  const [selected, setSelected] = useState('Auto')
  const [favoriteIds, setFavorites] = useState(['anthropic/claude-opus-4.7', 'gpt-5.4'])
  const [failure, setFailure] = useState('')
  const [extra, setExtra] = useState<string[]>([])
  const room = screen === 'channel-room' || screen === 'message-thread'
  const thread = screen === 'message-thread'
  const streaming = screen === 'personal-stream' && !stopped
  const views: RoomMessageView[] = roomTexts.map((text, index) => ({ id: String(index), mine: false, authorKind: index ? 'agent' : 'human', authorName: ['Divyansh Lalwani', 'Builder', 'Scout'][index], authorShape: 'circle', authorColor: ['#999', '#77a677', '#aa8877'][index], createdAt: new Date(2026, 10, 11, 10, 32 + index).getTime(), text, blocks: [], images: [], documentNames: [] }))
  if (thread) views.push({ id: 'own', mine: true, authorKind: 'human', authorName: 'You', createdAt: new Date(2026, 10, 11, 10, 35).getTime(), text: 'I’ll verify those changes.', blocks: [], images: [], documentNames: [] })
  const act = (action: string) => { if (error) { setFailure('Could not save. Please try again.'); return } onAction(action); setActions(false) }
  return <ThemeProvider><View style={{ flex: 1, backgroundColor: theme.background }}>
    <View style={{ height: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, backgroundColor: theme.surface }}><T style={{ fontSize: 12, color: theme.foreground }}>9:41</T><View style={{ flexDirection: 'row', gap: 5 }}><Signal size={13} color={theme.foreground} /><Wifi size={13} color={theme.foreground} /><BatteryFull size={17} color={theme.foreground} /></View></View>
    <View style={{ flex: 1 }}>
      <ChatHeader theme={theme} title={room ? thread ? 'Thread' : '#product' : screen === 'personal-new' ? 'New chat' : 'Launch week'} onDrawer={() => act('drawer')} onNew={() => { setScreen('personal-new'); setStopped(false) }} onOptions={() => setActions(true)} />
      {screen === 'personal-new' ? <EmptyPersonalChat theme={theme} onSuggest={setInput} /> : <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 78, paddingBottom: 16 }}>
        {room ? <><View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, marginBottom: 18 }}>{thread ? <MessageSquare size={15} color={theme.muted} /> : <Hash size={15} color={theme.muted} />}<T style={{ color: theme.foreground, fontSize: 13, fontWeight: '600' }}>{thread ? 'Thread' : 'product'}</T>{thread ? <T style={{ color: theme.muted, fontSize: 11 }}>in #product</T> : null}</View><T style={{ textAlign: 'center', color: theme.muted, fontSize: 11, marginBottom: 16 }}>Today</T>{views.map((view, index) => <RoomMessageItem key={view.id} theme={theme} view={view} reactions={index === 0 ? [{ emoji: '👍', count: 2, reactedByCurrentPrincipal: false }, { emoji: '✅', count: 1, reactedByCurrentPrincipal: false }] : []} replyCount={!thread && index === 0 ? 3 : 0} onOpenThread={() => setScreen('message-thread')} onToggleReaction={emoji => act('react:' + emoji)} onLongPress={target => { setActionMine(target.mine); setActions(true) }} />)}</> : <><MessageBubble theme={theme} message={{ id: 'u', role: 'user', timestamp: 0, content: 'Help me plan a focused launch week.' }} /><MessageBubble theme={theme} message={{ id: 'a', role: 'assistant', timestamp: 1, content: output + (streaming ? 'Unfinished paragraph' : ''), responses: [{ modelId: 'model', modelName: 'Model', provider: 'anthropic', content: output + (streaming ? 'Unfinished paragraph' : ''), isLoading: streaming }] }} /></>}
        {extra.map((text, index) => <MessageBubble key={index} theme={theme} message={{ id: String(index), role: 'user', timestamp: index, content: text }} />)}
      </ScrollView>}
      <View style={{ padding: 16, paddingBottom: 24 }}><Composer theme={theme} inputValue={input} onChangeInput={setInput} onSend={() => { if (error) { setFailure('Could not send. Your draft is ready to retry.'); return } setExtra(values => [...values, input]); setInput(''); setScreen(room ? screen : 'personal-stream'); setStopped(true); onAction('sent') }} onStop={() => { setStopped(true); onAction('stopped') }} isSending={streaming} placeholder={room ? thread ? 'Reply in thread' : 'Message #product' : undefined} modelLabel={selected} onModel={room ? undefined : () => setPicker(true)} imageBase64={null} onClearImage={() => {}} pendingDocuments={[]} onRemoveDocument={() => {}} attachmentError={failure} onPickImage={() => act('image')} onPickCamera={() => act('camera')} onPickFile={() => act('file')} mentions={[]} onAddMention={() => {}} onRemoveMention={() => {}} capabilities={null} selectedToolIds={[]} onToggleTool={() => {}} memoryEnabled={false} onToggleMemory={() => {}} requestMode="chat" onChangeRequestMode={() => {}} imageModels={[]} videoModels={[]} generationKind={null} selectedImageModelId={null} selectedVideoModelId={null} onSelectGeneration={() => {}} replyContext={null} onClearReply={() => {}} showToolsButton={false} /></View>
    </View>
    <ChatSheet theme={theme} modelPicker title="Choose a model" visible={picker} onClose={() => setPicker(false)}><ModelPicker theme={theme} models={models} imageModels={[{ id: 'image', name: 'Image model', provider: 'google' }]} videoModels={[{ id: 'video', name: 'Video model', provider: 'google', billingUnit: 'per_video' }]} selectedId={selected} autoSelected={selected === 'Auto'} favoriteIds={favoriteIds} onFavorite={id => setFavorites(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id])} onAuto={() => { setSelected('Auto'); setPicker(false) }} onSelect={(_, id) => { setSelected(models.find(model => model.id === id)?.name ?? id); setPicker(false) }} /></ChatSheet>
    <ChatSheet theme={theme} title="Message actions" visible={actions} onClose={() => setActions(false)}><RoomMessageActions theme={theme} mine={actionMine} onReact={emoji => act('react:' + emoji)} onAction={act} />{failure ? <T style={{ color: theme.danger }}>{failure}</T> : null}</ChatSheet>
  </View></ThemeProvider>
}
