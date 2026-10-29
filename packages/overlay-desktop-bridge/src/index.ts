import { z } from 'zod'

export const BRIDGE_VERSION = 1 as const
export const BRIDGE_CHANNEL = 'overlay-desktop:call'
export const BRIDGE_EVENT = 'overlay-desktop:event'
export const capabilities = ['window', 'auth', 'hotkeys', 'panels', 'transcription', 'capture', 'notifications', 'agentHost', 'updates'] as const
export type Capability = typeof capabilities[number]
const empty = z.undefined()
const panel = z.object({ kind: z.enum(['chat', 'notes']) }).strict()
const modelId = z.enum(['parakeet_v2', 'parakeet_v3', 'openai_whisper-base', 'openai_whisper-small', 'openai_whisper-large-v3_turbo'])
export const methodSchemas = {
  handshake: empty,
  'window.openDataFolder': empty,
  'window.openExternal': z.object({ url: z.string().max(4096).url().refine((value) => ['https:', 'http:', 'mailto:'].includes(new URL(value).protocol)) }).strict(),
  'window.setBadgeCount': z.object({ count: z.number().int().min(0).max(99999) }).strict(),
  'auth.signIn': z.object({ force: z.boolean().optional() }).strict(),
  'auth.signedOut': empty,
  'hotkeys.list': empty,
  'hotkeys.set': z.object({ id: z.enum(['dictation', 'chat', 'notes']), accelerator: z.string().min(1).max(100) }).strict(),
  'hotkeys.reset': z.object({ id: z.enum(['dictation', 'chat', 'notes']) }).strict(),
  'panels.show': panel,
  'panels.hide': panel,
  'panels.toggle': panel,
  'panels.setDocked': panel.extend({ edge: z.enum(['left', 'right', 'none']) }),
  'transcription.status': empty,
  'transcription.start': z.object({ target: z.enum(['composer', 'system']), model: z.union([modelId, z.literal('cloud')]) }).strict(),
  'transcription.stop': empty,
  'transcription.transcribe': z.object({ audio: z.instanceof(Uint8Array).refine((v) => v.byteLength > 0 && v.byteLength <= 25 * 1024 * 1024), mime: z.enum(['audio/webm', 'audio/mp4', 'audio/wav']), model: z.union([modelId, z.literal('cloud')]) }).strict(),
  'transcription.listModels': empty,
  'transcription.downloadModel': z.object({ id: modelId }).strict(),
  'transcription.configure': z.object({ model: z.union([modelId, z.literal('cloud')]) }).strict(),
  'capture.screenshot': z.object({ display: z.string().max(100).optional() }).strict(),
  'notifications.show': z.object({ title: z.string().min(1).max(200), body: z.string().max(2000), route: z.string().max(2048).startsWith('/app').refine((v) => !v.startsWith('//') && !v.includes('\\')) }).strict(),
  'agentHost.status': empty,
  'agentHost.start': z.object({ adapter: z.enum(['claude-code', 'codex', 'hermes']), enrollmentCode: z.string().min(6).max(200) }).strict(),
  'agentHost.stop': empty,
  'agentHost.logs': empty,
  'updates.status': empty,
  'updates.check': empty,
  'updates.install': empty,
} as const
export type Method = keyof typeof methodSchemas
export type Input<M extends Method> = z.input<typeof methodSchemas[M]>
export type Handshake = { bridgeVersion: 1; appVersion: string; platform: string; capabilities: Capability[] }
export type HostStatus = { state: string; adapterId: string | null; pid: number | null; logTail: string[] }
export type UpdateStatus = { state: string; version?: string; percent?: number; message?: string }
export type TranscriptionStatus = { recording: boolean; model: string; microphone: string; accessibility: boolean }
export type Model = { id: string; name: string; downloaded: boolean }
export type Results = {
  handshake: Handshake
  'window.openDataFolder': void; 'window.openExternal': void; 'window.setBadgeCount': void
  'auth.signIn': void; 'auth.signedOut': void
  'hotkeys.list': Record<'dictation' | 'chat' | 'notes', string>
  'hotkeys.set': void; 'hotkeys.reset': void
  'panels.show': void; 'panels.hide': void; 'panels.toggle': void; 'panels.setDocked': void
  'transcription.status': TranscriptionStatus
  'transcription.start': void; 'transcription.stop': void
  'transcription.transcribe': { text: string }
  'transcription.listModels': Model[]; 'transcription.downloadModel': void; 'transcription.configure': void
  'capture.screenshot': { dataUrl: string; name: string }
  'notifications.show': void
  'agentHost.status': HostStatus; 'agentHost.start': HostStatus; 'agentHost.stop': HostStatus; 'agentHost.logs': string[]
  'updates.status': UpdateStatus; 'updates.check': UpdateStatus; 'updates.install': void
}
export type Events = {
  'window.focus': boolean
  'notifications.click': string
  'agentHost.status': HostStatus
  'updates.status': UpdateStatus
  'transcription.start': { target: 'composer' | 'system'; model: string }
  'transcription.stop': undefined
  'transcription.final': { text: string }
}
export interface DesktopBridge {
  handshake(): Promise<Handshake>
  call<M extends Method>(method: M, input: Input<M>): Promise<Results[M]>
  on<E extends keyof Events>(event: E, callback: (value: Events[E]) => void): () => void
}
export function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null
  const bridge = (window as unknown as { overlayDesktop?: DesktopBridge }).overlayDesktop
  return bridge && typeof bridge.handshake === 'function' && typeof bridge.call === 'function' && typeof bridge.on === 'function' ? bridge : null
}
export function capabilityForMethod(method: Method): Capability | null {
  return method === 'handshake' ? null : method.split('.')[0] as Capability
}
export function isTrustedFrame(frameUrl: string, isMainFrame: boolean, origin: string): boolean {
  try { return isMainFrame && new URL(frameUrl).origin === origin } catch { return false }
}
export async function openExternal(url: string): Promise<void> {
  const parsed = new URL(url, typeof location === 'undefined' ? undefined : location.href)
  if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) throw new Error('Unsupported external URL')
  const bridge = getDesktopBridge()
  if (bridge && (await bridge.handshake()).capabilities.includes('window')) {
    await bridge.call('window.openExternal', { url: parsed.href })
  } else if (typeof window !== 'undefined') {
    window.open(parsed.href, '_blank', 'noopener,noreferrer')
  }
}
