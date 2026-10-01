import { afterEach, describe, expect, it, vi } from 'vitest'
import { embedKnowledgeTexts } from './knowledge'

describe('embedKnowledgeTexts', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('applies a 30-second timeout to a stalled embedding request', async () => {
    vi.stubEnv('OVERLAY_PROVIDER_EMBEDDINGS', 'ai-gateway')
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test-key')

    const controller = new AbortController()
    const timeoutError = Object.assign(new Error('embedding request timed out'), {
      name: 'TimeoutError',
    })
    const timeoutSpy = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(controller.signal)

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal)
      controller.abort(timeoutError)
      throw controller.signal.reason
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(embedKnowledgeTexts(['text to embed'])).rejects.toMatchObject({
      name: 'TimeoutError',
    })

    expect(timeoutSpy).toHaveBeenCalledOnce()
    expect(timeoutSpy).toHaveBeenCalledWith(30_000)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('uses the direct OpenAI HTTP endpoint when selected', async () => {
    vi.stubEnv('OVERLAY_PROVIDER_EMBEDDINGS', 'openai')
    vi.stubEnv('OPENAI_API_KEY', 'test-openai-key')
    vi.stubEnv('OPENAI_EMBED_URL', 'https://openai.example.com/v1/embeddings')
    let requestUrl = ''
    let requestModel = ''
    let authorization: string | null = null
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      requestUrl = request.url
      requestModel = JSON.parse(await request.clone().text()).model
      authorization = request.headers.get('authorization')
      return openAIEmbeddingResponse(1536)
    })

    const result = await embedKnowledgeTexts(['text to embed'])

    expect(requestUrl).toBe('https://openai.example.com/v1/embeddings')
    expect(requestModel).toBe('text-embedding-3-small')
    expect(authorization).toBe('Bearer test-openai-key')
    expect(result.vectors[0]).toHaveLength(1536)
  })

  it('uses Azure OpenAI deployment settings and API-key auth', async () => {
    vi.stubEnv('OVERLAY_PROVIDER_EMBEDDINGS', 'azure-openai')
    vi.stubEnv('AZURE_OPENAI_API_KEY', 'test-azure-key')
    vi.stubEnv('AZURE_OPENAI_RESOURCE_NAME', 'overlay-east')
    vi.stubEnv('AZURE_OPENAI_EMBEDDING_DEPLOYMENT', 'embedding-small')
    let requestUrl = ''
    let requestModel = ''
    let apiKey: string | null = null
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      requestUrl = request.url
      requestModel = JSON.parse(await request.clone().text()).model
      apiKey = request.headers.get('api-key')
      return openAIEmbeddingResponse(1536)
    })

    await embedKnowledgeTexts(['text to embed'])

    expect(requestUrl).toMatch(/^https:\/\/overlay-east\.openai\.azure\.com\/openai\/v1\/embeddings/)
    expect(requestModel).toBe('embedding-small')
    expect(apiKey).toBe('test-azure-key')
  })

  it('uses Bedrock region and signs embedding requests with AWS credentials', async () => {
    vi.stubEnv('OVERLAY_PROVIDER_EMBEDDINGS', 'bedrock')
    vi.stubEnv('BEDROCK_REGION', 'us-east-2')
    vi.stubEnv('BEDROCK_EMBEDDING_MODEL_ID', 'amazon.titan-embed-text-v1')
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'test-access-key')
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test-secret-key')
    vi.stubEnv('AWS_BEARER_TOKEN_BEDROCK', '')
    let requestUrl = ''
    let authorization: string | null = null
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      requestUrl = request.url
      authorization = request.headers.get('authorization')
      return Response.json({
        embedding: Array.from({ length: 1536 }, () => 0),
        inputTextTokenCount: 2,
      })
    })

    await embedKnowledgeTexts(['text to embed'])

    expect(requestUrl).toBe('https://bedrock-runtime.us-east-2.amazonaws.com/model/amazon.titan-embed-text-v1/invoke')
    expect(authorization).toMatch(/^AWS4-HMAC-SHA256 /)
  })
})

function openAIEmbeddingResponse(dimensions: number): Response {
  return Response.json({
    data: [{ embedding: Array.from({ length: dimensions }, () => 0), index: 0 }],
    usage: { prompt_tokens: 2 },
  })
}