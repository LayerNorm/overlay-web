import { z } from 'zod/v3'

const bridgeSchema = z.object({ callId: z.string().uuid(), requestKey: z.string().regex(/^mcp_call:[a-f0-9-]{36}$/) }).strict()
const formSchema = z.object({ properties: z.object({ overlay_request: z.object({ enum: z.tuple([z.string().max(1024)]) }) }) })
export type McpApprovalBridge = z.infer<typeof bridgeSchema>
const encoder = new TextEncoder()
const base64url = (data: Uint8Array) => btoa(String.fromCharCode(...data)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
function bytes(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0))
}
async function key(token: string) {
  return crypto.subtle.importKey('raw', encoder.encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

/** The bearer stays in the host's private MCP configuration, never in the form. */
export async function createMcpApprovalBridge(token: string, input: McpApprovalBridge): Promise<string> {
  const value = bridgeSchema.parse(input)
  if (value.requestKey !== `mcp_call:${value.callId}`) throw Error('Invalid approval correlation')
  const payload = base64url(encoder.encode(JSON.stringify(value)))
  const signature = await crypto.subtle.sign('HMAC', await key(token), encoder.encode(`overlay-mcp-approval:v1:${payload}`))
  return `${payload}.${base64url(new Uint8Array(signature))}`
}

/** Third-party elicitation cannot suppress a card or reuse an unrelated pending request. */
export async function verifyMcpApprovalBridge(token: string, requestedSchema: unknown): Promise<McpApprovalBridge | null> {
  const parsed = formSchema.safeParse(requestedSchema)
  if (!parsed.success) return null
  const pieces = parsed.data.properties.overlay_request.enum[0].split('.')
  if (pieces.length !== 2 || !pieces.every(piece => /^[A-Za-z0-9_-]+$/.test(piece))) return null
  const [payload, signature] = pieces
  if (!payload || !signature) return null
  try {
    if (base64url(bytes(payload)) !== payload || base64url(bytes(signature)) !== signature
      || !(await crypto.subtle.verify('HMAC', await key(token), bytes(signature), encoder.encode(`overlay-mcp-approval:v1:${payload}`)))) return null
    const value = bridgeSchema.safeParse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes(payload))))
    return value.success && value.data.requestKey === `mcp_call:${value.data.callId}` ? value.data : null
  } catch { return null }
}
