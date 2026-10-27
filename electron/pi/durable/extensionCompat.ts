import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { z } from 'zod'

/**
 * Phase 8.2d: extension compatibility gate for the durable runtime.
 *
 * Pi extensions are TS modules against `ExtensionAPI` (tools, commands, shortcuts, providers,
 * session events, message injection). pi-durable's registry is a different surface — tools, prompt
 * sections, task hooks — so not every extension can run there, and pretending otherwise would
 * silently drop behaviour.
 *
 * The analysis parses the file with the TypeScript compiler instead of matching text, so comments
 * and string literals never count as calls, and the API object is tracked by the factory parameter
 * name rather than requiring it to be called `pi`.
 */

/** Every `ExtensionAPI` member this gate understands. */
export const extensionApis = [
  'registerTool',
  'registerCommand',
  'registerShortcut',
  'registerProvider',
  'sendMessage',
  'appendEntry',
  'setActiveTools',
  'tool_call',
  'context',
  'resources_discover',
  'session_events',
  'unknown_events',
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
  // An event this gate does not classify could do anything: never call it compatible.
  unknown_events: 'unsupported',
}

/** Method calls that map onto a durable concept. */
const METHOD_API: Readonly<Record<string, ExtensionApi>> = {
  registerTool: 'registerTool',
  registerCommand: 'registerCommand',
  registerShortcut: 'registerShortcut',
  registerProvider: 'registerProvider',
  sendMessage: 'sendMessage',
  appendEntry: 'appendEntry',
  setActiveTools: 'setActiveTools',
}

/** `on('<event>')` names mapped onto a category; anything else is `unknown_events`. */
const EVENT_API: Readonly<Record<string, ExtensionApi>> = {
  tool_call: 'tool_call',
  context: 'context',
  context_with_system: 'context',
  before_provider_request: 'context',
  resources_discover: 'resources_discover',
}

export const extensionCompatSchema = z.object({
  path: z.string(),
  /** APIs found in the source. */
  apis: z.array(z.enum(extensionApis)),
  /** Overall verdict for running this extension on the durable runtime. */
  verdict: z.enum(['compatible', 'partial', 'unsupported']),
  /** APIs with no durable equivalent; empty when fully compatible. */
  blocking: z.array(z.enum(extensionApis)),
  /** Hook names the gate could not classify, for reporting rather than guessing. */
  unknownEvents: z.array(z.string()),
})

export type ExtensionCompat = z.infer<typeof extensionCompatSchema>

/** Collect the parameter names bound to the exported extension factory. */
function factoryParameters(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>()
  const isFactory = (node: ts.Node): node is ts.FunctionLikeDeclaration =>
    ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)

  const visit = (node: ts.Node): void => {
    if (isFactory(node) && node.parameters.length > 0) {
      const parent = node.parent
      // `export default function (pi) {}` (modifiers on the function itself),
      // `export default (pi) => {}` (an ExportAssignment wrapping the arrow), or `export function`.
      const ownModifiers = ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : []
      const exported =
        ts.isExportAssignment(parent) ||
        ownModifiers.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword)
      if (exported) {
        const first = node.parameters[0]
        if (ts.isIdentifier(first.name)) names.add(first.name.text)
      }
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(sourceFile, visit)
  return names
}

/** Analyse a source string, returning the detected APIs and unknown hook names. */
export function analyseSource(source: string): { apis: ExtensionApi[]; unknownEvents: string[] } {
  const sourceFile = ts.createSourceFile(
    'extension.ts',
    source,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS
  )
  const receivers = factoryParameters(sourceFile)

  const found = new Set<ExtensionApi>()
  const unknownEvents = new Set<string>()

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text
      const receiver = ts.isIdentifier(node.expression.expression)
        ? node.expression.expression.text
        : undefined
      // Only calls on the factory's own API object count; a local helper named the same does not.
      if (receiver !== undefined && receivers.has(receiver)) {
        const mapped = METHOD_API[method]
        if (mapped) found.add(mapped)
        if (method === 'on') {
          const event = node.arguments[0]
          if (event && ts.isStringLiteralLike(event)) {
            const category = EVENT_API[event.text]
            if (category) found.add(category)
            else {
              found.add('unknown_events')
              unknownEvents.add(event.text)
            }
          } else {
            // A computed event name cannot be classified.
            found.add('unknown_events')
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  return { apis: extensionApis.filter((api) => found.has(api)), unknownEvents: [...unknownEvents] }
}

/** Classify one extension file. A read or parse failure is reported, never thrown. */
export function classifyExtension(filePath: string): ExtensionCompat {
  let source: string
  try {
    source = readFileSync(filePath, 'utf-8')
  } catch {
    return { path: filePath, apis: [], verdict: 'unsupported', blocking: [], unknownEvents: [] }
  }
  const { apis, unknownEvents } = analyseSource(source)
  const blocking = apis.filter((api) => API_SUPPORT[api] === 'unsupported')
  const partial = apis.filter((api) => API_SUPPORT[api] === 'partial')
  const verdict: ExtensionCompat['verdict'] =
    blocking.length > 0 ? 'unsupported' : partial.length > 0 ? 'partial' : 'compatible'
  return { path: filePath, apis, verdict, blocking, unknownEvents }
}
