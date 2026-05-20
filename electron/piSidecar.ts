/**
 * piSidecar.ts — Pi SDK agent runtime running in a sidecar child process.
 *
 * Isolates all Pi SDK memory from the main process. Main stays ≤100 MB;
 * Pi SDK (sessions, models, resource loading) lives here and can grow freely.
 *
 * Communication: typed JSON messages over process.parentPort.
 * All heavy imports (Pi SDK, resource loader) happen inside this file only.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { expandPromptTemplateText } from '../src/lib/sessionPrompt'
import { createOpenPiSubagentTools } from './openPiSubagents'

// ─── Types ─────────────────────────────────────────────────────────────────────

export type SidecarCommand =
  | {
      type: 'start_session'
      cwd: string
      sessionFile?: string
      forkEntryId?: string
      requestId?: string
      workspaceTrusted?: boolean
    }
  | { type: 'prompt'; text: string; contextPrefix?: string }
  | { type: 'steer'; text: string; contextPrefix?: string }
  | { type: 'follow_up'; text: string; contextPrefix?: string }
  | { type: 'list_prompt_templates'; requestId: string; cwd?: string; workspaceTrusted?: boolean }
  | { type: 'list_skills'; requestId: string; cwd?: string; workspaceTrusted?: boolean }
  | {
      type: 'read_skill_file'
      requestId: string
      path: string
      cwd?: string
      workspaceTrusted?: boolean
    }
  | { type: 'abort' }
  | { type: 'set_model'; provider: string; modelId: string }
  | { type: 'set_thinking'; level: string }
  | { type: 'get_stats'; requestId: string }
  | { type: 'get_models'; requestId: string }
  | { type: 'execute_bash'; requestId: string; command: string; excludeFromContext?: boolean }
  | { type: 'set_session_name'; name: string }
  | { type: 'fork_session'; entryId: string; requestId?: string }
  | { type: 'get_settings'; requestId: string }
  | { type: 'save_settings'; scope: 'global' | 'project'; settings: Record<string, unknown> }
  | { type: 'get_providers'; requestId: string }
  | { type: 'set_provider_key'; provider: string; apiKey: string }
  | { type: 'remove_provider_key'; provider: string }
  | { type: 'invalidate_models' }
  | { type: 'login_provider'; requestId: string; providerId: string }
  | { type: 'logout_provider'; providerId: string }
  | { type: 'resolve_provider_prompt'; providerId: string; value: string }
  | { type: 'stop' }

export type SidecarMessage =
  | { type: 'ready' }
  | { type: 'session_ready'; requestId?: string; payload: SessionReadyPayload }
  | { type: 'session_event'; event: Record<string, unknown> }
  | { type: 'session_error'; requestId?: string; message: string; code?: string }
  | { type: 'session_index_updated' }
  | { type: 'stats_result'; requestId: string; stats: Record<string, unknown> }
  | { type: 'models_result'; requestId: string; models: unknown[] }
  | { type: 'bash_result'; requestId: string; result: unknown }
  | { type: 'settings_result'; requestId: string; result: unknown }
  | { type: 'providers_result'; requestId: string; providers: unknown[] }
  | { type: 'prompt_templates_result'; requestId: string; prompts: unknown[] }
  | { type: 'skills_result'; requestId: string; skills: unknown[] }
  | { type: 'skill_file_result'; requestId: string; content: string | null }
  | { type: 'provider_login_event'; requestId: string; event: unknown }
  | { type: 'output_append'; line: { level: string; text: string; ts: number } }
  | { type: 'error'; requestId?: string; message: string }
  | { type: 'stopped' }

type SessionReadyPayload = {
  cwd: string
  sessionFile: string | null
  sessionId: string | null
  sessionName: string | null
  model: {
    id: string
    name: string
    provider: string
    reasoning: boolean
    contextWindow: number
  } | null
  thinkingLevel: string | null
}

// ─── State ─────────────────────────────────────────────────────────────────────

type SessionState = {
  session: Awaited<ReturnType<typeof createAgentSession>>['session']
  cwd: string
  workspaceTrusted: boolean
  unsubscribe: () => void
}

let state: SessionState | null = null
let _authStorage: ReturnType<typeof AuthStorage.create> | null = null
let _modelRegistry: ReturnType<typeof ModelRegistry.create> | null = null
let _cachedResourceLoader: {
  cwd: string
  workspaceTrusted: boolean
  loader: InstanceType<typeof DefaultResourceLoader>
} | null = null
const _pendingOAuthPrompts = new Map<string, (v: string) => void>()

// ─── Port ─────────────────────────────────────────────────────────────────────

type ParentPort = {
  postMessage(msg: unknown): void
  on(event: 'message', listener: (message: unknown) => void): void
}

function createParentPort(): ParentPort | null {
  const electronParentPort = (process as unknown as { parentPort?: ParentPort }).parentPort
  if (electronParentPort) return electronParentPort

  if (typeof process.send !== 'function') return null
  return {
    postMessage(msg: unknown): void {
      process.send?.(msg)
    },
    on(_event: 'message', listener: (message: unknown) => void): void {
      process.on('message', listener)
    },
  }
}

const maybeParentPort = createParentPort()
if (!maybeParentPort) {
  process.stderr.write('[piSidecar] No parent port — must run as utilityProcess or Node fork\n')
  process.exit(1)
}
const parentPort: ParentPort = maybeParentPort

// ─── Helpers ──────────────────────────────────────────────────────────────────

function send(msg: SidecarMessage): void {
  parentPort.postMessage(msg)
}

function getAgentDir(): string {
  return path.join(os.homedir(), '.pi', 'agent')
}

function getAuthStorage() {
  const agentDir = getAgentDir()
  _authStorage ??= AuthStorage.create(path.join(agentDir, 'auth.json'))
  return _authStorage
}

function getModelRegistry() {
  _modelRegistry ??= ModelRegistry.create(getAuthStorage(), path.join(getAgentDir(), 'models.json'))
  return _modelRegistry
}

function invalidateModelRegistry(): void {
  _modelRegistry = null
}

function outputLine(level: 'info' | 'warn' | 'error', text: string): void {
  send({ type: 'output_append', line: { level, text, ts: Date.now() } })
}

function stripFrontmatter(content: string): string {
  const trimmed = content.trimStart()
  if (!trimmed.startsWith('---')) return trimmed
  const afterOpen = trimmed.slice(3)
  const closeIdx = afterOpen.indexOf('\n---')
  if (closeIdx === -1) return trimmed
  return afterOpen.slice(closeIdx + 4).trimStart()
}

function buildGoalHarnessPrompt(intent: string): string {
  const normalizedIntent =
    intent.trim() || 'Inspect the active goal/harness state and recommend the next safe action.'
  return `Run the Pi/OpenPi goal-harness while-loop for this user intent:

${normalizedIntent}

Goal contract:
- Treat this as a durable objective with a verifiable stopping condition, not a one-off prompt.
- Preserve the full objective. If it cannot be finished now, make concrete progress toward the real requested end state and leave the next step explicit.
- Work from current-state evidence: inspect files, docs, specs, command output, tests, or runtime state before claiming progress.
- Completion is unproven until every explicit requirement has authoritative evidence. Do not redefine success around easier partial work.

Ground truth and compatibility:
- ADRs in docs/decisions/ are the durable architectural record.
- Harness v2 tools are the primary interface: harness_status, harness_intake, harness_init, harness_lint, story_create, decision_record, test_matrix_update.
- Legacy .pi/specs state may exist for old compatibility flows, but it is not the product source of truth and must not be the default path for new work.

Loop contract:
1. Inspect state first: use harness_status unless exact state is already visible in this turn.
2. Classify the intent with harness_intake unless the classification is already obvious and low-risk.
3. Classify risk before acting: tiny, normal, or high-risk. Mention hard gates such as auth, authorization, data model, audit/security, external providers, public contracts, cross-platform, weak proof, or multi-domain.
4. If required inputs are missing or ambiguous, ask one targeted clarification question instead of guessing.
5. Choose exactly one next safe action at a time: one harness tool call, one repo-local docs update via file tools, or one narrow compatibility adapter only when already working inside old .pi/specs state. Do not chain broad changes unless the prior result proves the next step.
6. Prefer the smallest safe step. Never run broad legacy task waves from /goal; ask for explicit confirmation and current status first if the user requests compatibility execution.
7. For create/intake requests, prefer harness_init, harness_intake, story_create, decision_record, test_matrix_update, and repo-local harness/product/story/decision/test-matrix artifacts; use old .pi/specs creation only when the user explicitly asks for legacy Pi spec execution.
8. For implementation/task execution, read the relevant docs/story first and finish with test_matrix_update, harness_lint, harness_status, or a concise validation-evidence summary.
9. Preserve OpenPi authority boundaries: do not perform destructive filesystem/Git actions without explicit confirmation.
10. Final response must be concise: classification, action taken, files/tools touched, current status/evidence, and next suggested /goal intent.`
}

/** Expand /goal into a single controller command for the goal/harness loop. */
function expandGoalCommand(text: string): { text: string; expanded: boolean } {
  if (text !== '/goal' && !text.startsWith('/goal ')) {
    return { text, expanded: false }
  }

  const spaceIndex = text.indexOf(' ')
  const argsString = spaceIndex === -1 ? '' : text.slice(spaceIndex + 1).trim()

  return {
    text: buildGoalHarnessPrompt(argsString),
    expanded: true,
  }
}

