import type { Context } from '@earendil-works/chord'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  createModels,
  type ModelThinkingLevel,
  type Models,
  type MutableModels,
} from '@earendil-works/pi-ai'
import { AssistantEntry, Harness, UserEntry, createRegistry } from '@earendil-works/pi-durable'
import type { SettledSubmissionRecord } from '@earendil-works/pi-durable'
import { expandInput } from './sections'
import { slashCommandsOf } from './commands'
import { computeStats, SESSION_NAME_KIND, type DurableStats } from './stats'
import { createBashRunner, runAndRecord, type BashResult } from './bash'
import { createQueuedTexts } from './queued'
import { answerText, toView } from './view'
import type { CustomizationDiagnostic } from '../../../src/lib/ipc'
import { CodingTools } from '@earendil-works/pi-durable/tools'
import { createToolSearchExtension } from '@earendil-works/pi-durable/tool-search'
import { loadDurableMcpConfig } from './mcpConfig'
import { loadMcpExtension } from './mcp'
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node'
import { attachDurableEvents } from './events'
import { busyWith } from './activity'
import { runCompaction } from './compaction'
import { activeBranch, forkAtLine, navigate, openBranches, readAll } from './branches'
import { writeSessionTree, type SessionFileHeader, type SessionFileResult } from './sessionFile'
import { openDurableStorage } from './storage'
import { releaseOnFailure } from './release'
import { prepareRegistry } from './registry'
import type {
  DurableHarness,
  DurableCompaction,
  DurableHarnessOptions,
  DurableNavigation,
  DurableModelRef,
  DurableSubmitResult,
  DurableView,
  DurableQueued,
} from './types'

/**
 * The ONLY module allowed to drive @earendil-works/pi-durable (Phase 8 confinement rule, AGENTS.md).
 * Phase 8.1: opens a Harness, runs the root conversation end-to-end, exposes structural views.
 * No IPC and no renderer wiring yet — the pi-coding-agent SDK path stays the shipped runtime.
 */

const ctx: Context = BACKGROUND_CONTEXT

