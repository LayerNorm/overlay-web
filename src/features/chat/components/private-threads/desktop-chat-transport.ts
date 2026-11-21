import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'
import type { DesktopBridge, Input } from '@overlay/desktop-bridge'
import type { LocalThreadOwner } from '@/components/desktop/useLocalThreads'

export type PrivateTurnSettings = Pick<Input<'localThreads.send'>, 'model' | 'agent' | 'approvalMode'>

/**
 * Sends a private thread's turn to the desktop app and reads its reply back as an AI SDK UI message stream. The reply
 * comes over the desktop bridge's event channel, never the network.
 */
export class DesktopChatTransport implements ChatTransport<UIMessage> {
  private settings: PrivateTurnSettings | null = null

  constructor(private readonly options: {
    bridge: DesktopBridge
    owner: LocalThreadOwner
    threadId: string
  }) {}

  /** The model and agent the next turn uses; a model chosen after the page loaded applies to the next send. */
  applySettings(settings: PrivateTurnSettings | null): void {
    this.settings = settings
  }

  async sendMessages({ messages, abortSignal }: Parameters<ChatTransport<UIMessage>['sendMessages']>[0]): Promise<ReadableStream<UIMessageChunk>> {
    const { bridge, owner, threadId } = this.options
    const settings = this.settings
    if (!settings) throw new Error('Add a model key in Settings → Desktop to run private threads.')
    const turnId = `turn_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    let offChunk = () => {}
    let offTurn = () => {}
    const stream = new ReadableStream<UIMessageChunk>({
      start(controller) {
        const finish = (error?: string) => {
          offChunk()
          offTurn()
          try {
            if (error) controller.error(new Error(error))
            else controller.close()
          } catch { /* already closed */ }
        }
        offChunk = bridge.on('localThreads.chunk', (event) => {
          if (event.threadId === threadId && event.turnId === turnId) controller.enqueue(event.chunk as UIMessageChunk)
        })
        offTurn = bridge.on('localThreads.turn', (event) => {
          if (event.threadId !== threadId || event.turnId !== turnId || event.state === 'running') return
          finish(event.state === 'error' && event.error ? event.error : undefined)
        })
        abortSignal?.addEventListener('abort', () => {
          void bridge.call('localThreads.stop', { owner, threadId }).catch(() => undefined)
        }, { once: true })
      },
      cancel() {
        offChunk()
        offTurn()
      },
    })
    try {
      await bridge.call('localThreads.send', {
        owner, threadId, turnId,
        messages: messages as unknown as Input<'localThreads.send'>['messages'],
        ...settings,
      })
    } catch (error) {
      offChunk()
      offTurn()
      throw error
    }
    return stream
  }

  /** A reply that was running when the page opened is shown from disk when it ends; there is no stream to rejoin. */
  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null
  }
}
