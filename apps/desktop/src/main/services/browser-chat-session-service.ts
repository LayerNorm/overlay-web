import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'

export interface BrowserChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface BrowserChatSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: BrowserChatMessage[]
  mode: 'ask' | 'act'
}

class BrowserChatSessionService {
  private sessionsPath: string | null = null
  private sessions: BrowserChatSession[] = []

  private getSessionsPath(): string {
    if (!this.sessionsPath) {
      const dataDir = join(app.getPath('userData'), 'browser-chat')
      if (!existsSync(dataDir)) {
        mkdirSync(dataDir, { recursive: true })
      }
      this.sessionsPath = join(dataDir, 'sessions.json')
    }
    return this.sessionsPath
  }

  loadSessions(): BrowserChatSession[] {
    try {
      const path = this.getSessionsPath()
      if (existsSync(path)) {
        const data = readFileSync(path, 'utf-8')
        this.sessions = JSON.parse(data)
        return this.sessions
      }
    } catch (error) {
      console.error('[BrowserChatSession] Failed to load sessions:', error)
    }
    this.sessions = []
    return []
  }

  private saveSessions(): void {
    try {
      const path = this.getSessionsPath()
      writeFileSync(path, JSON.stringify(this.sessions, null, 2), 'utf-8')
    } catch (error) {
      console.error('[BrowserChatSession] Failed to save sessions:', error)
    }
  }

  createSession(mode: 'ask' | 'act'): BrowserChatSession {
    const session: BrowserChatSession = {
      id: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      title: 'New Chat',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      mode
    }
    this.sessions.unshift(session)
    this.saveSessions()
    return session
  }

  updateSession(
    sessionId: string,
    updates: Partial<Pick<BrowserChatSession, 'title' | 'messages' | 'mode'>>
  ): BrowserChatSession | null {
    const idx = this.sessions.findIndex((s) => s.id === sessionId)
    if (idx === -1) return null

    const session = this.sessions[idx]
    if (updates.title !== undefined) session.title = updates.title
    if (updates.messages !== undefined) session.messages = updates.messages
    if (updates.mode !== undefined) session.mode = updates.mode
    session.updatedAt = Date.now()

    // Auto-generate title from first user message if still "New Chat"
    if (session.title === 'New Chat' && session.messages.length > 0) {
      const firstUserMsg = session.messages.find((m) => m.role === 'user')
      if (firstUserMsg) {
        session.title = firstUserMsg.content.slice(0, 50) + (firstUserMsg.content.length > 50 ? '...' : '')
      }
    }

    // Move to front (most recent)
    this.sessions.splice(idx, 1)
    this.sessions.unshift(session)
    this.saveSessions()
    return session
  }

  getSession(sessionId: string): BrowserChatSession | null {
    return this.sessions.find((s) => s.id === sessionId) || null
  }

  deleteSession(sessionId: string): boolean {
    const idx = this.sessions.findIndex((s) => s.id === sessionId)
    if (idx === -1) return false
    this.sessions.splice(idx, 1)
    this.saveSessions()
    return true
  }

  listSessions(): BrowserChatSession[] {
    return this.sessions
  }

  clearAllSessions(): void {
    this.sessions = []
    this.saveSessions()
  }
}

export const browserChatSessionService = new BrowserChatSessionService()