export async function openDurableHarness(options: DurableHarnessOptions): Promise<DurableHarness> {
  const backend = options.backend ?? 'jsonl'
  const storage = await openDurableStorage(
    { backend, directory: options.directory, requireStore: options.requireStore },
    ctx
  )
  const registryModels: MutableModels = createModels()
  options.registerProviders?.(registryModels)
  const models: Models = options.models ?? registryModels
  const registry = createRegistry()
  const prepared = await prepareRegistry(registry, {
    userAgentDir: options.userAgentDir,
    workspacePath: options.workspacePath,
    policy: options.policy,
  })
  const { customizations, diagnostics } = prepared
  // The built-in coding tools need an execution environment; without it every tool call would fail.
  const harness = await Harness.open(
    storage,
    {
      models,
      registry,
      // An empty policy means pi-durable's defaults; a test overrides `keepRecentTokens` only.
      settings: { compaction: options.compaction ?? {} },
      env: ({ cwd }) =>
        new NodeExecutionEnv({ cwd: cwd ?? options.workspacePath ?? process.cwd() }),
      // Without this, a task pi-durable parks (restart limit reached) or faults is dropped in
      // silence: the user sees a prompt that never answers and no reason for it.
      onReport: (error, info) => options.onReport?.(error, info),
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
    closeMcp = bridge.close
    if (bridge.extension) {
      try {
        registry.install(bridge.extension)
        registry.install(createToolSearchExtension())
      } catch (error) {
        // The install validates the extension and can throw (two servers can sanitize to the same
        // tool name), and the bridge's servers are already spawned by now.
        await releaseOnFailure({ closeMcp: bridge.close, harness, storage }, ctx, error)
      }
    }
  }
  const agent: { model: typeof options.model; cwd?: string } = { model: options.model }
  if (options.workspacePath) agent.cwd = options.workspacePath
  // A forked or navigated session lives in its own conversations of the store; any other uses the
  // root. Ids come from a session file now, so a wrong one closes what this open created.
  const branches = await openBranches(harness, options.conversationIds, closeMcp, ctx)
  if (branches.length === 0) {
    try {
      branches.push(await harness.root(ctx, { agent }))
    } catch (error) {
      // Nothing holds a handle to what this open started, so release it on the way out.
      await releaseOnFailure({ closeMcp, harness, storage }, ctx, error)
    }
  }
  // The active branch: the last. `navigate` moves it to a fork.
  let root = activeBranch(branches)

  // `/template args` expands at invocation time, not in the prompt section.
  const expand = (text: string): string =>
    customizations ? expandInput(text, customizations) : text
  const workspace = options.workspacePath ?? process.cwd()
  const bashRunner = createBashRunner(new NodeExecutionEnv({ cwd: workspace }), ctx)
  const queued = createQueuedTexts()
  // Read once at the end of a run, so `agent_settled` can say whether the user stopped it.
  let abortRequested = false

  /** The outcome of a settled input submission, with the answer text when the run answered. */
  const resultOf = async (settled: SettledSubmissionRecord): Promise<DurableSubmitResult> => {
    if (settled.status !== 'done' || settled.type !== 'input') {
      const unresolved: DurableSubmitResult = { status: settled.status }
      if ('reason' in settled && settled.reason !== undefined)
        unresolved.reason = String(settled.reason)
      return unresolved
    }
    const view = await root.context(ctx)
    const answer = answerText(view.entries, settled.answer)
    return answer === undefined ? { status: 'done' } : { status: 'done', answerText: answer }
  }

  return {
    async prompt(text: string): Promise<DurableSubmitResult> {
      const submission = await root.submit({ type: 'input', content: text }, ctx)
      return resultOf(await submission.wait(ctx))
    },

    async queue(text: string, mode: 'steer' | 'followUp'): Promise<DurableQueued> {
      queued.expect(text)
      let submission: Awaited<ReturnType<typeof root.submit>>
      try {
        submission = await root.submit({ type: 'input', content: text, whenBusy: mode }, ctx)
      } catch (error) {
        queued.cancel(text)
        throw error
      }
      const id = Number(submission.id)
      queued.bind(id, text)
      const forget = (): void => queued.forget(id)
      const settled = submission.wait(ctx).then(resultOf)
      settled.then(forget, forget)
      return { settled }
    },

    async agentState(): Promise<{ model?: DurableModelRef; thinkingLevel: ModelThinkingLevel }> {
      const agent = await root.agent(ctx)
      return agent.model
        ? { model: agent.model, thinkingLevel: agent.thinkingLevel }
        : { thinkingLevel: agent.thinkingLevel }
    },

    async configure(change: {
      model?: DurableModelRef
      thinkingLevel?: ModelThinkingLevel
    }): Promise<void> {
      await root.configure(change, ctx)
    },

    async setSessionName(name: string): Promise<void> {
      const submission = await root.submit(
        { type: 'write', entry: { kind: SESSION_NAME_KIND, data: { name } } },
        ctx
      )
      await submission.wait(ctx)
    },

    async stats(): Promise<DurableStats> {
      const [ledger, view] = await Promise.all([harness.usage(ctx), root.context(ctx)])
      return computeStats(ledger, view.entries, view.messages.length)
    },

    async abort(): Promise<void> {
      abortRequested = true
      await root.abort(ctx)
    },

    renderInput(text: string) {
      return expand(text)
    },

    promptCommands: () => slashCommandsOf(customizations),

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

    diagnostics: (): readonly CustomizationDiagnostic[] => diagnostics,

    async watchEvents(
      onEvent: (event: Record<string, unknown>) => void
    ): Promise<() => Promise<void>> {
      const handle = await attachDurableEvents(harness, root.id, ctx, onEvent, {
        queuedText: queued.textFor,
        consumeAborted: () => {
          const aborted = abortRequested
          abortRequested = false
          return aborted
        },
      })
      return handle.stop
    },

    async exportSession(path: string, header: SessionFileHeader): Promise<SessionFileResult> {
      // The file is the archive of the session: every branch's whole history, not the active context.
      return writeSessionTree(path, header, await readAll(branches, ctx))
    },

    async fork(lineId: string, header: SessionFileHeader): Promise<number> {
      return Number((await forkAtLine(branches, header, lineId, ctx)).id)
    },

    async navigate(lineId: string, header: SessionFileHeader): Promise<DurableNavigation> {
      const outcome = await navigate(harness, branches, header, lineId, ctx)
      root = activeBranch(branches)
      return outcome
    },

    busy() {
      return busyWith(harness, ctx)
    },

    conversationIds(): number[] {
      return branches.map((branch) => Number(branch.id))
    },

    compact(instructions?: string): Promise<DurableCompaction> {
      return runCompaction(harness, root, instructions, ctx)
    },

    executeBash(command: string, bash?: { excludeFromContext?: boolean }): Promise<BashResult> {
      return runAndRecord(bashRunner, root, ctx, command, workspace, bash?.excludeFromContext)
    },

    async resumeInterrupted(): Promise<void> {
      // `Harness.resume()` is synchronous: it enables scheduling, so the pending work runs on its own.
      harness.resume()
    },

    async waitIdle(): Promise<void> {
      await harness.waitForIdle(ctx)
    },

    async close(): Promise<void> {
      bashRunner.cancelAll()
      await closeMcp?.()
      return harness.close(ctx)
    },
  }
}

/** Entry kinds the adapter surface cares about (pi.* kinds are pi-durable's own). */
export const DURABLE_ENTRY_KINDS = { user: UserEntry.kind, assistant: AssistantEntry.kind } as const
