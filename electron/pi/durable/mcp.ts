import {
  McpClient,
  StdioTransport,
  toLlmContent,
  type StdioTransportOptions,
} from '@earendil-works/pi-mcp'
import { Type } from '@earendil-works/pi-ai'
import { defineExtension, defineTool } from '@earendil-works/pi-durable'
import type { Extension, ToolRegistration } from '@earendil-works/pi-durable'
import { mcpToolName, type DurableMcpServer } from './mcpConfig'

/**
 * Phase 8.2c: MCP parity for the durable runtime.
 *
 * Each configured server's tools are registered as pi-durable tools with the `mcp__<server>__<tool>`
 * name and `deferred: true`. That mirrors Pi's `deferred` exposure: the tools are not offered up
 * front; `tool_search` finds them and loads them for the next request.
 * Connections are opened lazily on first use and closed with the extension's lifetime.
 */

/** One live server connection plus the tools it advertised. */
interface ServerSession {
  client: McpClient
  toolNames: Map<string, string>
}

/** Open a client for one server and list its tools. */
async function connectServer(
  server: DurableMcpServer,
  cwd: string | undefined
): Promise<ServerSession> {
  const transportOptions: StdioTransportOptions = {
    command: server.command,
    args: server.args,
    env: server.env,
    inheritEnv: true,
    stderr: 'pipe',
  }
  const resolvedCwd = server.cwd ?? cwd
  if (resolvedCwd !== undefined) transportOptions.cwd = resolvedCwd
  const transport = new StdioTransport(transportOptions)
  const client = new McpClient({ name: 'openpi', version: '1.0.0' })
  await client.connect(transport)
  const tools = await client.listTools()
  const toolNames = new Map<string, string>()
  for (const tool of tools) toolNames.set(mcpToolName(server.name, tool.name), tool.name)
  return { client, toolNames }
}

/**
 * Build the MCP extension for the given servers, or `undefined` when none are enabled.
 * `close()` must be called when the runtime shuts down.
 */
export async function loadMcpExtension(
  servers: readonly DurableMcpServer[],
  cwd: string | undefined
): Promise<{
  extension?: Extension<ToolRegistration>
  close: () => Promise<void>
  errors: string[]
}> {
  const enabled = servers.filter((server) => server.enabled)
  if (enabled.length === 0) return { close: async () => {}, errors: [] }

  const sessions: ServerSession[] = []
  const errors: string[] = []
  const tools: ToolRegistration[] = []

  for (const server of enabled) {
    let session: ServerSession
    try {
      session = await connectServer(server, cwd)
    } catch (error) {
      errors.push(`${server.name}: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    sessions.push(session)
    for (const [exposedName, serverToolName] of session.toolNames) {
      tools.push(
        defineTool({
          name: exposedName,
          description: `${server.name} MCP tool: ${serverToolName}`,
          parameters: Type.Object({}, { additionalProperties: true }),
          // `deferred` + model-callable: `tool_search` only ranks tools that land in `agent.deferred`,
          // which requires the model to be a caller. `callers: ['tools']` would hide it from the search
          // and make the model unable to call it even after loading.
          deferred: true,
          execute: async (args: Record<string, unknown>, api) => {
            const result = await session.client.callTool(serverToolName, args)
            // `toLlmContent` is pi-mcp's own mapping: text and images survive, everything else is dropped.
            const output = toLlmContent(result)
            if (result.isError) {
              api.diagnostic({
                severity: 'error',
                message: `MCP error from ${server.name}/${serverToolName}`,
              })
              return { output, isError: true }
            }
            return { output }
          },
        })
      )
    }
  }

  if (tools.length === 0) {
    return {
      close: async () => {
        await Promise.all(sessions.map((session) => session.client.close()))
      },
      errors,
    }
  }

  return {
    extension: defineExtension({ name: 'openpi.mcp', tools }),
    close: async () => {
      await Promise.all(sessions.map((session) => session.client.close()))
    },
    errors,
  }
}
