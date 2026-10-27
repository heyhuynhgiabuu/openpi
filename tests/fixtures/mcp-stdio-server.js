#!/usr/bin/env node
/**
 * Minimal MCP server over stdio for the shipped-path MCP test.
 *
 * Hand-written JSON-RPC 2.0 line framing (one complete JSON message per line on
 * stdout, per the MCP stdio transport): no network, no dependency, no OAuth.
 * It answers `initialize`, ignores `notifications/initialized`, lists exactly one
 * tool (`echo`), and answers `tools/call` for it with a fixed text. Anything else
 * is answered with method-not-found, so a test can tell an unexpected call from a
 * missing one.
 *
 * The fixed text is `<MCP_ECHO_PREFIX><argument text>`, exported for the tests.
 *
 * When `MCP_MARKER_FILE` is set, the server appends a line to that file the moment
 * it starts. A test can then prove a server was never launched (the file stays
 * absent or unchanged), not merely that its tools were unreachable.
 */
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

export const MCP_SERVER_NAME = 'fixture'
export const MCP_TOOL_NAME = 'echo'
/** Tool name as Pi registers it: `mcp__<server>__<tool>` (dist/extensions/mcp/tools.js:46). */
export const MCP_PI_TOOL_NAME = `mcp__${MCP_SERVER_NAME}__${MCP_TOOL_NAME}`
export const MCP_ECHO_PREFIX = 'mcp-echo:'

if (process.env.MCP_MARKER_FILE) {
  fs.appendFileSync(process.env.MCP_MARKER_FILE, `started ${process.pid}\n`)
}

const write = (message) => {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

const reply = (id, result) => write({ jsonrpc: '2.0', id, result })

const error = (id, code, message) => write({ jsonrpc: '2.0', id, error: { code, message } })

function handle(message) {
  const { id, method, params } = message
  // Notifications (no id) never get a response.
  if (method === 'initialize') {
    reply(id, {
      protocolVersion: params?.protocolVersion ?? '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: MCP_SERVER_NAME, version: '1.0.0' },
      instructions: 'Test fixture server with one echo tool.',
    })
    return
  }
  if (method === 'tools/list') {
    reply(id, {
      tools: [
        {
          name: MCP_TOOL_NAME,
          description: 'Echo the given text back with a fixed prefix.',
          inputSchema: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
          },
        },
      ],
    })
    return
  }
  if (method === 'tools/call') {
    const text = String(params?.arguments?.text ?? '')
    reply(id, { content: [{ type: 'text', text: `${MCP_ECHO_PREFIX}${text}` }] })
    return
  }
  if (id === undefined) return
  error(id, -32601, `Method not found: ${String(method)}`)
}

// Constants above are safe to import (tests do); the server loop only starts
// when this file is the entry point, so importing it never installs stdin
// listeners that could `process.exit(0)` a test worker.
const isEntrypoint =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
if (!isEntrypoint) process.exitCode = undefined
else {
  // Split on \n only, the way the MCP stdio transport frames messages.
  let buffer = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    buffer += chunk
    for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
      const line = buffer.slice(0, newline).replace(/\r$/, '')
      buffer = buffer.slice(newline + 1)
      if (!line.trim()) continue
      let message
      try {
        message = JSON.parse(line)
      } catch {
        error(null, -32700, 'Parse error')
        continue
      }
      handle(message)
    }
  })
  // Closing stdin is the shutdown request: exit cleanly so no process outlives the test.
  process.stdin.on('end', () => process.exit(0))
}
