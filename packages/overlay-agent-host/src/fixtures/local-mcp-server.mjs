#!/usr/bin/env node
// A minimal stdio MCP server for the Agent Host tests: newline-delimited JSON-RPC, no dependencies.
// `greet` answers with FIXTURE_GREETING (from the server's environment) and a name; `pid` returns this process id.
import { createInterface } from 'node:readline'

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)
process.stderr.write('fixture server ready\n')
if (process.env.FIXTURE_FAIL_START) {
  process.stderr.write('fixture refused to start\n')
  process.exit(3)
}

createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  if (message.id === undefined) return
  if (message.method === 'initialize') {
    send({ jsonrpc: '2.0', id: message.id, result: {
      protocolVersion: message.params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: 'fixture', version: '1.0.0' },
    } })
  } else if (message.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: message.id, result: { tools: [
      { name: 'greet', description: 'Greets someone', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
      { name: 'pid', description: 'This server\'s process id', inputSchema: { type: 'object', properties: {} } },
    ] } })
  } else if (message.method === 'tools/call') {
    const text = message.params.name === 'pid'
      ? String(process.pid)
      : `${process.env.FIXTURE_GREETING ?? 'Hello'}, ${message.params.arguments?.name}`
    send({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text }] } })
  } else {
    send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } })
  }
})
