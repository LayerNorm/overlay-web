import {appendFileSync, existsSync} from 'node:fs'
import {join} from 'node:path'
import {createPublicKey, verify} from 'node:crypto'
import {canonicalEnrollmentProof} from '@layernorm/overlay-agent-bridge-protocol'

const directory = process.env.OVERLAY_QA_ENROLL_STATE
if (!directory) throw Error('Missing CLI fixture directory')
let publicKey
globalThis.fetch = async (input, init) => {
  const url = new URL(input.toString()), headers = new Headers(init?.headers)
  if (url.origin !== 'https://pr-247.preview.example.test') throw Error('Unexpected fixture request origin')
  if (headers.get('x-vercel-protection-bypass') !== 'private-hosting-test-secret')
    return Response.json({error: 'Protected deployment'}, {status: 401})
  if (existsSync(join(directory, 'access.json'))) throw Error('Access file was not consumed before networking')
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) throw Error('Hosting credential remained in the provider environment')
  const body = JSON.parse(init.body)
  if (url.pathname.endsWith('/enroll')) {
    publicKey = body.publicKey
    appendFileSync(join(directory, 'requests.jsonl'), JSON.stringify({path: url.pathname, hostingAuthenticated: true, accessFileConsumed: true})+'\n')
    return Response.json({protocolVersion: 1, workspaceId: 'workspace-1', environmentId: 'environment-1',
      verificationPhrase: 'amber-river-sage', proofChallenge: 'proof-challenge-with-enough-entropy-1234', proofChallengeExpiresAt: Date.now()+60000}, {status: 201})
  }
  if (!url.pathname.endsWith('/credentials')) throw Error('Unexpected fixture request path')
  // Verify the actual CLI's device signature using the canonical wire proof.
  if (!verify(null, Buffer.from(canonicalEnrollmentProof('environment-1', body.proofChallenge)), createPublicKey(publicKey), Buffer.from(body.signature, 'base64url')))
    throw Error('Invalid fixture enrollment signature')
  appendFileSync(join(directory, 'requests.jsonl'), JSON.stringify({path: url.pathname, hostingAuthenticated: true, signatureVerified: true, accessFileConsumed: true})+'\n')
  return Response.json({protocolVersion: 1, workspaceId: 'workspace-1', environmentId: 'environment-1', audience: 'overlay-agent-control-plane',
    methods: ['agent:commands:poll'], token: 'short-lived-environment-credential-123456789', expiresAt: Date.now()+60000,
    filesystemGrant: {mode: 'selected_roots', roots: [directory]}}, {status: 201})
}
