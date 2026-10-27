import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

/**
 * Phase 8.2c: `.mcp.json` configuration for the durable runtime.
 *
 * Pi reads the same two files (`<agentDir>/mcp.json`, `<cwd>/.pi/mcp.json` when the project is
 * trusted) through `loadMcpConfig`, which is not publicly exported. This module re-implements only
 * the on-disk schema and the trust gate, with Zod validation, and nothing else.
 */

const exposureSchema = z.enum(['codemode', 'deferred', 'direct', 'hidden'])

const stdioServerSchema = z.object({
  type: z.literal('stdio').optional(),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
  exposure: exposureSchema.optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  timeout: z.number().positive().optional(),
})

/** Parsed view of one stdio MCP server (HTTP servers are out of scope for this slice). */
export interface DurableMcpServer {
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  cwd?: string
  enabled: boolean
}

export interface DurableMcpConfig {
  servers: DurableMcpServer[]
  errors: string[]
}

const fileSchema = z.object({
  mcpServers: z.record(z.string(), z.unknown()).optional(),
})

function readFile(filePath: string, errors: string[]): z.infer<typeof fileSchema> | undefined {
  if (!existsSync(filePath)) return undefined
  try {
    const parsed = fileSchema.safeParse(JSON.parse(readFileSync(filePath, 'utf-8')))
    if (!parsed.success) {
      errors.push(`${filePath}: expected an object with an "mcpServers" object`)
      return undefined
    }
    return parsed.data
  } catch (error) {
    errors.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

/**
 * Load global and (only when the project is trusted) project MCP configuration. A project entry
 * replaces the global server of the same name, matching `loadMcpConfig`.
 */
export function loadDurableMcpConfig(options: {
  agentDir: string
  workspacePath: string
  projectTrusted: boolean
}): DurableMcpConfig {
  const errors: string[] = []
  const files = [path.join(options.agentDir, 'mcp.json')]
  if (options.projectTrusted) files.push(path.join(options.workspacePath, '.pi', 'mcp.json'))

  const servers = new Map<string, DurableMcpServer>()
  for (const file of files) {
    const parsed = readFile(file, errors)
    if (!parsed?.mcpServers) continue
    for (const [name, raw] of Object.entries(parsed.mcpServers)) {
      const server = stdioServerSchema.safeParse(raw)
      if (!server.success) {
        // HTTP servers and overrides are reported, never silently dropped.
        errors.push(`${file}: server "${name}" is not a supported stdio configuration`)
        continue
      }
      const value = server.data
      const entry: DurableMcpServer = {
        name,
        command: value.command,
        args: value.args ?? [],
        env: value.env ?? {},
        enabled: value.enabled !== false,
      }
      if (value.cwd !== undefined) entry.cwd = value.cwd
      servers.set(name, entry)
    }
  }
  return { servers: [...servers.values()], errors }
}

/** Tool name as the model and code-mode scripts see it: `mcp__<server>__<tool>`, sanitized. */
export function mcpToolName(server: string, tool: string): string {
  const clean = (value: string) => value.replace(/[^A-Za-z0-9_]/g, '_')
  return `mcp__${clean(server)}__${clean(tool)}`
}
