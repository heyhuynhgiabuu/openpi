import type { Context } from '@earendil-works/chord'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels, type Message, type MutableModels } from '@earendil-works/pi-ai'
import {
  AssistantEntry,
  Harness,
  ToolTask,
  UserEntry,
  createRegistry,
  defineExtension,
  hook,
} from '@earendil-works/pi-durable'
import type { EntryRecord } from '@earendil-works/pi-durable'
import { expandInput, loadCustomizationsExtension } from './sections'
import { policyToolHooks } from './policy'
import type { CustomizationDiagnostic } from '../../../src/lib/ipc'
import type { DurableCustomizations } from './customizations'
import { CodingTools } from '@earendil-works/pi-durable/tools'
import { createToolSearchExtension } from '@earendil-works/pi-durable/tool-search'
import { loadDurableMcpConfig } from './mcpConfig'
import { loadMcpExtension } from './mcp'
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node'
import { openDurableStorage } from './storage'
import type {
  DurableEntrySnapshot,
  DurableHarness,
  DurableHarnessOptions,
  DurableSubmitResult,
  DurableView,
} from './types'

/**
 * The ONLY module allowed to drive @earendil-works/pi-durable (Phase 8 confinement rule, AGENTS.md).
 * Phase 8.1: opens a Harness, runs the root conversation end-to-end, exposes structural views.
 * No IPC and no renderer wiring yet — the pi-coding-agent SDK path stays the shipped runtime.
 */

const ctx: Context = BACKGROUND_CONTEXT

/** Content parts carry a `type`; only `text` parts contribute to the adapter's text snapshot. */
function isTextPart(part: unknown): part is { type: 'text'; text: string } {
  if (typeof part !== 'object' || part === null) return false
  const candidate = part as { type?: unknown; text?: unknown }
  return candidate.type === 'text' && typeof candidate.text === 'string'
}

/** Message content is either a plain string or an array of parts; anything else contributes no text. */
function messageText(message: Message | undefined): string | undefined {
  if (message === undefined) return undefined
  const content: unknown = message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined
  return content
    .filter(isTextPart)
    .map((part) => part.text)
    .join('')
}

function entrySnapshot(record: EntryRecord): DurableEntrySnapshot {
  const snapshot: DurableEntrySnapshot = { id: record.id, kind: record.kind }
  const text = messageText(record.model?.[0])
  if (text !== undefined && text !== '') snapshot.text = text
  return snapshot
}

function toView(conversationId: number, records: readonly EntryRecord[]): DurableView {
  return { conversationId, entries: records.map(entrySnapshot) }
}

/** Text of the final assistant answer, resolved from the settled submission's answer entry ID. */
function answerText(
  records: readonly EntryRecord[],
  answerId: number | undefined
): string | undefined {
  if (answerId === undefined) return undefined
  const record = records.find((candidate) => candidate.id === answerId)
  if (!record || !AssistantEntry.is(record)) return undefined
  return messageText(record.model?.[0])
}

export async function openDurableHarness(options: DurableHarnessOptions): Promise<DurableHarness> {
  const backend = options.backend ?? 'jsonl'
  const storage = await openDurableStorage({ backend, directory: options.directory }, ctx)
  const models: MutableModels = createModels()
  options.registerProviders?.(models)
  const registry = createRegistry()
  // Parity extensions: customizations render as prompt sections; the policy gate mirrors the
  // desktop protected-path and high-risk gates the SDK path applies in Electron main.
  const diagnostics: CustomizationDiagnostic[] = []
  let customizations: DurableCustomizations | undefined
  if (options.userAgentDir) {
    const loaded = await loadCustomizationsExtension({
      userAgentDir: options.userAgentDir,
      workspacePath: options.workspacePath,
    })
    registry.install(loaded.extension)
    customizations = loaded.found
    diagnostics.push(...loaded.found.diagnostics)
  }
  if (options.policy !== false) {
    registry.install(
      defineExtension({
        name: 'openpi.policy',
        hooks: [hook(ToolTask, policyToolHooks({ workspacePath: options.workspacePath }))],
      })
    )
  }
  // The built-in coding tools need an execution environment; without it every tool call would fail.
  const harness = await Harness.open(
    storage,
    {
      models,
      registry,
      env: ({ cwd }) =>
        new NodeExecutionEnv({ cwd: cwd ?? options.workspacePath ?? process.cwd() }),
    },
    ctx
  )
  if (options.tools !== false) registry.install(CodingTools)

  // MCP tools are registered deferred and tool-only, so `tool_search` is what lets the model reach
  // them — install it alongside rather than leaving the tools unreachable.
  let closeMcp: (() => Promise<void>) | undefined
  if (options.mcp && options.workspacePath) {
    const config = loadDurableMcpConfig({
      agentDir: options.userAgentDir ?? '',
      workspacePath: options.workspacePath,
      projectTrusted: options.projectTrusted === true,
    })
    diagnostics.push(...config.errors.map((message) => ({ type: 'warning' as const, message })))
    const bridge = await loadMcpExtension(config.servers, options.workspacePath)
    diagnostics.push(...bridge.errors.map((message) => ({ type: 'warning' as const, message })))
    if (bridge.extension) {
      registry.install(bridge.extension)
      registry.install(createToolSearchExtension())
    }
    closeMcp = bridge.close
  }
  const agent: { model: typeof options.model; cwd?: string } = { model: options.model }
  if (options.workspacePath) agent.cwd = options.workspacePath
  const root = await harness.root(ctx, { agent })

  return {
    async prompt(text: string): Promise<DurableSubmitResult> {
      // `/template args` expands here, at invocation time, not in the prompt section.
      const input = customizations ? expandInput(text, customizations) : text
      const submission = await root.submit({ type: 'input', content: input }, ctx)
      const settled = await submission.wait(ctx)
      if (settled.status !== 'done' || settled.type !== 'input') {
        const unresolved: DurableSubmitResult = { status: settled.status }
        if ('reason' in settled && settled.reason !== undefined)
          unresolved.reason = String(settled.reason)
        return unresolved
      }
      const view = await root.context(ctx)
      const answer = answerText(view.entries, settled.answer)
      return answer === undefined ? { status: 'done' } : { status: 'done', answerText: answer }
    },

    watch(onView: (view: DurableView) => void): () => void {
      let stopped = false
      let stopHandle: (() => void) | undefined
      void root.watch(ctx).then((handle) => {
        stopHandle = () => void handle.stop()
        if (stopped) {
          stopHandle()
          return
        }
        onView(toView(handle.value.conversation.id, handle.value.entries))
        if (stopped) return
        handle.start(async (value) => {
          onView(toView(value.conversation.id, value.entries))
        })
      })
      return () => {
        stopped = true
        stopHandle?.()
      }
    },

    async snapshot(): Promise<DurableView> {
      const view = await root.context(ctx)
      return toView(root.id, view.entries)
    },

    diagnostics(): readonly CustomizationDiagnostic[] {
      return diagnostics
    },

    async close(): Promise<void> {
      await closeMcp?.()
      return harness.close(ctx)
    },
  }
}

/** Entry kinds the adapter surface cares about (pi.* kinds are pi-durable's own). */
export const DURABLE_ENTRY_KINDS = { user: UserEntry.kind, assistant: AssistantEntry.kind } as const
