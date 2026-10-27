import { readFileSync } from 'node:fs'
import { z } from 'zod'

/**
 * Phase 8.2d: extension compatibility gate for the durable runtime.
 *
 * Pi extensions are TypeScript modules against `ExtensionAPI` (tools, commands, shortcuts,
 * providers, session events, message injection). pi-durable's registry is a different surface —
 * tools, prompt sections, task hooks — so not every extension can run there, and pretending
 * otherwise would silently drop behaviour.
 *
 * This module classifies an extension file by the API it uses and names what has no durable
 * equivalent, so the cutover gate can report "these extensions will not work" instead of letting a
 * user flip the runtime and lose them.
 */

/** Pi ExtensionAPI members, ordered from fully mappable to unmappable. */
export const extensionApis = [
  'registerTool',
  'tool_call',
  'context',
  'resources_discover',
  'registerCommand',
  'registerShortcut',
  'registerProvider',
  'sendMessage',
  'appendEntry',
  'setActiveTools',
  'session_events',
] as const

export type ExtensionApi = (typeof extensionApis)[number]

/** How well one detected API maps onto the durable runtime. */
const API_SUPPORT: Record<ExtensionApi, 'supported' | 'partial' | 'unsupported'> = {
  registerTool: 'supported',
  tool_call: 'supported',
  context: 'partial',
  resources_discover: 'partial',
  registerCommand: 'unsupported',
  registerShortcut: 'unsupported',
  registerProvider: 'unsupported',
  sendMessage: 'unsupported',
  appendEntry: 'unsupported',
  setActiveTools: 'unsupported',
  session_events: 'unsupported',
}

export const extensionCompatSchema = z.object({
  path: z.string(),
  /** APIs found in the source. */
  apis: z.array(z.enum(extensionApis)),
  /** Overall verdict for running this extension on the durable runtime. */
  verdict: z.enum(['compatible', 'partial', 'unsupported']),
  /** APIs with no durable equivalent; empty when fully compatible. */
  blocking: z.array(z.enum(extensionApis)),
})

export type ExtensionCompat = z.infer<typeof extensionCompatSchema>

/** Direct `pi.<member>(` usage. */
const MEMBER_PATTERNS: ReadonlyArray<{ api: ExtensionApi; pattern: RegExp }> = [
  { api: 'registerTool', pattern: /\b(?:pi|api|ctx)\s*\.\s*registerTool\s*\(/ },
  { api: 'registerCommand', pattern: /\b(?:pi|api|ctx)\s*\.\s*registerCommand\s*\(/ },
  { api: 'registerShortcut', pattern: /\b(?:pi|api|ctx)\s*\.\s*registerShortcut\s*\(/ },
  { api: 'registerProvider', pattern: /\b(?:pi|api|ctx)\s*\.\s*registerProvider\s*\(/ },
  { api: 'sendMessage', pattern: /\b(?:pi|api|ctx)\s*\.\s*sendMessage\s*\(/ },
  { api: 'appendEntry', pattern: /\b(?:pi|api|ctx)\s*\.\s*appendEntry\s*\(/ },
  { api: 'setActiveTools', pattern: /\b(?:pi|api|ctx)\s*\.\s*setActiveTools\s*\(/ },
]

/** `on("<event>", ...)` usages, mapped onto the categories above. */
const EVENT_SUPPORT: Readonly<Record<string, ExtensionApi>> = {
  tool_call: 'tool_call',
  context: 'context',
  context_with_system: 'context',
  before_provider_request: 'context',
  resources_discover: 'resources_discover',
}

/** Any other `session_*`/`project_trust`/`mcp_servers_change` event has no durable equivalent. */
const SESSION_EVENT =
  /\b(?:pi|api|ctx)\s*\.\s*on\s*\(\s*["'](session_[a-z_]+|project_trust|mcp_servers_change|after_provider_response|provider_stream_event|cache_warming_decision|before_provider_headers)["']/g

const ON_EVENT = /\b(?:pi|api|ctx)\s*\.\s*on\s*\(\s*["']([a-z_]+)["']/g

/** Detect the ExtensionAPI surface an extension source uses. */
export function detectApis(source: string): ExtensionApi[] {
  const found = new Set<ExtensionApi>()
  for (const { api, pattern } of MEMBER_PATTERNS) {
    if (pattern.test(source)) found.add(api)
  }
  for (const match of source.matchAll(ON_EVENT)) {
    const event = match[1]
    const mapped = EVENT_SUPPORT[event]
    if (mapped) found.add(mapped)
  }
  if (SESSION_EVENT.test(source)) found.add('session_events')
  SESSION_EVENT.lastIndex = 0
  return extensionApis.filter((api) => found.has(api))
}

/** Classify one extension file. A read failure is reported, never thrown. */
export function classifyExtension(filePath: string): ExtensionCompat {
  let source: string
  try {
    source = readFileSync(filePath, 'utf-8')
  } catch {
    return { path: filePath, apis: [], verdict: 'unsupported', blocking: [] }
  }
  const apis = detectApis(source)
  const blocking = apis.filter((api) => API_SUPPORT[api] === 'unsupported')
  const partial = apis.filter((api) => API_SUPPORT[api] === 'partial')
  const verdict: ExtensionCompat['verdict'] =
    blocking.length > 0 ? 'unsupported' : partial.length > 0 ? 'partial' : 'compatible'
  return { path: filePath, apis, verdict, blocking }
}
