import type { HttpContext } from '../shared/http'

/** Chat UI helpers (suggestions, title/image/video generation) — distinct from conversation CRUD. */
export class ChatAuxClient {
  constructor(private readonly http: HttpContext) {}

  suggestionsResponse(init?: RequestInit) {
    return this.http.request('/api/v1/chat-suggestions', init)
  }

  generateTitleResponse(body: { text?: string; message?: string }, init?: RequestInit) {
    return this.http.request('/api/v1/generate-title', this.http.jsonRequest(body, { ...init, method: 'POST' }))
  }

  generateTabGroupLabelResponse(body: Record<string, unknown>, init?: RequestInit) {
    return this.http.request(
      '/api/v1/generate-tab-group-label',
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  generateImageResponse(body: Record<string, unknown>, init?: RequestInit) {
    return this.http.request('/api/v1/generate-image', this.http.jsonRequest(body, { ...init, method: 'POST' }))
  }

  generateVideoResponse(body: Record<string, unknown>, init?: RequestInit) {
    return this.http.request('/api/v1/generate-video', this.http.jsonRequest(body, { ...init, method: 'POST' }))
  }

  browserTaskResponse(body: Record<string, unknown>, init?: RequestInit) {
    return this.http.request('/api/v1/browser-task', this.http.jsonRequest(body, { ...init, method: 'POST' }))
  }

  transcribeResponse(body: BodyInit, init?: RequestInit) {
    return this.http.request('/api/v1/transcribe', { ...init, method: 'POST', body })
  }
}