function expandSkillCommandForContext(
  text: string,
  session: Awaited<ReturnType<typeof createAgentSession>>['session']
): { text: string; expanded: boolean } {
  if (!text.startsWith('/skill:')) return { text, expanded: false }
  const spaceIndex = text.indexOf(' ')
  const skillName = spaceIndex === -1 ? text.slice(7) : text.slice(7, spaceIndex)
  const args = spaceIndex === -1 ? '' : text.slice(spaceIndex + 1).trim()
  const skill = session.resourceLoader
    .getSkills()
    .skills.find((candidate) => candidate.name === skillName)
  if (!skill) return { text, expanded: false }
  const body = stripFrontmatter(fs.readFileSync(skill.filePath, 'utf-8')).trim()
  const skillBlock = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`
  return { text: args ? `${skillBlock}\n\n${args}` : skillBlock, expanded: true }
}

/**
 * Build the final prompt text sent to Pi SDK.
 * Always runs expansion (goal commands, then prompt templates) regardless of contextPrefix.
 */
function buildSidecarPromptText(
  text: string,
  contextPrefix: string | undefined,
  session: Awaited<ReturnType<typeof createAgentSession>>['session']
): string {
  const trimmed = text.trim()
  const prefix = contextPrefix?.trim()

  // 1. Try goal/harness command expansion first (built-in, no template files needed)
  const goalExpanded = expandGoalCommand(trimmed)
  if (goalExpanded.expanded) {
    return prefix ? `${prefix}\n\n${goalExpanded.text}` : goalExpanded.text
  }

  // 2. Try skill command expansion
  const skillExpanded = expandSkillCommandForContext(trimmed, session)
  if (skillExpanded.expanded) {
    return prefix ? `${prefix}\n\n${skillExpanded.text}` : skillExpanded.text
  }

  // 3. Try prompt template expansion (user-installed .md templates)
  const templateExpanded = expandPromptTemplateText(trimmed, session.promptTemplates)
  if (templateExpanded.expanded) {
    return prefix ? `${prefix}\n\n${templateExpanded.text}` : templateExpanded.text
  }

  // 4. Fall through: wrap raw text with context prefix if present
  return prefix ? `${prefix}\n\n${trimmed}` : trimmed
}

async function getResourceLoader(cwd: string, workspaceTrusted: boolean) {
  const agentDir = getAgentDir()
  if (
    _cachedResourceLoader &&
    _cachedResourceLoader.cwd === cwd &&
    _cachedResourceLoader.workspaceTrusted === workspaceTrusted
  ) {
    return _cachedResourceLoader.loader
  }

  const fileSettingsManager = SettingsManager.create(cwd, agentDir)
  const settingsManager = workspaceTrusted
    ? fileSettingsManager
    : SettingsManager.inMemory(fileSettingsManager.getGlobalSettings())
  // When the workspace is not yet trusted, project-local extensions (.pi/extensions)
  // are blocked by noExtensions=true — they're unknown third-party code.
  // Global extensions (~/.pi/agent/extensions) are the user's own trusted code and
  // MUST always load regardless of workspace trust (e.g. copilot-provider.ts registers
  // the github-copilot provider; blocking it causes "No API key found" errors).
  //
  // We pass agentDir (not agentDir/extensions) as the additional path. The SDK's
  // collectPackageResources treats the path as a "package root" and scans for an
  // extensions/ subdirectory inside it — exactly what we need. If we passed
  // agentDir/extensions directly it would look for extensions/extensions/ (wrong),
  // fall back to adding the directory itself, and loadExtension would fail trying
  // to jiti.import() a directory.
  const noExtensions = !workspaceTrusted
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noExtensions,
    additionalExtensionPaths: noExtensions ? [agentDir] : [],
  })
  try {
    await loader.reload()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    outputLine(
      'warn',
      `[packages] One or more Pi packages failed to install and were skipped: ${msg}`
    )
  }
  _cachedResourceLoader = { cwd, workspaceTrusted, loader }
  return loader
}

// ─── Session management ────────────────────────────────────────────────────────

/**
 * Emit session_shutdown to extensions before disposing a session.
 * This lets extensions (e.g. pi-sub-bar) clean up timers and release
 * captured ctx references. Without this, timers fire with stale ctx
 * and crash the sidecar.
 */
async function emitSessionShutdown(
  session: Awaited<ReturnType<typeof createAgentSession>>['session'],
  reason: string
): Promise<void> {
  try {
    const runner = (
      session as unknown as {
        extensionRunner?: {
          hasHandlers?: (t: string) => boolean
          emit?: (e: unknown) => Promise<unknown>
        }
      }
    ).extensionRunner
    if (runner?.hasHandlers?.('session_shutdown')) {
      await runner.emit?.({ type: 'session_shutdown', reason })
    }
  } catch {
    // Never let extension errors block session disposal
  }
}

async function startSession(
  cwd: string,
  opts: {
    sessionFile?: string
    forkEntryId?: string
    requestId?: string
    workspaceTrusted?: boolean
  } = {}
): Promise<void> {
  // Dispose previous session — emit session_shutdown first so extensions
  // (e.g. pi-sub-bar) can clean up timers before the ctx becomes stale.
  if (state) {
    state.unsubscribe()
    await emitSessionShutdown(state.session, 'session_replaced')
    state.session.dispose()
    state = null
  }

  const agentDir = getAgentDir()
  const authStorage = getAuthStorage()
  const modelRegistry = getModelRegistry()
  const fileSettingsManager = SettingsManager.create(cwd, agentDir)
  const workspaceTrusted = opts.workspaceTrusted ?? false
  const settingsManager = workspaceTrusted
    ? fileSettingsManager
    : SettingsManager.inMemory(fileSettingsManager.getGlobalSettings())
  let sessionManager = opts.sessionFile
    ? SessionManager.open(opts.sessionFile, undefined, cwd)
    : SessionManager.create(cwd)

  if (opts.sessionFile && opts.forkEntryId) {
    const branchedSessionFile = sessionManager.createBranchedSession(opts.forkEntryId)
    if (branchedSessionFile) {
      sessionManager = SessionManager.open(branchedSessionFile, undefined, cwd)
    }
  }

  const resourceLoader = await getResourceLoader(cwd, workspaceTrusted)

  const { session } = await createAgentSession({
    cwd,
    agentDir,
    sessionManager,
    authStorage,
    modelRegistry,
    settingsManager,
    resourceLoader,
    customTools: createOpenPiSubagentTools({
      getAgentDir,
      isWorkspaceTrusted: () => state?.workspaceTrusted ?? workspaceTrusted,
      onSubagentUpdate: (event) => {
        send({ type: 'session_event', event })
      },
    }),
  })

  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    send({ type: 'session_event', event: event as Record<string, unknown> })

    const ev = event as {
      type: string
      success?: boolean
      finalError?: string
      errorMessage?: string
      message?: string
    }

    if (ev.type === 'agent_end') {
      send({ type: 'session_index_updated' })
    }

    if (ev.type === 'extension_error') {
      outputLine('error', `[extension] ${String(ev.message ?? 'extension error')}`)
    }

    if (ev.type === 'auto_retry_end' && ev.success === false) {
      outputLine('warn', `[retry] ${ev.finalError ?? 'Auto-retry failed'}`)
    }

    if (ev.type === 'compaction_end' && ev.errorMessage) {
      outputLine('error', `[compaction] ${ev.errorMessage}`)
    }
  })

  state = { session, cwd, workspaceTrusted, unsubscribe }

  const model = session.model as
    | { id: string; name: string; provider: string; reasoning?: boolean; contextWindow?: number }
    | undefined

  const payload: SessionReadyPayload = {
    cwd,
    sessionFile: session.sessionFile ?? null,
    sessionId: session.sessionId ?? null,
    sessionName: opts.sessionFile ? null : null, // main process resolves display name from SQLite
    model: model
      ? {
          id: model.id,
          name: model.name,
          provider: model.provider,
          reasoning: model.reasoning ?? false,
          contextWindow: model.contextWindow ?? 0,
        }
      : null,
    thinkingLevel: (session.thinkingLevel as string | undefined) ?? null,
  }

  send({ type: 'session_ready', requestId: opts.requestId, payload })
}

// ─── Command handler ────────────────────────────────────────────────────────────

parentPort.on('message', (message) => {
  const cmd = (
    message && typeof message === 'object' && 'data' in message
      ? (message as { data: unknown }).data
      : message
  ) as SidecarCommand
  void handleCommand(cmd).catch((err) => {
    send({
      type: 'error',
      requestId: cmd && typeof cmd === 'object' && 'requestId' in cmd ? cmd.requestId : undefined,
      message: err instanceof Error ? err.message : String(err),
    })
  })
})

async function handleCommand(cmd: SidecarCommand): Promise<void> {
  switch (cmd.type) {
    case 'start_session': {
      try {
        await startSession(cmd.cwd, {
          sessionFile: cmd.sessionFile,
          forkEntryId: cmd.forkEntryId,
          requestId: cmd.requestId,
          workspaceTrusted: cmd.workspaceTrusted,
        })
      } catch (err) {
        send({
          type: 'session_error',
          requestId: cmd.requestId,
          message: err instanceof Error ? err.message : String(err),
        })
      }
      break
    }

    case 'prompt': {
      if (!state) return
      const promptText = buildSidecarPromptText(cmd.text, cmd.contextPrefix, state.session)
      await state.session.prompt(promptText)
      break
    }

    case 'steer': {
      if (!state) return
      const steerText = buildSidecarPromptText(cmd.text, cmd.contextPrefix, state.session)
      await state.session.steer(steerText)
      break
    }

    case 'follow_up': {
      if (!state) return
      const followUpText = buildSidecarPromptText(cmd.text, cmd.contextPrefix, state.session)
      await state.session.followUp(followUpText)
      break
    }

    case 'list_prompt_templates': {
      const cwd = cmd.cwd ?? state?.cwd ?? process.cwd()
      const workspaceTrusted = cmd.workspaceTrusted ?? false
      const loader = await getResourceLoader(cwd, workspaceTrusted)
      const prompts = loader.getPrompts().prompts.map((prompt) => ({
        name: prompt.name,
        description: prompt.description,
        argHint: prompt.argumentHint,
      }))
      send({ type: 'prompt_templates_result', requestId: cmd.requestId, prompts })
      break
    }

    case 'list_skills': {
      const cwd = cmd.cwd ?? state?.cwd ?? process.cwd()
      const workspaceTrusted = cmd.workspaceTrusted ?? false
      const loader = await getResourceLoader(cwd, workspaceTrusted)
      const skills = loader.getSkills().skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        path: skill.baseDir,
        scope: skill.sourceInfo.scope === 'project' ? 'project' : 'user',
        tags: [],
      }))
      send({ type: 'skills_result', requestId: cmd.requestId, skills })
      break
    }

    case 'read_skill_file': {
      const cwd = cmd.cwd ?? state?.cwd ?? process.cwd()
      const workspaceTrusted = cmd.workspaceTrusted ?? false
      const loader = await getResourceLoader(cwd, workspaceTrusted)
      const requested = path.resolve(cmd.path)
      const skill = loader
        .getSkills()
        .skills.find((candidate) => path.resolve(candidate.filePath) === requested)
      if (!skill) {
        send({ type: 'skill_file_result', requestId: cmd.requestId, content: null })
        break
      }
      try {
        send({
          type: 'skill_file_result',
          requestId: cmd.requestId,
          content: fs.readFileSync(skill.filePath, 'utf-8'),
        })
      } catch {
        send({ type: 'skill_file_result', requestId: cmd.requestId, content: null })
      }
      break
    }

    case 'abort': {
      if (!state) return
      await state.session.abort()
      break
    }

    case 'execute_bash': {
      if (!state) {
        send({ type: 'bash_result', requestId: cmd.requestId, result: null })
        return
      }
      const result = await state.session.executeBash(cmd.command, undefined, {
        excludeFromContext: cmd.excludeFromContext,
      })
      send({ type: 'bash_result', requestId: cmd.requestId, result })
      break
    }

    case 'set_model': {
      if (!state) return
      const model = getModelRegistry().find(cmd.provider, cmd.modelId)
      if (!model) return
      await state.session.setModel(model)
      break
    }

    case 'set_thinking': {
      if (!state) return
      state.session.setThinkingLevel(
        cmd.level as Parameters<typeof state.session.setThinkingLevel>[0]
      )
      break
    }

    case 'set_session_name': {
      if (!state) return
      state.session.setSessionName(cmd.name)
      break
    }

    case 'fork_session': {
      if (!state) return

      // Resolve the fork entry ID.
      //
      // During live streaming, sessionEvents.ts assigns synthetic display IDs
      // ("u-{timestampMs}" for user messages, "a-{timestampMs}" for assistant)
      // because the Pi SDK's message_start event does not include the real
      // session entry ID. These synthetic IDs are NOT valid Pi session entry IDs
      // and cause "Entry not found" errors inside createBranchedSession().
      //
      // Resolution strategy: extract the encoded Unix timestamp from the synthetic
      // ID and find the matching session entry via sessionManager.getEntries().
      // By the time the user can click Fork, message_end has fired and
      // sessionManager.appendMessage() has persisted the entry — so getEntries()
      // will contain the real entry with the correct timestamp.
      let forkEntryId = cmd.entryId
      const syntheticMatch = /^[ua]-(-?\d+)$/.exec(cmd.entryId)
      if (syntheticMatch) {
        const timestampMs = Number(syntheticMatch[1])
        const entries = state.session.sessionManager.getEntries()
        const match = entries.find((e) => {
          if (e.type !== 'message') return false
          const msg = e.message as { timestamp?: number }
          return typeof msg.timestamp === 'number' && msg.timestamp === timestampMs
        })
        if (!match) {
          throw new Error(
            `Cannot fork: no session entry found with timestamp ${timestampMs} (id: ${cmd.entryId}). The message may still be streaming.`
          )
        }
        forkEntryId = match.id
      }

      await startSession(state.cwd, {
        sessionFile: state.session.sessionFile ?? undefined,
        forkEntryId,
        requestId: cmd.requestId,
      })
      break
    }

    case 'get_stats': {
      if (!state) {
        send({
          type: 'stats_result',
          requestId: cmd.requestId,
          stats: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            cost: 0,
            contextUsagePercent: null,
            sessionFile: null,
            sessionId: null,
            isStreaming: false,
          },
        })
        return
      }
      const agent = state.session.agent
      type AssistantMsg = {
        role: string
        usage?: {
          input?: number
          output?: number
          cacheRead?: number
          cacheWrite?: number
          inputTokens?: number
          outputTokens?: number
          cacheReadTokens?: number
          cacheWriteTokens?: number
          cost?: { total?: number } | number
        }
      }
      const msgs: AssistantMsg[] =
        (agent as unknown as { state?: { messages?: AssistantMsg[] } }).state?.messages ?? []
      let inputTokens = 0,
        outputTokens = 0,
        cacheReadTokens = 0,
        cacheWriteTokens = 0,
        cost = 0
      for (const m of msgs) {
        if (m.role !== 'assistant') continue
        inputTokens += m.usage?.input ?? m.usage?.inputTokens ?? 0
        outputTokens += m.usage?.output ?? m.usage?.outputTokens ?? 0
        cacheReadTokens += m.usage?.cacheRead ?? m.usage?.cacheReadTokens ?? 0
        cacheWriteTokens += m.usage?.cacheWrite ?? m.usage?.cacheWriteTokens ?? 0
        const usageCost = m.usage?.cost
        cost += typeof usageCost === 'number' ? usageCost : (usageCost?.total ?? 0)
      }
      send({
        type: 'stats_result',
        requestId: cmd.requestId,
        stats: {
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
          cost,
          contextUsagePercent: state.session.getContextUsage()?.percent ?? null,
          sessionFile: state.session.sessionFile ?? null,
          sessionId: state.session.sessionId ?? null,
          isStreaming:
            (agent as unknown as { state?: { isStreaming?: boolean } }).state?.isStreaming ?? false,
        },
      })
      break
    }

    case 'get_models': {
      const models = await getModelRegistry().getAvailable()
      const mapped = (
        models as Array<{
          id: string
          name: string
          provider: string
          reasoning?: boolean
          contextWindow?: number
        }>
      ).map((m) => ({
        id: m.id,
        name: m.name,
        provider: m.provider,
        reasoning: m.reasoning ?? false,
        contextWindow: m.contextWindow ?? 0,
      }))
      send({ type: 'models_result', requestId: cmd.requestId, models: mapped })
      break
    }

    case 'get_settings': {
      const agentDir = getAgentDir()
      const settingsManager = state
        ? SettingsManager.create(state.cwd, agentDir)
        : SettingsManager.create(agentDir, agentDir)
      const global = settingsManager.getGlobalSettings()
      const project = state ? settingsManager.getProjectSettings() : {}
      const effective = { ...global, ...project }
      send({
        type: 'settings_result',
        requestId: cmd.requestId,
        result: { global, project, effective },
      })
      break
    }

    case 'save_settings': {
      const agentDir = getAgentDir()
      const settingsPath =
        cmd.scope === 'global'
          ? path.join(agentDir, 'settings.json')
          : path.join(state?.cwd ?? agentDir, '.pi', 'settings.json')
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
      fs.writeFileSync(settingsPath, `${JSON.stringify(cmd.settings, null, 2)}\n`, 'utf-8')
      // Reload resource loader cache after settings change
      _cachedResourceLoader = null
      break
    }

    case 'get_providers': {
      const registry = getModelRegistry()
      const allModels = registry.getAll() as Array<{ provider: string }>
      const providerModelCounts = new Map<string, number>()
      for (const m of allModels) {
        providerModelCounts.set(m.provider, (providerModelCounts.get(m.provider) ?? 0) + 1)
      }
      const providers = []
      for (const [providerId, count] of providerModelCounts) {
        const status = registry.getProviderAuthStatus(providerId)
        const displayName = registry.getProviderDisplayName(providerId)
        const cred = getAuthStorage().get(providerId)
        const credentialType =
          cred?.type === 'oauth'
            ? 'oauth'
            : cred?.type === 'api_key'
              ? 'api_key'
              : status.source === 'environment'
                ? 'env'
                : undefined
        providers.push({
          id: providerId,
          displayName,
          configured: status.configured,
          modelCount: count,
          source: status.source,
          credentialType,
        })
      }
      send({ type: 'providers_result', requestId: cmd.requestId, providers })
      break
    }

    case 'set_provider_key': {
      getAuthStorage().set(cmd.provider, { type: 'api_key', key: cmd.apiKey })
      invalidateModelRegistry()
      break
    }

    case 'remove_provider_key': {
      getAuthStorage().remove(cmd.provider)
      invalidateModelRegistry()
      break
    }

    case 'invalidate_models': {
      invalidateModelRegistry()
      break
    }

    case 'login_provider': {
      try {
        await getAuthStorage().login(cmd.providerId, {
          onAuth: ({ url, instructions }: { url: string; instructions?: string }) => {
            send({
              type: 'provider_login_event',
              requestId: cmd.requestId,
              event: { type: 'auth', url, instructions },
            })
          },
          onProgress: (message: string) => {
            send({
              type: 'provider_login_event',
              requestId: cmd.requestId,
              event: { type: 'progress', message },
            })
          },
          onPrompt: (prompt: {
            message: string
            placeholder?: string
            allowEmpty?: boolean
          }): Promise<string> => {
            send({
              type: 'provider_login_event',
              requestId: cmd.requestId,
              event: { type: 'prompt', ...prompt },
            })
            return new Promise<string>((resolve) => {
              _pendingOAuthPrompts.set(cmd.providerId, resolve)
            })
          },
          onSelect: (selectPrompt: {
            message: string
            options: { id: string; label: string }[]
          }): Promise<string | undefined> => {
            send({
              type: 'provider_login_event',
              requestId: cmd.requestId,
              event: { type: 'select', ...selectPrompt },
            })
            return new Promise<string | undefined>((resolve) => {
              _pendingOAuthPrompts.set(cmd.providerId, (v) => resolve(v || undefined))
            })
          },
        })
        invalidateModelRegistry()
        send({ type: 'provider_login_event', requestId: cmd.requestId, event: { type: 'success' } })
      } catch (err) {
        send({
          type: 'provider_login_event',
          requestId: cmd.requestId,
          event: { type: 'error', message: err instanceof Error ? err.message : String(err) },
        })
      }
      break
    }

    case 'logout_provider': {
      getAuthStorage().logout(cmd.providerId)
      invalidateModelRegistry()
      break
    }

    case 'resolve_provider_prompt': {
      const resolver = _pendingOAuthPrompts.get(cmd.providerId)
      if (resolver) {
        resolver(cmd.value)
        _pendingOAuthPrompts.delete(cmd.providerId)
      }
      break
    }

    case 'stop': {
      if (state) {
        state.unsubscribe()
        await emitSessionShutdown(state.session, 'quit')
        state.session.dispose()
        state = null
      }
      send({ type: 'stopped' })
      setTimeout(() => process.exit(0), 100)
      break
    }
  }
}

// ─── Boot ──────────────────────────────────────────────────────────────────────

send({ type: 'ready' })
